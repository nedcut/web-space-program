/** Pure mixing/scheduling helpers; safe in headless simulation tests. */
export type MusicTheme = 'menu' | 'editor' | 'spaceCenter' | 'earthOrbit' | 'moon' | 'cruise' | 'saturn' | 'titan' | 'tense';
export interface MusicSituation { scene?: string; bodyId?: string; parentId?: string; reentryHeat?: number; landing?: boolean }
const finite = (v: number) => Number.isFinite(v) ? v : 0;
export function distanceGain(distance: number): number {
  return 1 / Math.sqrt(1 + Math.max(0, finite(distance)) / 100);
}
/** Positive radial velocity means the camera and vessel are separating. */
export function dopplerPitch(radialVelocity: number, pressure: number): number {
  if (pressure <= 1 || !Number.isFinite(pressure)) return 1;
  return Math.max(0.7, Math.min(1.4, 343 / (343 + Math.max(-240, Math.min(240, finite(radialVelocity))))));
}
export function selectTheme(s: MusicSituation): MusicTheme {
  if (s.scene === 'editor') return 'editor';
  if (s.scene === 'menu') return 'saturn';
  if (s.scene && s.scene !== 'flight' && s.scene !== 'tracking') return 'spaceCenter';
  if ((s.reentryHeat ?? 0) > 0.2 || s.landing) return 'tense';
  if (s.bodyId === 'titan') return 'titan';
  if (s.bodyId === 'saturn' || s.parentId === 'saturn') return 'saturn';
  if (s.bodyId === 'moon') return 'moon';
  if (s.bodyId === 'earth') return 'earthOrbit';
  return 'cruise';
}
/** Start at the actual current level, including when a transition interrupts another fade. */
export function crossfadeSchedule(now: number, duration: number, from: number, to: number) {
  const start = Math.max(0, finite(now));
  const clamp = (v: number) => Math.max(0, Math.min(1, finite(v)));
  return [{ time: start, gain: clamp(from) }, { time: start + Math.max(0.02, finite(duration)), gain: clamp(to) }];
}
export const THEMES: Record<MusicTheme, { root: number; chords: number[][]; interval: number; duration: number; shimmer: boolean }> = {
  editor: { root: 110, chords: [[0, 7, 16], [5, 12, 19], [2, 9, 14]], interval: 9, duration: 16, shimmer: false },
  menu: { root: 146.832, chords: [[0, 7, 14], [2, 9, 16]], interval: 6, duration: 12, shimmer: false },
  spaceCenter: { root: 130.813, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14]], interval: 6, duration: 11, shimmer: false },
  earthOrbit: { root: 97.999, chords: [[0, 7, 14], [4, 11, 16]], interval: 8, duration: 15, shimmer: true },
  moon: { root: 73.416, chords: [[0, 7, 19], [5, 12, 21]], interval: 9, duration: 17, shimmer: true },
  cruise: { root: 65.406, chords: [[0, 7, 14], [2, 9, 16], [4, 12, 19]], interval: 10, duration: 18, shimmer: false },
  saturn: { root: 55, chords: [[0, 7, 14, 21], [5, 12, 19, 26], [2, 9, 16, 23]], interval: 12, duration: 22, shimmer: true },
  titan: { root: 43.654, chords: [[0, 3, 10], [5, 8, 15]], interval: 10, duration: 19, shimmer: false },
  tense: { root: 82.407, chords: [[0, 3, 7], [0, 5, 8], [2, 5, 9]], interval: 4, duration: 8, shimmer: false },
};
