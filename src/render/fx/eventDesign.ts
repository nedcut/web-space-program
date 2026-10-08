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
/** Number of overlapping trail cells to fill, bounded even when a frame is missed. */
export function trailCells(distance: number, spacing: number, budget: number): number {
  return Math.min(budget, Math.floor(Math.max(0, distance) / spacing));
}
