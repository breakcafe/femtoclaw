import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ServerDeps } from '../server.js';
import { AgentEngine, type AgentRunInput } from '../agent/engine.js';
import { SseWriter, StreamCollector } from '../agent/stream.js';
import { ConversationBusyError, ConversationNotFoundError } from '../conversation/manager.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { ChatRequest, StreamEvent, ChatResponse } from '../types.js';

const chatRequestSchema = z.object({
  message: z.string().optional(),
  conversation_id: z.string().optional(),
  sender: z.string().optional(),
  sender_name: z.string().optional(),
  stream: z.boolean().optional(),
  model: z.string().optional(),
  max_execution_ms: z.number().positive().optional(),
  thinking: z.boolean().optional(),
  max_thinking_tokens: z.number().positive().optional(),
  show_tool_use: z.boolean().optional(),
  mcp_servers: z.record(z.any()).optional(),
  mcp_context: z.record(z.any()).optional(),
  allowed_tools: z.array(z.string()).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  device_type: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  input_response: z
    .object({
      tool_use_id: z.string(),
      answers: z.record(z.string()),
      annotations: z.record(z.object({ notes: z.string().optional() })).optional(),
    })
    .optional(),
});

export function chatRoutes(deps: ServerDeps): Router {
  const router = Router();
  const { conversationManager, skillManager, memoryService, mcpClientPool } = deps;
  const agentEngine = new AgentEngine(skillManager, memoryService, mcpClientPool);

  // POST /chat — Send message / continue conversation
  router.post('/chat', async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const body = parsed.data as ChatRequest;
    const userId = req.userContext?.userId ?? 'anonymous';
    const messageId = `msg-${randomUUID()}`;
    const pausedInput = body.conversation_id
      ? conversationManager.getPausedInput(body.conversation_id)
      : null;

    if (body.input_response) {
      if (!body.conversation_id) {
        res.status(400).json({ error: 'conversation_id required for input_response' });
        return;
      }

      if (!pausedInput) {
        try {
          conversationManager.submitUserInput(body.conversation_id, body.input_response);
          res.json({ status: 'accepted', conversation_id: body.conversation_id });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(400).json({ error: message });
        }
        return;
      }
    }

    if (!body.message && !body.input_response) {
      res.status(400).json({ error: 'message or input_response is required' });
      return;
    }

    // Get or create conversation
    let conversation;
    try {
      conversation = await conversationManager.getOrCreateConversation(
        userId,
        body.conversation_id,
      );
    } catch (err) {
      if (err instanceof ConversationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Acquire lock
    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = await conversationManager.acquireLock(conversation.id);
    } catch (err) {
      if (err instanceof ConversationBusyError) {
        res.status(409).json({ error: 'Conversation is currently busy' });
        return;
      }
      throw err;
    }

    const timeoutMs = Math.min(
      body.max_execution_ms ?? config.MAX_EXECUTION_MS,
      config.MAX_EXECUTION_MS,
    );
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      await conversationManager.setStatus(conversation.id, 'running');

      // Load existing messages
      const existingMsgs = await conversationManager.getMessages(conversation.id);
      const existingMessages = existingMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const resumeInputResponse = body.input_response
        ? conversationManager.consumePausedInput(conversation.id, body.input_response)
        : undefined;

      const agentInput: AgentRunInput = {
        prompt: body.message ?? '',
        conversationId: conversation.id,
        userId,
        messageId,
        model: body.model,
        assistantName: config.ASSISTANT_NAME,
        timezone: body.timezone ?? req.userContext?.timezone,
        locale: body.locale ?? req.userContext?.locale,
        device_type: body.device_type,
        thinking: body.thinking,
        max_thinking_tokens: body.max_thinking_tokens,
        show_tool_use: body.show_tool_use,
        mcp_servers: body.mcp_servers,
        mcp_context: body.mcp_context,
        allowed_tools: body.allowed_tools,
        metadata: body.metadata,
        existingMessages,
        resumeInputResponse,
        pauseOnInput: true,
      };

      const isStreaming = body.stream !== false;
      const startTime = Date.now();

      if (isStreaming) {
        const sseWriter = new SseWriter(res);

        sseWriter.write({
          type: 'message_start',
          data: { conversation_id: conversation.id, message_id: messageId },
        });

        const result = await agentEngine.run(
          agentInput,
          (event: StreamEvent) => sseWriter.write(event),
          (toolUseId: string) => conversationManager.waitForUserInput(conversation.id, toolUseId),
          abortController.signal,
        );

        // Persist messages
        await persistMessages(conversationManager, conversation.id, body, result, userId);

        if (result.awaiting_input) {
          conversationManager.registerPausedInput(
            conversation.id,
            result.awaiting_input.tool_use_id,
            result.awaiting_input.questions,
          );
          sseWriter.end();
          return;
        }

        sseWriter.write({
          type: 'message_complete',
          data: {
            usage: result.usage,
            stop_reason: result.stop_reason,
          },
        });
        sseWriter.end();
      } else {
        // Non-streaming
        const collector = new StreamCollector();

        const result = await agentEngine.run(
          agentInput,
          (event: StreamEvent) => collector.push(event),
          (toolUseId: string) => conversationManager.waitForUserInput(conversation.id, toolUseId),
          abortController.signal,
        );

        // Persist messages
        await persistMessages(conversationManager, conversation.id, body, result, userId);

        const durationMs = Date.now() - startTime;

        if (result.awaiting_input) {
          conversationManager.registerPausedInput(
            conversation.id,
            result.awaiting_input.tool_use_id,
            result.awaiting_input.questions,
          );

          const response: ChatResponse = {
            status: 'awaiting_input',
            conversation_id: conversation.id,
            message_id: messageId,
            input_required: result.awaiting_input,
            duration_ms: durationMs,
          };

          res.status(202).json(response);
          return;
        }

        const response: ChatResponse = {
          status: abortController.signal.aborted ? 'timeout' : 'success',
          conversation_id: conversation.id,
          message_id: messageId,
          content: result.content,
          usage: result.usage,
          stop_reason: result.stop_reason,
          model: result.model,
          duration_ms: durationMs,
        };

        res.json(response);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, conversationId: conversation.id }, 'Agent execution error');

      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          conversation_id: conversation.id,
          message_id: messageId,
          error: message,
        });
      } else if (res.getHeader('Content-Type')?.toString().includes('text/event-stream')) {
        // SSE stream already started — send error event and close
        const sseError = `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`;
        res.write(sseError);
        res.end();
      }
    } finally {
      clearTimeout(timeoutHandle);
      await conversationManager.setStatus(conversation.id, 'idle');
      releaseLock?.();
    }
  });

  // GET /chat — List conversations
  router.get('/chat', async (req: Request, res: Response) => {
    const userId = req.userContext?.userId ?? 'anonymous';
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const conversations = await conversationManager.listConversations(userId, { limit, offset });
    res.json({ conversations });
  });

  // GET /chat/:id — Get conversation metadata
  router.get('/chat/:id', async (req: Request, res: Response) => {
    const userId = req.userContext?.userId ?? 'anonymous';
    const convId = req.params.id as string;
    const conversation = await conversationManager.getConversation(convId, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  });

  // GET /chat/:id/messages — Get conversation messages
  router.get('/chat/:id/messages', async (req: Request, res: Response) => {
    const userId = req.userContext?.userId ?? 'anonymous';
    const convId = req.params.id as string;
    const conversation = await conversationManager.getConversation(convId, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 100;
    const rawMessages = await conversationManager.getMessages(convId, { limit });

    // Deserialize content from JSON ContentBlock[] for API response
    const messages = rawMessages.map((m) => {
      let content: unknown;
      try {
        content = JSON.parse(m.content);
      } catch {
        content = m.content; // legacy plain text
      }
      return { ...m, content };
    });

    res.json({ conversation_id: convId, messages });
  });

  // DELETE /chat/:id — Delete conversation
  router.delete('/chat/:id', async (req: Request, res: Response) => {
    const userId = req.userContext?.userId ?? 'anonymous';
    const convId = req.params.id as string;
    const conversation = await conversationManager.getConversation(convId, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (conversation.status === 'running') {
      res.status(409).json({ error: 'Cannot delete a running conversation' });
      return;
    }
    await conversationManager.deleteConversation(convId, userId);
    res.status(204).end();
  });

  return router;
}

/**
 * Persist all new messages from the agent run.
 *
 * Each message's content is JSON-serialized ContentBlock[] — the full Anthropic
 * Messages API format including text, tool_use, and tool_result blocks.
 * This ensures multi-turn tool calling context is preserved across requests.
 */
async function persistMessages(
  manager: any,
  conversationId: string,
  body: ChatRequest,
  result: any,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const msgsToStore = [];

  for (const msg of result.newMessages as Array<{ role: string; content: string }>) {
    msgsToStore.push({
      conversationId,
      role: msg.role as 'user' | 'assistant',
      sender: msg.role === 'user' ? (body.sender ?? userId) : config.ASSISTANT_NAME,
      senderName: msg.role === 'user' ? body.sender_name : config.ASSISTANT_NAME,
      content: msg.content, // JSON-serialized ContentBlock[]
      createdAt: now,
    });
  }

  if (msgsToStore.length > 0) {
    await manager.appendMessages(conversationId, msgsToStore);
  }
}
