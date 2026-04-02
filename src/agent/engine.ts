import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { buildSystemPrompt, buildUserMessagePreamble } from './context-builder.js';
import { compactMessages } from './compaction.js';
import { estimateMessagesTokenCount } from '../utils/token-counter.js';
import { executeTool, type ToolUseBlock, type ToolResultBlock } from '../tools/executor.js';
import { getAllToolDefinitions } from '../tools/index.js';
import type { AnthropicToolDefinition } from '../mcp/tool-mapper.js';
import type { McpClientPool } from '../mcp/client-pool.js';
import type { TraceSink } from '../trace/sink.js';
import type {
  AskUserQuestionItem,
  StreamEvent,
  TokenUsage,
  InputResponse,
  ToolExecutionContext,
  SkillManagerInterface,
  MemoryServiceInterface,
  McpServerConfig,
  McpServerContext,
} from '../types.js';

// ─── Anthropic ContentBlock types (subset we need) ───

export type TextBlock = { type: 'text'; text: string };
export type ToolUseContentBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultContentBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseContentBlock | ToolResultContentBlock;

/** A message in Anthropic Messages API format — content is always ContentBlock[]. */
export interface ApiMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface AgentRunInput {
  prompt: string;
  conversationId: string;
  userId: string;
  messageId: string;
  model?: string;
  assistantName?: string;
  timezone?: string;
  locale?: string;
  device_type?: string;
  thinking?: boolean;
  max_thinking_tokens?: number;
  show_tool_use?: boolean;
  mcp_servers?: Record<string, McpServerConfig>;
  mcp_context?: Record<string, McpServerContext>;
  /** Per-request tool allowlist (intersected with server-level ALLOWED_TOOLS). */
  allowed_tools?: string[];
  metadata?: Record<string, unknown>;
  /** Restored history — each content is JSON-serialized ContentBlock[]. */
  existingMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Resume an interrupted AskUserQuestion flow without sending a new prompt. */
  resumeInputResponse?: InputResponse;
  /** When true, AskUserQuestion returns awaiting_input instead of blocking the HTTP request. */
  pauseOnInput?: boolean;
  traceId?: string;
  requestId?: string;
}

export interface AgentRunResult {
  /** Final text displayed to user. */
  content: string;
  usage: TokenUsage;
  stop_reason: string;
  model: string;
  /**
   * All new messages produced in this request, in Anthropic format.
   * Each content is JSON-serialized ContentBlock[] for storage.
   */
  newMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  awaiting_input?: {
    type: 'ask_user_question';
    tool_use_id: string;
    questions: AskUserQuestionItem[];
    timeout_ms: number;
  };
}

function normalizeQuestions(raw: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is AskUserQuestionItem => {
      return (
        !!item &&
        typeof item === 'object' &&
        typeof (item as AskUserQuestionItem).question === 'string' &&
        typeof (item as AskUserQuestionItem).header === 'string' &&
        Array.isArray((item as AskUserQuestionItem).options)
      );
    })
    .slice(0, 4);
}

function buildUserInputToolResult(response: InputResponse): ToolResultContentBlock {
  const answersText = Object.entries(response.answers)
    .map(([question, answer]) => {
      const parts = [`"${question}" = "${answer}"`];
      if (response.annotations?.[question]?.notes) {
        parts.push(`User note: ${response.annotations[question].notes}`);
      }
      return parts.join(' ');
    })
    .join('\n');

  return {
    type: 'tool_result',
    tool_use_id: response.tool_use_id,
    content: `User answered:\n${answersText}\n\nProceed based on the user's selections.`,
  };
}

function recoverOrphanToolResult(toolUseId: string, content: string): TextBlock {
  return {
    type: 'text',
    text: `Recovered orphan tool_result (tool_use_id=${toolUseId}).\n${content}`,
  };
}

function normalizeHistoricalBlock(block: ContentBlock): TextBlock | null {
  if (block.type === 'text') {
    return block;
  }
  // Drop historical tool_use/tool_result blocks to avoid stale linkage errors
  // and prevent models from imitating pseudo tool-call text.
  return null;
}

