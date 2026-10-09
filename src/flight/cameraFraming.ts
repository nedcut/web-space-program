/**
 * Pure framing rules for the flight camera (no DOM, no three.js): where the vessel sits on screen relative to the
 * HUD, the liftoff dolly, the speed FOV cue and the tower camera's tracking zoom and hand-back distance.
 */

/** Largest upward lens shift (fraction of viewport height): beyond this the sky dominates the frame. */
export const MAX_LENS_SHIFT = 0.2;

/**
 * Vertical lens shift that moves the vessel out from behind the bottom HUD: the vessel centre is placed at `bias`
 * of the clear band between the top HUD and the navball cluster (0 = top edge, 1 = bottom edge). Returned as a fraction of viewport height, positive = up.
 */
export function hudLensShift(viewH: number, topPx: number, bottomPx: number, bias = 0.5): number {
  if (!(viewH > 0)) return 0;
  const band = Math.max(0, viewH - topPx - bottomPx);
  const centre = topPx + bias * band;
  return Math.max(0, Math.min(MAX_LENS_SHIFT, (viewH / 2 - centre) / viewH));
}

/** Liftoff dolly: over `duration` s the auto camera backs out to `distance`× and drops `pitch` rad (a lower angle). */
export const LIFTOFF_DOLLY = { duration: 8, distance: 1.6, pitch: -0.1 } as const;

/** Smootherstep 0..1: zero velocity and acceleration at both ends, so the dolly neither jerks in nor stops dead. */
export function smootherstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Distance multiplier of the liftoff dolly `t` s after liftoff. */
export function liftoffDollyScale(t: number): number {
  return 1 + (LIFTOFF_DOLLY.distance - 1) * smootherstep(t / LIFTOFF_DOLLY.duration);
}

/** Pitch offset (rad) of the liftoff dolly `t` s after liftoff. */
export function liftoffDollyPitch(t: number): number {
  return LIFTOFF_DOLLY.pitch * smootherstep(t / LIFTOFF_DOLLY.duration);
}

/**
 * Detects a liftoff: the frame a vessel that sat on the ground for at least `settle` s leaves it under thrust.
 * A bounce, a tip-over or a vessel switch does not count.
 */
export class LiftoffDetector {
  private id: string | undefined;
  private groundTime = 0;
  constructor(private readonly settle = 2) {}
  update(id: string, grounded: boolean, thrusting: boolean, dt: number): boolean {
    if (id !== this.id) { this.id = id; this.groundTime = grounded ? this.settle : 0; return false; }
    if (grounded) { this.groundTime += dt; return false; }
    const lifted = this.groundTime >= this.settle && thrusting;
    this.groundTime = 0;
    return lifted;
  }
}

/** Extra FOV (deg) with dynamic pressure: a slight widening that reads as speed through max-Q, gone in space. */
export function speedFovBoost(dynamicPressure: number, spaceBlend: number): number {
  const q = Math.max(0, Math.min(1, dynamicPressure / 35000));
  return 5 * q * (2 - q) * (1 - Math.max(0, Math.min(1, spaceBlend)));
}

/** Tower camera: narrowest FOV (deg) its tracking zoom reaches. */
export const TOWER_MIN_FOV = 2;
/** The tower zoom keeps the vessel's bounding radius at least this fraction of the half-height of the view. */
const TOWER_FILL = 1 / 3;

/** Tower camera FOV (deg): the base FOV until the vessel shrinks, then a zoom that keeps it a readable size. */
export function towerFov(baseFov: number, radius: number, distance: number): number {
  const tanBase = Math.tan((baseFov * Math.PI) / 360);
  const tanNeed = Math.max(0.5, radius) / TOWER_FILL / Math.max(1, distance);
  const fov = (Math.atan(Math.min(tanBase, tanNeed)) * 360) / Math.PI;
  return Math.max(TOWER_MIN_FOV, Math.min(baseFov, fov));
}

/** Distance (m) beyond which the tower camera hands back to the auto camera: the zoom is maxed and the craft fades to a speck. */
export function towerRevertDistance(radius: number): number {
  const fullZoom = Math.max(0.5, radius) / TOWER_FILL / Math.tan((TOWER_MIN_FOV * Math.PI) / 360);
  return Math.max(1500, fullZoom * 2);
}

/** Tower camera placement: horizontal distance from the vessel's ground point and eye height above the terrain (m). */
export function towerPlacement(radius: number): { distance: number; height: number } {
  return { distance: Math.max(40, Math.min(300, radius * 8)), height: 2 };
}

/** The tower camera only makes sense close to a solid surface. */
export function towerAvailable(solidSurface: boolean, altitudeAGL: number, radius: number): boolean {
  return solidSurface && altitudeAGL < towerRevertDistance(radius) * 0.5;
}
