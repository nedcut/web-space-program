/**
 * Pure maneuver-gizmo math (no three.js, no DOM) shared by the map view and its tests.
 *
 * Handles are rate controls: pulling a handle outward along its on-screen direction adds Δv continuously, faster
 * the further it is pulled; pushing it back towards the node removes Δv. Alt/Option + wheel over a handle adds a
 * fixed small increment (the plain wheel always zooms). The node centre slides along the orbit: the cursor is
 * projected onto the orbit's screen polyline and the time is interpolated within the closest segment.
 */
import type { ManeuverNode } from '../../sim/orbit/api';

export type GizmoAxis = 'prograde' | 'normal' | 'radial';
export interface GizmoHandle { axis: GizmoAxis; sign: 1 | -1 }

/** Prograde/retrograde, normal/anti-normal, radial out/in. Order is also the draw/pick priority. */
export const GIZMO_HANDLES: readonly GizmoHandle[] = [
  { axis: 'prograde', sign: 1 }, { axis: 'prograde', sign: -1 },
  { axis: 'normal', sign: 1 }, { axis: 'normal', sign: -1 },
  { axis: 'radial', sign: 1 }, { axis: 'radial', sign: -1 },
];

/** Pull (px) ignored around the rest position, so a click on a handle never changes Δv. */
export const HANDLE_DEAD_ZONE = 4;
/** Pull (px) at which the rate saturates. */
export const HANDLE_FULL_PULL = 140;
/** Saturated rate in m/s per second. */
export const HANDLE_MAX_RATE = 400;
/** Fine-tune mode scales every handle input by this factor. */
export const FINE_TUNE_SCALE = 0.05;
/** Δv per wheel notch over a handle (m/s), before fine-tune scaling. */
export const WHEEL_STEP = 0.1;

/**
 * Δv rate (m/s per second) for a handle pulled `pull` px along its outward screen direction. Non-linear (power
 * 2.5) so small pulls give precise trims (≈1 m/s/s at 20 px) and long pulls reach hundreds of m/s per second.
 */
export function handleRate(pull: number, fine = false): number {
  const a = Math.abs(pull);
  if (!Number.isFinite(a) || a <= HANDLE_DEAD_ZONE) return 0;
  const x = Math.min(1, (a - HANDLE_DEAD_ZONE) / (HANDLE_FULL_PULL - HANDLE_DEAD_ZONE));
  return Math.sign(pull) * HANDLE_MAX_RATE * x ** 2.5 * (fine ? FINE_TUNE_SCALE : 1);
}

/** Signed pull: the drag vector (px, y down) projected on the handle's unit screen direction. */
export function handlePull(dragX: number, dragY: number, dirX: number, dirY: number): number {
  return dragX * dirX + dragY * dirY;
}

/**
 * Unit on-screen direction of a handle from its projected offset (px, y down). Handles that point almost straight
 * at the camera have no usable screen direction; they fall back to "drag up to add".
 */
export function handleScreenDirection(dx: number, dy: number, minLength = 6): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  return len >= minLength ? { x: dx / len, y: dy / len } : { x: 0, y: -1 };
}

/** Apply `seconds` of a handle held at `pull` px to the node (mutates and returns the added Δv). */
export function applyHandle(node: Pick<ManeuverNode, GizmoAxis>, handle: GizmoHandle, pull: number, seconds: number, fine = false): number {
  const dv = handleRate(pull, fine) * Math.max(0, seconds) * handle.sign;
  node[handle.axis] += dv;
  return dv;
}

/** One wheel event over a handle: scrolling "up" (negative deltaY) pushes Δv towards the handle's direction. */
export function applyWheel(node: Pick<ManeuverNode, GizmoAxis>, handle: GizmoHandle, deltaY: number, fine = false): number {
  if (!deltaY) return 0;
  const dv = -Math.sign(deltaY) * WHEEL_STEP * (fine ? 0.1 : 1) * handle.sign;
  node[handle.axis] = Math.round((node[handle.axis] + dv) * 1000) / 1000;
  return dv;
}

/** Map zoom per wheel pixel (log-distance units). A mouse notch (100 px) zooms ≈1.17×. */
export const ZOOM_PER_PIXEL = 0.0016;
/** Trackpad pinch arrives as ctrl+wheel with small deltas; scale it up so a pinch feels like a swipe. */
export const PINCH_BOOST = 8;

/**
 * Multiplicative camera-distance change for one wheel event. Normalises line/page delta modes (Firefox, some
 * mice), boosts trackpad pinch (ctrlKey) and clamps single huge events so momentum scrolling stays controllable.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, pinch = false, pageHeight = 800): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  let px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
  if (pinch) px *= PINCH_BOOST;
  return Math.exp(Math.max(-400, Math.min(400, px)) * ZOOM_PER_PIXEL);
}

/**
 * Length multiplier for a handle whose on-screen arm came out `projectedPx` long for a requested `wantedPx`:
 * arms foreshortened by the view angle are stretched (up to `maxStretch`×) so handles keep a comfortable
 * distance from the node centre instead of piling onto it.
 */
export function handleStretch(projectedPx: number, wantedPx: number, maxStretch = 5): number {
  if (!(projectedPx > 0.5) || !Number.isFinite(projectedPx)) return maxStretch;
  return Math.max(1, Math.min(maxStretch, wantedPx / projectedPx));
}

/** Screen-space polyline with a time per vertex. Vertices with NaN x are behind the camera and break the line. */
export interface ScreenPolyline { x: Float64Array; y: Float64Array; t: Float64Array; n: number }

export function screenPolyline(capacity: number): ScreenPolyline {
  return { x: new Float64Array(capacity), y: new Float64Array(capacity), t: new Float64Array(capacity), n: 0 };
}

/**
 * Closest point on a screen polyline to (cx, cy): the interpolated time and the pixel distance. `prefer` adds
 * `weight` px per second away from `time` to the score, so where the line overlaps itself (a full revolution
 * ends where it starts) a dragged node stays on the revolution it is already on.
 */
export function closestOnPolyline(line: ScreenPolyline, cx: number, cy: number, prefer?: { time: number; weight: number }): { time: number; distance: number } | null {
  let best: { time: number; distance: number } | null = null, bestScore = Infinity;
  for (let i = 0; i + 1 < line.n; i++) {
    const ax = line.x[i], ay = line.y[i], bx = line.x[i + 1], by = line.y[i + 1];
    if (Number.isNaN(ax) || Number.isNaN(bx)) continue;
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * vx + (cy - ay) * vy) / len2)) : 0;
    const d = Math.hypot(ax + vx * u - cx, ay + vy * u - cy), time = line.t[i] + (line.t[i + 1] - line.t[i]) * u;
    const score = d + (prefer ? prefer.weight * Math.abs(time - prefer.time) : 0);
    if (score < bestScore) { bestScore = score; best = { time, distance: d }; }
  }
  return best;
}

/**
 * Time window a node can slide in while dragged: half an orbit either side of its current time (so the projection
 * is continuous as it wraps), never before `earliest`, never past `latest` (SOI change / horizon).
 */
export function slideWindow(nodeTime: number, orbitPeriod: number, earliest: number, latest: number): [number, number] {
  const half = Number.isFinite(orbitPeriod) && orbitPeriod > 0 ? orbitPeriod / 2 : 43200;
  let lo = nodeTime - half, hi = nodeTime + half;
  if (lo < earliest) { hi += earliest - lo; lo = earliest; }
  if (hi > latest) hi = Math.max(lo, latest);
  return [lo, hi];
}
