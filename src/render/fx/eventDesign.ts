/** Pure, bounded event sizing; render feedback never changes the simulation. */
export function explosionDiameter(mass: number, propellant: number, diameter: number): number {
  return Math.min(70, Math.max(3 * diameter, 3 + Math.cbrt(Math.max(0, mass) + 8 * Math.max(0, propellant)) * 1.1));
}
export function separationPunch(impulse: number): number {
  return Math.min(1.5, .65 + Math.sqrt(Math.max(0, impulse) / 2000) * .35);
}
export function impactPunch(mass: number, speed: number): number {
  return Math.min(1.5, .35 + Math.sqrt(Math.max(0, mass) * speed * speed / 2e6));
}
/** Brief hull shudder on a crossflow warning; reuse the existing accessible camera-event path. */
export function structuralStressPunch(stress: number): number {
  return Math.min(.25, .08 * Math.max(0, stress));
}
/** Peak opacity of an ascent smoke column by propellant: solids are dense white, clean fuels a faint vapour. */
export const TRAIL_OPACITY: Readonly<Record<string, number>> = { solid: 1, kerolox: .75, methalox: .55, hydrolox: .35, monoprop: .2 };
export interface TrailStyle { life: number; size: number; growth: number; opacity: number }
/**
 * Render-only shape of an ascent smoke column deposited in air of `density` kg/m³ by `thrust` N, written into
 * `out` (called every frame; no allocation). Thin air dissipates and spreads smoke faster; it fades out towards vacuum.
 */
export function trailStyle(thrust: number, density: number, solidShare: number, out: TrailStyle = { life: 0, size: 0, growth: 0, opacity: 0 }): TrailStyle {
  const air = Math.sqrt(Math.min(1, Math.max(0, density) / 1.225));
  const fade = Math.min(1, Math.max(0, (density - .004) / .026));
  out.life = 20 + 70 * air;
  /** Birth diameter, m. */
  out.size = (2 + 2.2 * Math.sqrt(Math.max(0, thrust) / 1e5)) * (1 + .4 * solidShare);
  /** Linear radius growth per second of age. */
  out.growth = (.45 + .25 * solidShare) * (1 + 1.5 * (1 - air));
  out.opacity = fade * fade * (3 - 2 * fade);
  return out;
}