function sanitizeToolLinkage(messages: ApiMessage[]): {
  messages: ApiMessage[];
  orphanedToolResults: number;
} {
  const seenToolUseIds = new Set<string>();
  const sanitized: ApiMessage[] = [];
  let orphanedToolResults = 0;

  for (const message of messages) {
    const nextBlocks: ContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === 'tool_use' && message.role === 'assistant') {
        seenToolUseIds.add(block.id);
        nextBlocks.push(block);
        continue;
      }

      if (block.type === 'tool_result' && message.role === 'user') {
        if (seenToolUseIds.has(block.tool_use_id)) {
          nextBlocks.push(block);
        } else {
          orphanedToolResults++;
          nextBlocks.push(recoverOrphanToolResult(block.tool_use_id, block.content));
        }
        continue;
      }

      nextBlocks.push(block);
    }

    if (nextBlocks.length > 0) {
      sanitized.push({ role: message.role, content: nextBlocks });
    }
  }

  return { messages: sanitized, orphanedToolResults };
}

export class AgentEngine {
  private anthropic: Anthropic;

  constructor(
    private skillManager: SkillManagerInterface,
    private memoryService: MemoryServiceInterface,
    private mcpClientPool: McpClientPool,
    private traceSink: TraceSink,
  ) {
    const authOptions =
      config.ANTHROPIC_AUTH_TOKEN.trim() !== ''
        ? { authToken: config.ANTHROPIC_AUTH_TOKEN }
        : { apiKey: config.ANTHROPIC_API_KEY };
    this.anthropic = new Anthropic({
      ...authOptions,
      baseURL: config.ANTHROPIC_BASE_URL,
    });
  }

