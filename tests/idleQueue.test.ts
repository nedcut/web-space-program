import { expect, it, vi } from 'vitest';
import { enqueueIdle } from '../src/util/idleQueue';
it('cancels stale preview jobs and serializes asynchronous renderer users', async () => {
  vi.useFakeTimers();
  try {
    const order: string[] = [];
    const cancel = enqueueIdle(() => { order.push('stale'); }); cancel();
    enqueueIdle(async () => { order.push('first'); await new Promise(r => setTimeout(r, 100)); order.push('encoded'); });
    enqueueIdle(() => { order.push('second'); });
    await vi.advanceTimersByTimeAsync(33);
    expect(order).toEqual(['first']);
    await vi.runAllTimersAsync();
    expect(order).toEqual(['first', 'encoded', 'second']);
  } finally { vi.useRealTimers(); }
});
