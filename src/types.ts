// ─── User Context ───

export interface UserContext {
  userId: string;
  displayName?: string;
  timezone?: string;
  locale?: string;
  metadata?: Record<string, string>;
}

// ─── Conversation ───

export interface Conversation {
  id: string;
  userId: string;
  status: 'idle' | 'running';
  messageCount: number;
  createdAt: string;
  lastActivity: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  sender?: string;
  senderName?: string;
  content: string;
  createdAt: string;
}

// ─── Memory ───

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  key: string;
  type: MemoryType;
  description: string;
  value: string;
  tags?: string[];
  updatedAt: string;
  source: 'agent' | 'user';
}

export type MemoryEntrySummary = Omit<MemoryEntry, 'value'>;

export interface WriteMemoryInput {
  key: string;
  value: string;
  type: MemoryType;
  description: string;
  tags?: string[];
}

// ─── Skills ───

export interface SkillDefinition {
  name: string;
  description: string;
  /** When this skill should be invoked — shown in listing alongside description. */
  whenToUse?: string;
  /** Hint for argument format (e.g., "-m 'message'"). */
  argumentHint?: string;
  /** Alternative names the agent can use to invoke this skill. */
  aliases?: string[];
  /** Trigger keywords for intent matching (femtoclaw extension, compatible). */
  triggers: string[];
  /** Safety warnings derived from the skill body. */
  safetyWarnings?: string[];
  /** Full SKILL.md content returned when skill is invoked. */
  content: string;
  source: 'builtin' | 'org' | 'user';
}

export interface SkillManifestEntry {
  name: string;
  description: string;
  whenToUse?: string;
  triggers: string[];
  safetyWarnings?: string[];
}

// ─── MCP ───

export interface McpServerConfig {
  type?: 'http' | 'sse' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  auth?: {
    header?: string;
    scheme?: string;
    token?: string;
  };
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerContext {
  headers?: Record<string, string>;
  env?: Record<string, string>;
  args?: string[];
}

// ─── Tool ───

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  requiresUserInteraction?: boolean;
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;
}

export interface ToolExecutionContext {
  conversationId: string;
  userId: string;
  onStreamEvent: (event: StreamEvent) => void;
  waitForUserInput: (toolUseId: string) => Promise<InputResponse>;
  skillManager: SkillManagerInterface;
  memoryService: MemoryServiceInterface;
}

export interface ToolResult {
  type?: 'text' | 'error';
  text?: string;
  error?: string;
  content?: string;
}

// ─── Interactive Questions ───

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

// ─── Streaming ───

export type StreamEvent =
  | { type: 'message_start'; data: { conversation_id: string; message_id: string } }
  | { type: 'text_delta'; data: { text: string } }
  | { type: 'thinking_delta'; data: { thinking: string } }
  | { type: 'tool_use'; data: { tool: string; input: unknown } }
  | { type: 'tool_result'; data: { tool: string; content: unknown } }
  | {
      type: 'input_required';
      data: { type: string; tool_use_id: string; questions: AskUserQuestionItem[] };
    }
  | { type: 'message_paused'; data: { reason: string; resume_hint?: string } }
  | { type: 'message_complete'; data: { usage?: TokenUsage; stop_reason?: string } }
  | { type: 'error'; data: { error: string; code?: string } };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

// ─── Chat API ───

export interface ChatRequest {
  message?: string;
  conversation_id?: string;
  sender?: string;
  sender_name?: string;
  stream?: boolean;
  model?: string;
  max_execution_ms?: number;
  thinking?: boolean;
  max_thinking_tokens?: number;
  show_tool_use?: boolean;
  mcp_servers?: Record<string, McpServerConfig>;
  mcp_context?: Record<string, McpServerContext>;
  /** Per-request tool allowlist. Overrides server-level ALLOWED_TOOLS for this request. */
  allowed_tools?: string[];
  timezone?: string;
  locale?: string;
  device_type?: string;
  metadata?: Record<string, unknown>;
  input_response?: InputResponse;
}

export interface InputResponse {
  tool_use_id: string;
  answers: Record<string, string>;
  annotations?: Record<string, { notes?: string }>;
}

export interface ChatResponse {
  status: 'success' | 'timeout' | 'error' | 'awaiting_input';
  conversation_id: string;
  message_id: string;
  content?: string;
  usage?: TokenUsage;
  stop_reason?: string;
  model?: string;
  input_required?: {
    type: string;
    tool_use_id: string;
    questions: AskUserQuestionItem[];
    timeout_ms: number;
  };
  error?: string;
  duration_ms?: number;
}

// ─── Service Interfaces ───

export interface SkillManagerInterface {
  getSkill(name: string, userId?: string): SkillDefinition | undefined;
  getSkillManifest(userId?: string): SkillManifestEntry[];
  listSkillNames(): string[];
}

export interface MemoryServiceInterface {
  listMemories(userId: string, category?: MemoryType): Promise<MemoryEntrySummary[]>;
  readMemory(userId: string, key?: string): Promise<MemoryEntry | MemoryEntry[]>;
  writeMemory(userId: string, input: WriteMemoryInput): Promise<void>;
  deleteMemory(userId: string, key: string): Promise<void>;
  searchMemory(userId: string, query: string, category?: MemoryType): Promise<MemoryEntrySummary[]>;
}
