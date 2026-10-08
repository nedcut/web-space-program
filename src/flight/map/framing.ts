import type { Orbit, TrajectoryPatch } from '../../sim/orbit/api';
import { firstPlannedPatch } from '../../render/map/orbitMarkers';

/** Bound the entry frame to the local orbit; an escaping path has no finite apoapsis. */
export function orbitFrameDistance(radius: number, currentRadius: number, orbit?: Orbit): number {
  const ap = orbit && orbit.e < 1 ? orbit.a * (1 + orbit.e) : currentRadius;
  return 2.8 * Math.max(radius * 1.2, currentRadius, Math.min(ap, Math.max(currentRadius * 3, radius * 4)));
}

/**
 * Index of the first SOI change on the path actually being flown (before any planned node) that leaves `body`,
 * or -1. Planned encounters are left to the explicit transfer overview; only the vessel's own path reframes.
 */
export function firstTransition(patches: readonly TrajectoryPatch[], body: string): number {
  const planned = firstPlannedPatch(patches);
  for (let i = 0; i < planned; i++) {
    const p = patches[i];
    if (p.orbit.body !== body) return -1;
    if ((p.endReason === 'soiEnter' || p.endReason === 'soiExit') && p.nextBody) return i;
  }
  return -1;
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
 * player zoomed by hand since the last framing.
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
  framed(body: string, patch: TrajectoryPatch | undefined, zoomCount: number, now: number) {
    this.body = body;
    this.kind = this.pendingKind = patch?.endReason ?? '';
    this.next = this.pendingNext = patch?.nextBody ?? '';
    this.since = now;
    this.zoom = zoomCount;
  }

  /** Per frame (allocation-free): true when the map should frame the active vessel's path now. */
  update(body: string, patch: TrajectoryPatch | undefined, zoomCount: number, now: number, thrusting: boolean): boolean {
    if (body !== this.body) return true;
    const kind = patch?.endReason ?? '', next = patch?.nextBody ?? '';
    if (kind !== this.pendingKind || next !== this.pendingNext) { this.pendingKind = kind; this.pendingNext = next; this.since = now; }
    if (kind === this.kind && next === this.next) return false;
    return !thrusting && zoomCount === this.zoom && now - this.since >= SETTLE_MS;
  }
}
