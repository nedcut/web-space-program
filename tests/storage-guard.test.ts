import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('replaces a localStorage that throws on access (blocked site data) with session memory', async () => {
  const win = {} as Record<string, unknown>;
  Object.defineProperty(win, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  vi.stubGlobal('window', win);
  const { storageBlocked } = await import('../src/ui/storageGuard');
  expect(storageBlocked).toBe(true);
  const storage = win.localStorage as Storage;
  storage.setItem('a', '1');
  expect(storage.getItem('a')).toBe('1');
  expect(storage.length).toBe(1);
  expect(storage.key(0)).toBe('a');
  storage.removeItem('a');
  expect(storage.getItem('a')).toBeNull();
});

it('keeps a readable store even when it is full', async () => {
  const native = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  const win = { localStorage: native };
  vi.stubGlobal('window', win);
  const { storageBlocked } = await import('../src/ui/storageGuard');
  expect(storageBlocked).toBe(false);
  expect(win.localStorage).toBe(native);
});
