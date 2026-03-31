export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpTextContent {
  type: 'text';
  text?: string;
}

export interface McpImageContent {
  type: 'image';
  data?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  type: 'resource';
  resource?: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

export interface McpResourceLinkContent {
  type: 'resource_link';
  uri: string;
  name: string;
  description?: string;
}

export interface McpCallToolResult {
  content: Array<McpTextContent | McpImageContent | McpResourceContent | McpResourceLinkContent>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
