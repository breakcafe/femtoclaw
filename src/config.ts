export interface Config {
  // Server
  PORT: number;
  API_TOKEN: string;
  LOG_LEVEL: string;
  DEFAULT_TIMEZONE: string;

  // Anthropic
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL: string;
  DEFAULT_MODEL: string;
  FALLBACK_MODEL: string;
  MAX_OUTPUT_TOKENS: number;
  MAX_EXECUTION_MS: number;

  // Agent
  ASSISTANT_NAME: string;
  COMPACTION_THRESHOLD: number;

  // Memory
  MEMORY_SERVICE_TYPE: 'sqlite' | 'mcp' | 'api';
  MEMORY_SERVICE_URL: string;
  MEMORY_SERVICE_API_KEY: string;
  MEMORY_MCP_SERVER: string;
  MAX_MEMORY_ENTRIES_PER_USER: number;
  MAX_MEMORY_VALUE_LENGTH: number;
  MAX_MEMORY_INDEX_IN_PROMPT: number;
  MEMORY_TOKEN_BUDGET: number;

  // Conversation Store
  CONVERSATION_STORE_TYPE: 'sqlite' | 'api';
  CONVERSATION_STORE_URL: string;
  CONVERSATION_STORE_API_KEY: string;
  CONVERSATION_IDLE_TIMEOUT_SECONDS: number;
  SQLITE_DB_PATH: string;

  // Skills
  BUILTIN_SKILLS_DIR: string;
  ORG_SKILLS_URL: string;
  USER_SKILLS_DIR: string;

  // MCP
  MANAGED_MCP_CONFIG: string;

  // Org
  ORG_INSTRUCTIONS_PATH: string;

  // Rate Limiting
  RATE_LIMIT_RPM: number;

  // AskUserQuestion
  INPUT_TIMEOUT_MS: number;

  // Feature toggles
  ENABLE_MCP: boolean;
  TRACE_ENABLED: boolean;
  TRACE_ENDPOINT: string;
  TRACE_API_KEY: string;
  TRACE_BATCH_SIZE: number;
  TRACE_FLUSH_INTERVAL_MS: number;
  TRACE_QUEUE_MAX: number;
  TRACE_TIMEOUT_MS: number;
  TRACE_INCLUDE_THINKING: 'off' | 'summary' | 'full';
  TRACE_THINKING_MAX_CHARS: number;

  /**
   * When true, requests without X-User-Id header are rejected with 400.
   * When false (default), missing X-User-Id falls back to 'anonymous'.
   * Production deployments should set this to true.
   */
  REQUIRE_USER_ID: boolean;

  /**
   * Allowed built-in tools.
   * Comma-separated list or "*" for all. Tools not in this list are hidden
   * from Claude (it won't see or invoke them). The executor still recognizes
   * them so existing conversations with tool_use history won't break.
   *
   * Env: ALLOWED_TOOLS="Skill,Memory,WebFetch"  — only these 3 visible
   *      ALLOWED_TOOLS="*"                       — all tools (default)
   *
   * Also settable per-request via POST /chat { allowed_tools: [...] }
   */
  ALLOWED_TOOLS: string;
}

