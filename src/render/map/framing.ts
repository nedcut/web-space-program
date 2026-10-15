import type { Vec3 } from '../../util/vec3';


export function smallBodyVisible(kind: string, heliocentric: boolean, targeted: boolean): boolean {
  return kind !== 'asteroid' && kind !== 'comet' || heliocentric || targeted;
}

/**
 * Whether trajectory patch `k` is drawn around its central body as that body is now (true), or around where the body
 * will be when the patch starts (false). The current patch, and later patches around a body whose family the path
 * has not yet left (the Moon, then Earth after leaving it, then the Sun), share the present frame. A return to a body
 * the path has left is a future re-encounter: drawn around the body now it stacked phantom flybys across the current
 * one. The camera focus's first encounter is the exception, drawn around the focused body as it is now so that the
 * flyby passes its sphere on screen.
 */
export function patchDrawnNow(patches: readonly { orbit: { body: string } }[], k: number, focusId: string | undefined,
  parent: (id: string) => string | undefined): boolean {
  if (k <= 0) return true;
  const body = patches[k].orbit.body;
  let first = body === focusId;
  for (let j = 0; first && j < k; j++) if (patches[j].orbit.body === body) first = false;
  if (first) return true;
  for (let j = 0; j < k; j++) {
    let inside = false;
    for (let id: string | undefined = patches[j].orbit.body; id && !inside; id = parent(id)) inside = id === body;
    if (!inside) return false;
  }
  return true;
}

/**
 * View-plane position of `p` for the map camera at inertial `yaw`/`pitch`, `distance` from the origin, looking at it
 * with +Z up: tangents of the angles right of and above the view axis, in `out`. False when `p` is behind the camera.
 */
function viewPlane(yaw: number, pitch: number, distance: number, p: Vec3, out: [number, number]): boolean {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const depth = distance - (p.x * cy * cp + p.y * sy * cp + p.z * sp);
  if (!(depth > 0)) return false;
  out[0] = (-p.x * sy + p.y * cy) / depth;
  out[1] = (-p.x * cy * sp - p.y * sy * sp + p.z * cp) / depth;
  return true;
}

/**
 * Point of a sphere of `radius` round the origin under view-plane position (`sx`, `sy`) (see viewPlane) for the
 * camera at `yaw`/`pitch`/`distance`, written to `out`. False when the ray misses it.
 */
export function pickSphere(yaw: number, pitch: number, distance: number, radius: number, sx: number, sy: number, out: Vec3): boolean {
  const cy = Math.cos(yaw), sy0 = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cx = cy * cp, cyy = sy0 * cp, cz = sp;
  // Ray: forward (−c) + sx·right + sy·up, from the camera at distance·c.
  const dx = -cx - sx * sy0 - sy * cy * sp, dy = -cyy + sx * cy - sy * sy0 * sp, dz = -cz + sy * cp;
  const a = dx * dx + dy * dy + dz * dz, b = distance * (cx * dx + cyy * dy + cz * dz), c = distance * distance - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / a;
  if (!(t > 0)) return false;
  out.x = distance * cx + t * dx; out.y = distance * cyy + t * dy; out.z = distance * cz + t * dz;
  return true;
}

const plane: [number, number] = [0, 0], planeYaw: [number, number] = [0, 0], planePitch: [number, number] = [0, 0];

/**
 * Zoom towards the cursor: the map camera's `yaw`/`pitch` (see viewPlane) that put `p` at view-plane position
 * (`sx`, `sy`) from `distance`, written to `out`. Newton steps from `out`'s angles, which a zoom step moves only a
 * little. False when `p` cannot be put there (behind the camera, or no convergence); the caller then zooms straight in.
 */
export function aimAt(out: { yaw: number; pitch: number }, distance: number, p: Vec3, sx: number, sy: number): boolean {
  let { yaw, pitch } = out;
  const h = 1e-6;
  for (let i = 0; i < 6; i++) {
    if (!viewPlane(yaw, pitch, distance, p, plane)) return false;
    const fu = plane[0] - sx, fv = plane[1] - sy;
    if (Math.abs(fu) + Math.abs(fv) < 1e-10) break;
    if (!viewPlane(yaw + h, pitch, distance, p, planeYaw) || !viewPlane(yaw, pitch + h, distance, p, planePitch)) return false;
    const a = (planeYaw[0] - plane[0]) / h, b = (planePitch[0] - plane[0]) / h, c = (planeYaw[1] - plane[1]) / h, d = (planePitch[1] - plane[1]) / h;
    const det = a * d - b * c;
    if (!(Math.abs(det) > 1e-12)) return false;
    yaw -= (d * fu - b * fv) / det;
    pitch = Math.max(-1.55, Math.min(1.55, pitch - (a * fv - c * fu) / det));
  }
  if (!viewPlane(yaw, pitch, distance, p, plane) || Math.abs(plane[0] - sx) + Math.abs(plane[1] - sy) > 1e-6) return false;
  out.yaw = yaw; out.pitch = pitch;
  return true;
}

/**
 * Camera distance from the focus along the unit direction (`dx`,`dy`,`dz`) that keeps the camera outside a sphere of
 * radius `clearance` centred at `body` (focus-relative): `distance` itself when that is already outside, else the far
 * side of the sphere. Rotating, zoom easing and focus changes can each carry the camera inside the reference body.
 */
export function clearDistance(distance: number, dx: number, dy: number, dz: number, body: { x: number; y: number; z: number }, clearance: number): number {
  const along = dx * body.x + dy * body.y + dz * body.z, b2 = body.x * body.x + body.y * body.y + body.z * body.z;
  const c = b2 - clearance * clearance, inside = distance * distance - 2 * distance * along + c < 0;
  return inside ? along + Math.sqrt(along * along - c) : distance;
}
