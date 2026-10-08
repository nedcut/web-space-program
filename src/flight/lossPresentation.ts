/** Wall time keeps the destruction visible independently of simulation warp or pause. */
export const LOSS_REPLAY_MS = 3500;
export function flightEndReady(lostAt: number | null, now: number): boolean {
  return lostAt === null || now - lostAt >= LOSS_REPLAY_MS;
}
export function scheduleFlightEnd(reveal: () => void): () => void {
  const timer = setTimeout(reveal, LOSS_REPLAY_MS);
  return () => clearTimeout(timer);
}