function env(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

export const config: Config = {
  PORT: envInt('PORT', 9000),
  API_TOKEN: env('API_TOKEN'),
  LOG_LEVEL: env('LOG_LEVEL', 'info'),
  DEFAULT_TIMEZONE: env('DEFAULT_TIMEZONE', 'UTC'),

  ANTHROPIC_API_KEY: env('ANTHROPIC_API_KEY', env('X_API_KEY', env('API_KEY'))),
  ANTHROPIC_BASE_URL: env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
  DEFAULT_MODEL: env('DEFAULT_MODEL', 'claude-sonnet-4-20250514'),
  FALLBACK_MODEL: env('FALLBACK_MODEL'),
  MAX_OUTPUT_TOKENS: envInt('MAX_OUTPUT_TOKENS', 16384),
  MAX_EXECUTION_MS: envInt('MAX_EXECUTION_MS', 300000),

  ASSISTANT_NAME: env('ASSISTANT_NAME', 'Femtoclaw'),
  COMPACTION_THRESHOLD: envInt('COMPACTION_THRESHOLD', 160000),

  MEMORY_SERVICE_TYPE: env('MEMORY_SERVICE_TYPE', 'sqlite') as Config['MEMORY_SERVICE_TYPE'],
  MEMORY_SERVICE_URL: env('MEMORY_SERVICE_URL'),
  MEMORY_SERVICE_API_KEY: env('MEMORY_SERVICE_API_KEY'),
  MEMORY_MCP_SERVER: env('MEMORY_MCP_SERVER', 'memory'),
  MAX_MEMORY_ENTRIES_PER_USER: envInt('MAX_MEMORY_ENTRIES_PER_USER', 200),
  MAX_MEMORY_VALUE_LENGTH: envInt('MAX_MEMORY_VALUE_LENGTH', 2000),
  MAX_MEMORY_INDEX_IN_PROMPT: envInt('MAX_MEMORY_INDEX_IN_PROMPT', 50),
  MEMORY_TOKEN_BUDGET: envInt('MEMORY_TOKEN_BUDGET', 6000),

  CONVERSATION_STORE_TYPE: env(
    'CONVERSATION_STORE_TYPE',
    'sqlite',
  ) as Config['CONVERSATION_STORE_TYPE'],
  CONVERSATION_STORE_URL: env('CONVERSATION_STORE_URL'),
  CONVERSATION_STORE_API_KEY: env('CONVERSATION_STORE_API_KEY'),
  CONVERSATION_IDLE_TIMEOUT_SECONDS: envInt('CONVERSATION_IDLE_TIMEOUT_SECONDS', 1800),
  SQLITE_DB_PATH: env('SQLITE_DB_PATH', './data/femtoclaw.db'),

  BUILTIN_SKILLS_DIR: env('BUILTIN_SKILLS_DIR', './skills/builtin'),
  ORG_SKILLS_URL: env('ORG_SKILLS_URL'),
  USER_SKILLS_DIR: env('USER_SKILLS_DIR', './skills/user'),

  MANAGED_MCP_CONFIG: env('MANAGED_MCP_CONFIG', '/app/org/managed-mcp.json'),

  ORG_INSTRUCTIONS_PATH: env('ORG_INSTRUCTIONS_PATH', '/app/org/claude.md'),

  RATE_LIMIT_RPM: envInt('RATE_LIMIT_RPM', 60),

  INPUT_TIMEOUT_MS: envInt('INPUT_TIMEOUT_MS', 300000),

  ENABLE_MCP: env('ENABLE_MCP', 'true') === 'true',
  TRACE_ENABLED: env('TRACE_ENABLED', 'true') === 'true',
  TRACE_ENDPOINT: env('TRACE_ENDPOINT', 'http://kapivault:80/trace/events'),
  TRACE_API_KEY: env('TRACE_API_KEY'),
  TRACE_BATCH_SIZE: envInt('TRACE_BATCH_SIZE', 50),
  TRACE_FLUSH_INTERVAL_MS: envInt('TRACE_FLUSH_INTERVAL_MS', 500),
  TRACE_QUEUE_MAX: envInt('TRACE_QUEUE_MAX', 5000),
  TRACE_TIMEOUT_MS: envInt('TRACE_TIMEOUT_MS', 1500),
  TRACE_INCLUDE_THINKING: env(
    'TRACE_INCLUDE_THINKING',
    'summary',
  ) as Config['TRACE_INCLUDE_THINKING'],
  TRACE_THINKING_MAX_CHARS: envInt('TRACE_THINKING_MAX_CHARS', 2000),
  REQUIRE_USER_ID: env('REQUIRE_USER_ID', 'false') === 'true',
  ALLOWED_TOOLS: env('ALLOWED_TOOLS', '*'),
};
