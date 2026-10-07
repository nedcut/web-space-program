/** Browser storage write failures (full quota, private mode, blocked site data). Saves must never crash the game. */
export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: unknown; code?: unknown } | null;
  return !!err && typeof err === 'object' && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014);
}
/** DOMExceptions come from the storage APIs themselves (quota, SecurityError when site data is blocked…). */
export function isStorageError(e: unknown): boolean {
  return isQuotaError(e) || (typeof DOMException !== 'undefined' && e instanceof DOMException);
}
export interface SaveFailure { text: string; hint: string }
export function saveFailure(e: unknown): SaveFailure {
  return isQuotaError(e)
    ? { text: 'Couldn’t save — storage is full', hint: 'Delete old saves (Main menu → Continue) or vehicles you no longer need, or export a save file to keep it. Progress is kept for this session.' }
    : { text: 'Couldn’t save — browser storage is unavailable', hint: 'Private browsing or blocked site data can prevent saving. Progress is kept for this session.' };
}
/** One-line message for inline UI; validation errors (bad names, invalid files) keep their own text. */
export function saveErrorText(e: unknown): string {
  if (!isStorageError(e)) return e instanceof Error ? e.message : String(e);
  const f = saveFailure(e);
  return `${f.text}. ${f.hint}`;
}
