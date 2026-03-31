import type { Response } from 'express';
import type { StreamEvent } from '../types.js';

/**
 * SSE stream writer that sends events to the client.
 */
export class SseWriter {
  private closed = false;

  constructor(private res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }

  write(event: StreamEvent): void {
    if (this.closed) return;
    this.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Collect stream events for non-streaming responses.
 */
export class StreamCollector {
  private events: StreamEvent[] = [];
  private textParts: string[] = [];

  push(event: StreamEvent): void {
    this.events.push(event);
    if (event.type === 'text_delta') {
      this.textParts.push(event.data.text);
    }
  }

  getFullText(): string {
    return this.textParts.join('');
  }

  getEvents(): StreamEvent[] {
    return this.events;
  }

  getLastEvent(type: string): StreamEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === type) return this.events[i];
    }
    return undefined;
  }
}
