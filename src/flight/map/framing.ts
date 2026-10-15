import type { Orbit, TrajectoryPatch } from '../../sim/orbit/api';
import { firstPlannedPatch } from '../../render/map/orbitMarkers';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../../util/vec3';

/** Bound the entry frame to the local orbit; an escaping path has no finite apoapsis. */
export function orbitFrameDistance(radius: number, currentRadius: number, orbit?: Orbit): number {
  const ap = orbit && orbit.e < 1 ? orbit.a * (1 + orbit.e) : currentRadius;
  return 2.8 * Math.max(radius * 1.2, currentRadius, Math.min(ap, Math.max(currentRadius * 3, radius * 4)));
}

/**
 * Whether the map shows the ascent view: from the ground until the periapsis clears `clearance` (the atmosphere top,
 * or the surface on an airless body) or the path escapes. A suborbital vessel enters it only while climbing below
 * `clearance`, so a deorbit or a descent keeps the orbit view. `r`, `v` are body-relative.
 */
export function ascentPhase(was: boolean, landed: boolean, r: Vec3, v: Vec3, mu: number, clearance: number): boolean {
  if (landed) return true;
  const h = length(cross(r, v)), e = length(eccentricity(r, v, mu));
  const escaping = dot(v, v) / 2 >= mu / length(r);
  if (escaping || h * h / (mu * (1 + e)) > clearance) return false;
  return was || dot(r, v) > 0 && length(r) < clearance;
}

/**
 * Ascent view: centred between the vessel and its apoapsis, framing both over a stretch of the horizon. Returns the
 * body-relative centre and the frame distance.
 */
export function ascentFrame(r: Vec3, v: Vec3, mu: number, radius: number): { centre: Vec3; distance: number } {
  const ev = eccentricity(r, v, mu), e = length(ev), a = 1 / (2 / length(r) - dot(v, v) / mu);
  const ap = e > 1e-9 && a > 0 ? scale(ev, -a * (1 + e) / e) : r;
  const centre = scale(add(r, ap), 0.5);
  return { centre, distance: Math.max(radius * 0.8, distance(r, ap) * 1.5) };
}

/** Map camera yaw/pitch that looks at the ascent from beside its plane and above the vessel's horizon (never from inside the body). */
export function ascentAngles(r: Vec3, v: Vec3): { yaw: number; pitch: number } {
  const up = normalize(r), h = cross(r, v);
  const d = normalize(length(h) > 0 ? add(normalize(h), scale(up, 0.3)) : up);
  return { yaw: Math.atan2(d.y, d.x), pitch: Math.max(-1.55, Math.min(1.55, Math.asin(Math.max(-1, Math.min(1, d.z))))) };
}

function eccentricity(r: Vec3, v: Vec3, mu: number): Vec3 {
  return scale(sub(scale(r, dot(v, v) - mu / length(r)), scale(v, dot(r, v))), 1 / mu);
}

/** firstTransition: no SOI change on the flown path. */
export const NO_TRANSITION = -1;
/** firstTransition: a maneuver node comes first, so where the flown path leads is not decided yet. */
export const UNDECIDED = -2;

/**
 * Index of the first SOI change on the path actually being flown (before any planned node) that leaves `body`,
 * NO_TRANSITION, or UNDECIDED. Planned encounters are left to the explicit transfer overview; only the vessel's
 * own path reframes.
 */
export function firstTransition(patches: readonly TrajectoryPatch[], body: string): number {
  const planned = firstPlannedPatch(patches);
  for (let i = 0; i < planned; i++) {
    const p = patches[i];
    if (p.orbit.body !== body) return NO_TRANSITION;
    if ((p.endReason === 'soiEnter' || p.endReason === 'soiExit') && p.nextBody) return i;
    if (p.endReason === 'maneuver') return UNDECIDED;
  }
  return NO_TRANSITION;
}

/**
 * Frame distance for the active vessel: its local orbit, widened so that the first SOI change of its path is in
 * view. `reach` is how far from the body's centre that change happens plus the room it needs (an encountered moon's
 * SOI, or the body's own SOI edge for an escape); 0 when the path stays in the SOI.
 */
export function pathFrameDistance(radius: number, currentRadius: number, orbit: Orbit | undefined, reach: number): number {
  return Math.max(orbitFrameDistance(radius, currentRadius, orbit), Number.isFinite(reach) ? reach * 2.4 : 0);
}

/** How long a new SOI change must persist on the predicted path before the map reframes for it. */
const SETTLE_MS = 700;

/**
 * When the map following the active vessel frames itself again. It always reframes after an SOI change (the new
 * primary is the centre); within an SOI it reframes when the first SOI change on the flown path appears, changes
 * or disappears (an escape becoming a capture), once that has settled and the engines are off — but never after the
 * player zoomed by hand since the last framing. While a node comes first (`patch` null) the path's fate is
 * undecided: nothing is recorded, and the state after the burn is compared with the last decided one.
 */
export class AutoFramer {
  private body = '';
  private kind = '';
  private next = '';
  private pendingKind = '';
  private pendingNext = '';
  private since = 0;
  private zoom = 0;

  /** Record an explicit framing (map opened, Home, Frame active orbit, or an automatic one). */
  framed(body: string, patch: TrajectoryPatch | undefined | null, zoomCount: number, now: number) {
    // Framed before a node: any decided path after it differs from this (framing the outcome of the burn).
    this.body = body;
    this.kind = this.pendingKind = patch === null ? '?' : patch?.endReason ?? '';
    this.next = this.pendingNext = patch?.nextBody ?? '';
    this.since = now;
    this.zoom = zoomCount;
  }

  /** Per frame (allocation-free): true when the map should frame the active vessel's path now. */
  update(body: string, patch: TrajectoryPatch | undefined | null, zoomCount: number, now: number, thrusting: boolean): boolean {
    if (body !== this.body) return true;
    if (patch === null) { this.pendingKind = this.kind; this.pendingNext = this.next; return false; }
    const kind = patch?.endReason ?? '', next = patch?.nextBody ?? '';
    if (kind !== this.pendingKind || next !== this.pendingNext) { this.pendingKind = kind; this.pendingNext = next; this.since = now; }
    if (kind === this.kind && next === this.next) return false;
    return !thrusting && zoomCount === this.zoom && now - this.since >= SETTLE_MS;
  }
}
