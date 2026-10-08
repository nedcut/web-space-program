/** Pure sound-design mappings: no browser, simulation or rendering dependencies. */
const finite = (v: number) => Number.isFinite(v) ? v : 0;
export const clampUnit = (v: number) => Math.max(0, Math.min(1, finite(v)));
export function musicDuck(thrust: number, pressure: number, heat: number): number {
  return 1 - 0.78 * Math.max(clampUnit(thrust), clampUnit(pressure / 40000), clampUnit(heat));
}
export function atmosphereColor(body?: string): number {
  return body === 'titan' ? 0.55 : body === 'mars' ? 1.35 : body === 'venus' ? 0.7 : 1;
}
/** Shared with the flight camera so launch rumble and visible vibration rise together. */
export function flightRumble(thrust: number, weight: number, agl: number, q: number, mach: number): number {
  const launch = clampUnit(thrust / Math.max(1, finite(weight) * 1.5)) * Math.exp(-Math.max(0, finite(agl)) / 250);
  const transonic = Math.exp(-(((finite(mach) - 1) / 0.25) ** 2));
  return Math.min(0.8, launch * 0.7 + clampUnit(q / 40000) * (0.35 + 0.65 * transonic) * 0.5);
}
/** Reserve room for interface/alarms even during destruction cascades. */
export function admitVoice(nodes: number, cost: number, priority = false): boolean {
  return nodes + cost <= (priority ? 234 : 210);
}
export function engineTransition(previous: number, next: number): 'ignite' | 'shutdown' | null {
  return previous <= 0 && next > 0 ? 'ignite' : previous > 0 && next <= 0 ? 'shutdown' : null;
}

/** Absolute Newtons mapped to an amplitude reference; independent of unlit installed hardware. */
export function thrustGain(newtons: number): number {
  return Math.sqrt(clampUnit(Math.max(0, finite(newtons)) / 3300000));
}
