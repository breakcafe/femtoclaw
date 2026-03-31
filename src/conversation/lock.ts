interface LockEntry {
  running: boolean;
  queue: Array<{ resolve: () => void; reject: (err: Error) => void }>;
}

export class ConversationLock {
  private locks = new Map<string, LockEntry>();

  /**
   * Acquire lock for a conversation.
   * @param wait If true, queue and wait. If false, reject immediately when busy.
   * @returns A release function.
   */
  async acquire(conversationId: string, options?: { wait?: boolean }): Promise<() => void> {
    let entry = this.locks.get(conversationId);
    if (!entry) {
      entry = { running: false, queue: [] };
      this.locks.set(conversationId, entry);
    }

    if (!entry.running) {
      entry.running = true;
      return () => this.release(conversationId);
    }

    // Already running
    if (!options?.wait) {
      throw new ConversationBusyError(conversationId);
    }

    // Queue and wait
    return new Promise<() => void>((resolve, reject) => {
      entry!.queue.push({
        resolve: () => resolve(() => this.release(conversationId)),
        reject,
      });
    });
  }

  private release(conversationId: string): void {
    const entry = this.locks.get(conversationId);
    if (!entry) return;

    const next = entry.queue.shift();
    if (next) {
      next.resolve();
    } else {
      entry.running = false;
      if (entry.queue.length === 0) {
        this.locks.delete(conversationId);
      }
    }
  }
}

export class ConversationBusyError extends Error {
  public readonly conversationId: string;
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} is currently busy`);
    this.name = 'ConversationBusyError';
    this.conversationId = conversationId;
  }
}
