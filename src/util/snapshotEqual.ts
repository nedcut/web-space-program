/** Equality for small plain telemetry snapshots (including NaN). Never use for React elements. */
export function snapshotEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  const keys = Object.keys(aa);
  return keys.length === Object.keys(bb).length && keys.every(k => Object.hasOwn(bb, k) && snapshotEqual(aa[k], bb[k]));
}
