/**
 * Rough token count estimator.
 * Uses a simple heuristic: ~4 characters per token for English,
 * ~2 characters per token for CJK text.
 * Accuracy target: within 15% of actual token count.
 */
export function estimateTokenCount(text: string): number {
  // Count CJK characters
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || [])
    .length;
  const nonCjkLength = text.length - cjkCount;

  // CJK: ~1.5 tokens per character, ASCII: ~0.25 tokens per character
  return Math.ceil(cjkCount * 1.5 + nonCjkLength * 0.25);
}

/**
 * Estimate token count for a messages array (JSON-serialized).
 */
export function estimateMessagesTokenCount(
  messages: Array<{ role: string; content: string | unknown[] }>,
): number {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    total += estimateTokenCount(content);
    total += 4; // overhead per message (role, delimiters)
  }
  return total;
}
