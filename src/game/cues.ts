/** Pure feedback policies; callers supply state and clocks, never alter simulation decisions. */
export interface StageCueInput {
  locked: boolean; control: boolean; eva: boolean; remaining: boolean;
  useful: boolean; engines: boolean; fuel: boolean;
}
export function whyCantStage(i: StageCueInput): string | null {
  if (i.locked) return 'Staging is locked — unlock staging first';
  if (!i.control) return 'Cannot stage: no control source or probe signal';
  if (i.eva) return 'An astronaut has no stages';
  if (!i.remaining) return 'No stages remaining';
  if (!i.useful && !i.engines) return 'This stage has no engines, separators or parachutes';
  if (!i.useful && i.engines && !i.fuel) return 'This stage’s engines have no reachable propellant';
  return null;
}
export function whyCantWarp(i: { thrusting: boolean; inAtmosphere: boolean; landed: boolean; nearSoi?: boolean; accelerating?: boolean }): string | null {
  if (i.nearSoi) return 'Time warp stopped: approaching a sphere-of-influence change';
  if (i.thrusting) return 'Rails warp unavailable while thrusting — cut throttle or use physics warp';
  if (i.accelerating) return 'Rails warp unavailable under acceleration — use physics warp';
  if (i.inAtmosphere && !i.landed) return 'Rails warp unavailable in atmosphere — physics warp is available';
  return null;
}
export interface CueMessage { id: number; text: string; level: 'info' | 'warn' | 'bad'; expires: number }
/** Bounded stack, deduplicated against recent history even after manual dismissal. */
export function enqueueNotification(live: readonly CueMessage[], recent: ReadonlyMap<string, number>, message: CueMessage, now: number) {
  const key = `${message.level}:${message.text}`;
  const history = new Map([...recent].filter(([, time]) => now - time < 8000));
  const messages = live.filter(m => m.expires > now);
  if (history.has(key)) return { messages, history };
  history.set(key, now);
  return { messages: [...messages, message].slice(-4), history };
}
