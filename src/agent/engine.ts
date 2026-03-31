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
import type {
  StreamEvent,
  TokenUsage,
  InputResponse,
  ToolExecutionContext,
  SkillManagerInterface,
  MemoryServiceInterface,
  McpServerConfig,
  McpServerContext,
} from '../types.js';

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
  metadata?: Record<string, unknown>;
  existingMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentRunResult {
  content: string;
  usage: TokenUsage;
  stop_reason: string;
  model: string;
  newMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export class AgentEngine {
  private anthropic: Anthropic;

  constructor(
    private skillManager: SkillManagerInterface,
    private memoryService: MemoryServiceInterface,
    private mcpClientPool: McpClientPool,
  ) {
    this.anthropic = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
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
    const startTime = Date.now();

    // 1. Build system prompt
    const systemBlocks = await buildSystemPrompt(input.userId, {
      assistantName: input.assistantName,
      timezone: input.timezone,
      metadata: input.metadata,
    });

    // 2. Build user message preamble (skills + memory)
    const preambleBlocks = await buildUserMessagePreamble(
      input.userId,
      this.skillManager,
      this.memoryService,
      { timezone: input.timezone, device_type: input.device_type, locale: input.locale },
    );

    // 3. Build tool list (builtin + MCP — discovers MCP tools from connected servers)
    const { tools, mcpWarnings } = await this.buildToolList(input.mcp_servers, input.mcp_context);
    if (mcpWarnings.length > 0) {
      logger.warn({ mcpWarnings }, 'MCP tool discovery warnings');
    }

    // 4. Construct messages
    const messages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<{ type: 'text'; text: string }>;
    }> = [];

    // Add existing conversation history
    if (input.existingMessages) {
      for (const msg of input.existingMessages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add new user message with preamble blocks
    const userContentBlocks: Array<{ type: 'text'; text: string }> = [
      ...preambleBlocks,
      { type: 'text', text: input.prompt },
    ];
    messages.push({ role: 'user', content: userContentBlocks });

    // Track new messages for persistence
    const newMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: input.prompt },
    ];

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

      // Extended thinking support
      if (input.thinking) {
        (apiParams as unknown as Record<string, unknown>).thinking = {
          type: 'enabled',
          budget_tokens: input.max_thinking_tokens ?? 10000,
        };
      }

      // Debug: dump full API request to file (enable via DUMP_PROMPTS env var)
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

      const assistantContentParts: string[] = [];
      const toolUseBlocks: ToolUseBlock[] = [];
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

      for await (const event of stream) {
        if (abortSignal?.aborted) break;

        switch (event.type) {
          case 'content_block_start': {
            const block = (event as any).content_block;
            if (block?.type === 'tool_use') {
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
              assistantContentParts.push(delta.text);
              onEvent({ type: 'text_delta', data: { text: delta.text } });
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
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
              toolUseBlocks.push({
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: parsedInput,
              });
              currentToolUse = null;
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
              totalUsage.output_tokens += usage.output_tokens ?? 0;
            }
            break;
          }

          case 'message_start': {
            const msgUsage = (event as any).message?.usage;
            if (msgUsage) {
              totalUsage.input_tokens += msgUsage.input_tokens ?? 0;
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

      // Build assistant message content for history
      const assistantText = assistantContentParts.join('');
      if (assistantText) finalText = assistantText;

      // Add assistant message to conversation
      const assistantContent = this.buildAssistantContent(assistantText, toolUseBlocks);
      messages.push({ role: 'assistant', content: assistantContent });
      newMessages.push({ role: 'assistant', content: assistantContent });

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

        const toolResults: ToolResultBlock[] = [];

        for (const block of toolUseBlocks) {
          // Handle AskUserQuestion specially
          if (block.name === 'AskUserQuestion') {
            onEvent({
              type: 'input_required',
              data: {
                type: 'ask_user_question',
                tool_use_id: block.id,
                questions: (block.input.questions as unknown[]) ?? [],
              },
            });
            onEvent({
              type: 'message_paused',
              data: {
                reason: 'waiting_for_user_input',
                resume_hint: 'POST /chat with input_response',
              },
            });

            // Wait for user response
            const userResponse = await waitForUserInput(block.id);

            const answersText = Object.entries(userResponse.answers)
              .map(([q, a]) => {
                const parts = [`"${q}" = "${a}"`];
                if (userResponse.annotations?.[q]?.notes) {
                  parts.push(`User note: ${userResponse.annotations[q].notes}`);
                }
                return parts.join(' ');
              })
              .join('\n');

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `User answered:\n${answersText}\n\nProceed based on the user's selections.`,
            });
          } else {
            // Normal tool execution
            const result = await executeTool(block, toolContext, this.mcpClientPool);
            toolResults.push(result);

            if (input.show_tool_use) {
              onEvent({
                type: 'tool_result',
                data: { tool: block.name, content: result.content },
              });
            }
          }
        }

        // Add tool results as user message
        const toolResultContent = toolResults.map((r) => JSON.stringify(r)).join('\n');
        messages.push({ role: 'user', content: toolResultContent });
        newMessages.push({ role: 'user', content: toolResultContent });
      } else {
        // No tool calls — conversation complete
        continueLoop = false;
      }

      // 8. Check token budget for compaction
      const estimatedTokens = estimateMessagesTokenCount(
        messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
      );
      if (estimatedTokens > config.COMPACTION_THRESHOLD) {
        const simpleMessages = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }));
        const compacted = await compactMessages(simpleMessages, this.anthropic);
        messages.length = 0;
        messages.push(...compacted);
      }
    }

    if (loopCount >= MAX_LOOPS) {
      stopReason = 'max_turns';
      logger.warn({ conversationId: input.conversationId }, 'Agent reached max loop count');
    }

    // Cleanup transient MCP connections
    await this.mcpClientPool.cleanupTransient();

    return {
      content: finalText,
      usage: totalUsage,
      stop_reason: stopReason,
      model,
      newMessages,
    };
  }

  private async buildToolList(
    perRequestServers?: Record<string, McpServerConfig>,
    perRequestContext?: Record<string, McpServerContext>,
  ): Promise<{
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    mcpWarnings: string[];
  }> {
    // Built-in tools
    const tools: Array<{
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
    }> = getAllToolDefinitions();

    // MCP tools — discover from managed + per-request servers
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

  private buildAssistantContent(text: string, toolUseBlocks: ToolUseBlock[]): string {
    if (toolUseBlocks.length === 0) return text;

    // Serialize both text and tool_use blocks for storage
    const parts: string[] = [];
    if (text) parts.push(text);
    for (const block of toolUseBlocks) {
      parts.push(`[tool_use: ${block.name}(${JSON.stringify(block.input)})]`);
    }
    return parts.join('\n');
  }
}
