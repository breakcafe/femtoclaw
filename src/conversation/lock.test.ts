import { describe, it, expect } from 'vitest';
import { ConversationLock, ConversationBusyError } from './lock.js';

describe('ConversationLock', () => {
  it('should acquire and release a lock', async () => {
    const lock = new ConversationLock();
    const release = await lock.acquire('conv-1');
    expect(typeof release).toBe('function');
    release();
  });

  it('should throw ConversationBusyError when lock is held (wait=false)', async () => {
    const lock = new ConversationLock();
    const release = await lock.acquire('conv-1');

    await expect(lock.acquire('conv-1', { wait: false })).rejects.toThrow(
      ConversationBusyError,
    );

    release();
  });

  it('should allow locking different conversations in parallel', async () => {
    const lock = new ConversationLock();
    const release1 = await lock.acquire('conv-1');
    const release2 = await lock.acquire('conv-2');

    expect(typeof release1).toBe('function');
    expect(typeof release2).toBe('function');

    release1();
    release2();
  });

  it('should queue and resolve when wait=true', async () => {
    const lock = new ConversationLock();
    const release1 = await lock.acquire('conv-1');

    let secondAcquired = false;
    const secondPromise = lock.acquire('conv-1', { wait: true }).then((release) => {
      secondAcquired = true;
      return release;
    });

    // Second acquire should be waiting
    await new Promise((r) => setTimeout(r, 10));
    expect(secondAcquired).toBe(false);

    // Release first lock
    release1();

    // Second should now acquire
    const release2 = await secondPromise;
    expect(secondAcquired).toBe(true);
    release2();
  });
});
