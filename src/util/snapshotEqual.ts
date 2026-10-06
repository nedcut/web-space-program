/** Equality for small plain telemetry snapshots (including NaN). Never use for React elements. */
export function snapshotEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  const keys = Object.keys(aa);
  return keys.length === Object.keys(bb).length && keys.every(k => Object.hasOwn(bb, k) && snapshotEqual(aa[k], bb[k]));
}

/**
 * Structural sharing for telemetry snapshots: top-level fields of `next` that equal the previous snapshot's are
 * replaced by the previous objects, so memoised HUD components see unchanged references and skip rendering.
 */
export function shareUnchanged<T extends object>(next: T, prev: T | null | undefined): T {
  if (!prev) return next;
  const n = next as Record<string, unknown>, p = prev as Record<string, unknown>;
  for (const k of Object.keys(n)) if (n[k] !== p[k] && typeof n[k] === 'object' && snapshotEqual(n[k], p[k])) n[k] = p[k];
  return next;
}
