import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface TraceEvent {
  trace_id: string;
  event_type: string;
  service?: string;
  ts?: string;
  request_id?: string;
  conversation_id?: string;
  user_id?: string;
  message_id?: string;
  payload?: Record<string, unknown>;
}

export interface TraceSink {
  emit(event: TraceEvent): void;
  close(): Promise<void>;
}

export class NoopTraceSink implements TraceSink {
  emit(_event: TraceEvent): void {
    // no-op
  }

  async close(): Promise<void> {
    // no-op
  }
}

export class AsyncHttpTraceSink implements TraceSink {
  private readonly queue: TraceEvent[] = [];
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly queueMax: number;
  private readonly timeoutMs: number;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private droppedCount = 0;

  constructor() {
    this.endpoint = config.TRACE_ENDPOINT;
    this.apiKey = config.TRACE_API_KEY;
    this.batchSize = Math.max(1, config.TRACE_BATCH_SIZE);
    this.flushIntervalMs = Math.max(50, config.TRACE_FLUSH_INTERVAL_MS);
    this.queueMax = Math.max(100, config.TRACE_QUEUE_MAX);
    this.timeoutMs = Math.max(100, config.TRACE_TIMEOUT_MS);

    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  emit(event: TraceEvent): void {
    if (!event.trace_id || !event.event_type) {
      return;
    }
    if (this.queue.length >= this.queueMax) {
      this.droppedCount += 1;
      if (this.droppedCount % 100 === 1) {
        logger.warn(
          { droppedCount: this.droppedCount, queueMax: this.queueMax },
          'Trace queue full; dropping events',
        );
      }
      return;
    }
    const normalized: TraceEvent = {
      ...event,
      service: event.service ?? 'femtoclaw',
      ts: event.ts ?? new Date().toISOString(),
    };
    this.queue.push(normalized);
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        try {
          await this.postBatch(batch);
        } catch (err) {
          logger.warn(
            {
              err,
              endpoint: this.endpoint,
              batchSize: batch.length,
              queueRemaining: this.queue.length,
            },
            'Trace batch post failed; dropping batch',
          );
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async postBatch(batch: TraceEvent[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${resp.statusText} ${text}`.trim());
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createTraceSink(): TraceSink {
  if (!config.TRACE_ENABLED || !config.TRACE_ENDPOINT) {
    return new NoopTraceSink();
  }
  logger.info(
    {
      endpoint: config.TRACE_ENDPOINT,
      batchSize: config.TRACE_BATCH_SIZE,
      flushIntervalMs: config.TRACE_FLUSH_INTERVAL_MS,
      queueMax: config.TRACE_QUEUE_MAX,
    },
    'Trace sink enabled',
  );
  return new AsyncHttpTraceSink();
}