  async run(
    input: AgentRunInput,
    onEvent: (event: StreamEvent) => void,
    waitForUserInput: (toolUseId: string) => Promise<InputResponse>,
    abortSignal?: AbortSignal,
  ): Promise<AgentRunResult> {
    const model = input.model ?? config.DEFAULT_MODEL;

    // 1. Build system prompt
    const systemBlocks = await buildSystemPrompt(input.userId, {
      assistantName: input.assistantName,
      timezone: input.timezone,
      metadata: input.metadata,
    });

    // 2. Build tool list (builtin filtered by allowed_tools + MCP if enabled)
    const mcpServers = config.ENABLE_MCP ? input.mcp_servers : undefined;
    const mcpContext = config.ENABLE_MCP ? input.mcp_context : undefined;
    const { tools, mcpWarnings } = await this.buildToolList(
      mcpServers,
      mcpContext,
      input.allowed_tools,
    );
    if (mcpWarnings.length > 0) {
      logger.warn({ mcpWarnings }, 'MCP tool discovery warnings');
    }

    // 3. Build user message preamble (skills + memory — gated by active tools)
    const activeToolNames = tools.map((t) => t.name);
    const preambleBlocks = await buildUserMessagePreamble(
      input.userId,
      this.skillManager,
      this.memoryService,
      { timezone: input.timezone, device_type: input.device_type, locale: input.locale },
      activeToolNames,
    );

    this.emitTrace(input, 'context_built', {
      model,
      system_blocks: systemBlocks,
      preamble_blocks: preambleBlocks,
      existing_message_count: input.existingMessages?.length ?? 0,
      existing_messages_preview: (input.existingMessages ?? []).slice(-20),
      current_prompt_preview: input.prompt.slice(0, 2000),
      available_tools: tools.map((t) => t.name),
      mcp_warnings: mcpWarnings,
    });

    // 4. Construct messages in Anthropic API format
    const messages: ApiMessage[] = [];

    // Restore history — each stored content is JSON-serialized ContentBlock[]
    if (input.existingMessages) {
      for (const msg of input.existingMessages) {
        try {
          const parsed = JSON.parse(msg.content);
          const parsedBlocks = Array.isArray(parsed) ? (parsed as ContentBlock[]) : [];
          // Normalize historical tool blocks to text for strict Anthropic-compatible providers
          // (e.g. MiniMax) that may reject stale/non-adjacent tool linkage in prior turns.
          const normalizedBlocks = parsedBlocks
            .map(normalizeHistoricalBlock)
            .filter((b): b is TextBlock => b !== null);
          if (normalizedBlocks.length > 0) {
            messages.push({ role: msg.role, content: normalizedBlocks });
          }
        } catch {
          // Legacy plain-text fallback
          messages.push({ role: msg.role, content: [{ type: 'text', text: msg.content }] });
        }
      }
    }

    const newMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (input.resumeInputResponse) {
      const toolResultContent: ContentBlock[] = [
        buildUserInputToolResult(input.resumeInputResponse),
      ];
      messages.push({ role: 'user', content: toolResultContent });
      newMessages.push({ role: 'user', content: JSON.stringify(toolResultContent) });
    } else {
      // Build new user message: preamble blocks + actual message (with cache_control on last block)
      const userContent: ContentBlock[] = [
        ...preambleBlocks,
        { type: 'text', text: input.prompt, cache_control: { type: 'ephemeral' } } as any,
      ];
      messages.push({ role: 'user', content: userContent });
      newMessages.push({ role: 'user', content: JSON.stringify(userContent) });
    }

    // 5. Agent loop
    let totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
    let stopReason = 'end_turn';
    let finalText = '';
    let continueLoop = true;
    let loopCount = 0;
    const MAX_LOOPS = 25;

    while (continueLoop && loopCount < MAX_LOOPS) {
      loopCount++;

      if (abortSignal?.aborted) {
        stopReason = 'timeout';
        break;
      }

      // Create API request
      const sanitizeResult = sanitizeToolLinkage(messages);
      messages.length = 0;
      messages.push(...sanitizeResult.messages);
      if (sanitizeResult.orphanedToolResults > 0) {
        logger.warn(
          {
            conversationId: input.conversationId,
            loop: loopCount,
            orphanedToolResults: sanitizeResult.orphanedToolResults,
          },
          'Recovered orphan tool_result blocks before model call',
        );
        this.emitTrace(input, 'tool_linkage_recovered', {
          loop: loopCount,
          orphaned_tool_results: sanitizeResult.orphanedToolResults,
        });
      }

      const loopStartMs = Date.now();
      let loopInputTokens = 0;
      let loopOutputTokens = 0;
      this.emitTrace(input, 'model_call_start', {
        loop: loopCount,
        model,
        message_count: messages.length,
        tool_count: tools.length,
      });
      const apiParams: Anthropic.MessageCreateParams = {
        model,
        max_tokens: config.MAX_OUTPUT_TOKENS,
        system: systemBlocks.map((b) => ({
          type: 'text' as const,
          text: b.text,
          ...(b.cache_control ? { cache_control: b.cache_control } : {}),
        })),
        messages: messages as Anthropic.MessageParam[],
        tools: tools as Anthropic.Tool[],
        stream: true,
      };

      if (input.thinking) {
        (apiParams as unknown as Record<string, unknown>).thinking = {
          type: 'enabled',
          budget_tokens: input.max_thinking_tokens ?? 10000,
        };
      }

      // Debug: dump full API request to file
      if (process.env.DUMP_PROMPTS && loopCount === 1) {
        const dumpPath =
          process.env.DUMP_PROMPTS === '1'
            ? `/tmp/femtoclaw-prompt-dump-${Date.now()}.json`
            : process.env.DUMP_PROMPTS;
        const { writeFileSync } = await import('fs');
        writeFileSync(dumpPath, JSON.stringify(apiParams, null, 2), 'utf-8');
        logger.info({ dumpPath, toolCount: tools.length }, 'Prompt dumped to file');
      }

      // 6. Stream response
      const stream = this.anthropic.messages.stream(apiParams);

      // Collect assistant content blocks
      const assistantBlocks: ContentBlock[] = [];
      let currentText = '';
      let thinkingText = '';
      const toolUseBlocks: ToolUseBlock[] = [];
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

      for await (const event of stream) {
        if (abortSignal?.aborted) break;

        switch (event.type) {
          case 'content_block_start': {
            const block = (event as any).content_block;
            if (block?.type === 'text') {
              currentText = '';
            } else if (block?.type === 'tool_use') {
              // Flush any accumulated text
              if (currentText) {
                assistantBlocks.push({ type: 'text', text: currentText });
                currentText = '';
              }
              currentToolUse = { id: block.id, name: block.name, inputJson: '' };
              if (input.show_tool_use) {
                onEvent({ type: 'tool_use', data: { tool: block.name, input: {} } });
              }
            }
            break;
          }

          case 'content_block_delta': {
            const delta = (event as any).delta;
            if (delta?.type === 'text_delta' && delta.text) {
              currentText += delta.text;
              onEvent({ type: 'text_delta', data: { text: delta.text } });
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              thinkingText += String(delta.thinking);
              onEvent({ type: 'thinking_delta', data: { thinking: delta.thinking } });
            } else if (delta?.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.inputJson += delta.partial_json ?? '';
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolUse) {
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {};
              } catch {
                logger.warn(
                  { tool: currentToolUse.name, json: currentToolUse.inputJson },
                  'Failed to parse tool input JSON',
                );
              }
              // Add tool_use block to assistant content
              assistantBlocks.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: parsedInput,
              });
              toolUseBlocks.push({
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: parsedInput,
              });
              currentToolUse = null;
            } else if (currentText) {
              assistantBlocks.push({ type: 'text', text: currentText });
              currentText = '';
            }
            break;
          }

          case 'message_delta': {
            const messageDelta = (event as any).delta;
            if (messageDelta?.stop_reason) {
              stopReason = messageDelta.stop_reason;
            }
            const usage = (event as any).usage;
            if (usage) {
              const outTokens = usage.output_tokens ?? 0;
              totalUsage.output_tokens += outTokens;
              loopOutputTokens += outTokens;
            }
            break;
          }

          case 'message_start': {
            const msgUsage = (event as any).message?.usage;
            if (msgUsage) {
              const inTokens = msgUsage.input_tokens ?? 0;
              totalUsage.input_tokens += inTokens;
              loopInputTokens += inTokens;
              totalUsage.cache_read_tokens =
                (totalUsage.cache_read_tokens ?? 0) + (msgUsage.cache_read_input_tokens ?? 0);
              totalUsage.cache_creation_tokens =
                (totalUsage.cache_creation_tokens ?? 0) +
                (msgUsage.cache_creation_input_tokens ?? 0);
            }
            break;
          }
        }
      }

      this.emitTrace(input, 'model_call_end', {
        loop: loopCount,
        model,
        latency_ms: Date.now() - loopStartMs,
        stop_reason: stopReason,
        input_tokens: loopInputTokens,
        output_tokens: loopOutputTokens,
        output_text_length: finalText.length,
        tool_use_count: toolUseBlocks.length,
        thinking: this.formatThinkingForTrace(thinkingText),
      });

      // Flush trailing text
      if (currentText) {
        assistantBlocks.push({ type: 'text', text: currentText });
      }

      // Extract final text for user-facing response
      const textParts = assistantBlocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text);
      if (textParts.length > 0) finalText = textParts.join('');

      // Add assistant message to conversation (full structured blocks)
      messages.push({ role: 'assistant', content: assistantBlocks });
      newMessages.push({ role: 'assistant', content: JSON.stringify(assistantBlocks) });

      // 7. Process tool calls
      if (toolUseBlocks.length > 0) {
        const toolContext: ToolExecutionContext = {
          conversationId: input.conversationId,
          userId: input.userId,
          onStreamEvent: onEvent,
          waitForUserInput,
          skillManager: this.skillManager,
          memoryService: this.memoryService,
        };

        const toolResultBlocks: ToolResultContentBlock[] = [];

        for (const block of toolUseBlocks) {
          this.emitTrace(input, 'tool_call_start', {
            loop: loopCount,
            tool_use_id: block.id,
            tool_name: block.name,
            input: block.input,
          });
          if (block.name === 'AskUserQuestion') {
            const questions = normalizeQuestions(block.input.questions);
            onEvent({
              type: 'input_required',
              data: {
                type: 'ask_user_question',
                tool_use_id: block.id,
                questions,
              },
            });
            onEvent({
              type: 'message_paused',
              data: {
                reason: 'waiting_for_user_input',
                resume_hint: 'POST /chat with input_response',
              },
            });

            if (input.pauseOnInput) {
              this.emitTrace(input, 'tool_call_end', {
                loop: loopCount,
                tool_use_id: block.id,
                tool_name: block.name,
                status: 'awaiting_input',
                question_count: questions.length,
              });
              await this.mcpClientPool.cleanupTransient();
              return {
                content: finalText,
                usage: totalUsage,
                stop_reason: 'awaiting_input',
                model,
                newMessages,
                awaiting_input: {
                  type: 'ask_user_question',
                  tool_use_id: block.id,
                  questions,
                  timeout_ms: config.INPUT_TIMEOUT_MS,
                },
              };
            }

            const userResponse = await waitForUserInput(block.id);
            toolResultBlocks.push(buildUserInputToolResult(userResponse));
            this.emitTrace(input, 'tool_call_end', {
              loop: loopCount,
              tool_use_id: block.id,
              tool_name: block.name,
              status: 'ok',
              resumed: true,
            });
          } else {
            const result = await executeTool(block, toolContext, this.mcpClientPool);
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: result.tool_use_id,
              content: result.content,
              is_error: result.is_error,
            });

            if (input.show_tool_use) {
              onEvent({
                type: 'tool_result',
                data: { tool: block.name, content: result.content },
              });
            }
            this.emitTrace(input, 'tool_call_end', {
              loop: loopCount,
              tool_use_id: block.id,
              tool_name: block.name,
              status: result.is_error ? 'error' : 'ok',
              is_error: result.is_error,
              result_preview: String(result.content).slice(0, 1000),
            });
          }
        }

        // Add tool results as user message (structured blocks)
        const toolResultContent: ContentBlock[] = toolResultBlocks;
        messages.push({ role: 'user', content: toolResultContent });
        newMessages.push({ role: 'user', content: JSON.stringify(toolResultContent) });
      } else {
        continueLoop = false;
      }

      // 8. Token budget check for compaction
      const estimatedTokens = estimateMessagesTokenCount(
        messages.map((m) => ({
          role: m.role,
          content: JSON.stringify(m.content),
        })),
      );
      if (estimatedTokens > config.COMPACTION_THRESHOLD) {
        const simpleMessages = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: JSON.stringify(m.content),
        }));
        const compacted = await compactMessages(simpleMessages, this.anthropic);
        messages.length = 0;
        for (const cm of compacted) {
          try {
            messages.push({ role: cm.role, content: JSON.parse(cm.content) });
          } catch {
            messages.push({ role: cm.role, content: [{ type: 'text', text: cm.content }] });
          }
        }
        const compactedSanitizeResult = sanitizeToolLinkage(messages);
        messages.length = 0;
        messages.push(...compactedSanitizeResult.messages);
        if (compactedSanitizeResult.orphanedToolResults > 0) {
          logger.warn(
            {
              conversationId: input.conversationId,
              loop: loopCount,
              orphanedToolResults: compactedSanitizeResult.orphanedToolResults,
            },
            'Recovered orphan tool_result blocks after compaction',
          );
          this.emitTrace(input, 'tool_linkage_recovered', {
            loop: loopCount,
            orphaned_tool_results: compactedSanitizeResult.orphanedToolResults,
            stage: 'post_compaction',
          });
        }
      }
    }

    if (loopCount >= MAX_LOOPS) {
      stopReason = 'max_turns';
      logger.warn({ conversationId: input.conversationId }, 'Agent reached max loop count');
    }

    await this.mcpClientPool.cleanupTransient();

    return {
      content: finalText,
      usage: totalUsage,
      stop_reason: stopReason,
      model,
      newMessages,
    };
  }

  private emitTrace(
    input: AgentRunInput,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    if (!input.traceId) {
      return;
    }
    this.traceSink.emit({
      trace_id: input.traceId,
      request_id: input.requestId,
      conversation_id: input.conversationId,
      user_id: input.userId,
      message_id: input.messageId,
      event_type: eventType,
      payload,
    });
  }

  private formatThinkingForTrace(thinkingText: string): string | undefined {
    const normalized = thinkingText.trim();
    if (!normalized) {
      return undefined;
    }
    if (config.TRACE_INCLUDE_THINKING === 'off') {
      return undefined;
    }
    if (config.TRACE_INCLUDE_THINKING === 'full') {
      return normalized.slice(0, config.TRACE_THINKING_MAX_CHARS);
    }
    if (normalized.length <= config.TRACE_THINKING_MAX_CHARS) {
      return normalized;
    }
    return `${normalized.slice(0, config.TRACE_THINKING_MAX_CHARS)}...`;
  }

  private async buildToolList(
    perRequestServers?: Record<string, McpServerConfig>,
    perRequestContext?: Record<string, McpServerContext>,
    requestAllowedTools?: string[],
  ): Promise<{
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    mcpWarnings: string[];
  }> {
    // Built-in tools filtered by server-level + request-level allowlist
    const tools: Array<{
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
    }> = getAllToolDefinitions(requestAllowedTools);

    const { tools: mcpTools, warnings: mcpWarnings } = await this.mcpClientPool.getAnthropicTools(
      perRequestServers,
      perRequestContext,
    );

    for (const mcpTool of mcpTools) {
      tools.push(mcpTool);
    }

    logger.debug(
      {
        builtinCount: getAllToolDefinitions().length,
        mcpCount: mcpTools.length,
        total: tools.length,
      },
      'Tool list built',
    );

    return { tools, mcpWarnings };
  }
}
