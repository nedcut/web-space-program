import type { Quat } from '../../util/quat';
import { cross, dot, normalize, sub, v3, type Vec3 } from '../../util/vec3';
import type { PartState, VesselState } from './runtime';
import type { DockingPortModule, PartDef } from './types';
import { hullPoints, shapeRadius } from './shapes';

interface Hull {
  points: Vec3[];
  normals: Vec3[];
  edges: Vec3[];
  radius: number;
  enclosure: boolean;
  port?: { mod: DockingPortModule; position: Vec3; direction: Vec3 };
}
const hulls = new WeakMap<PartDef, Hull>();
const separating = new WeakMap<VesselState, WeakSet<VesselState>>();

/** Splits can inherit intersecting catalogue bounds. Keep the siblings free until their bounds part once. */
export function ignoreInitialVesselOverlap(a: VesselState, b: VesselState): void {
  let neighbours = separating.get(a);
  if (!neighbours) { neighbours = new WeakSet<VesselState>(); separating.set(a, neighbours); }
  neighbours.add(b);
}

/** Immutable convex hulls: the same octagonal frusta / box corners used by ground contact. */
function hull(def: PartDef): Hull {
  const cached = hulls.get(def);
  if (cached) return cached;
  const points = hullPoints(def), normals = [v3(0, 1, 0)], edges: Vec3[] = [];
  if (def.shape.kind === 'box') {
    normals.push(v3(1, 0, 0), v3(0, 0, 1));
    edges.push(...normals);
  } else {
    for (let i = 0; i < 8; i++) {
      const top = points[i * 2], bottom = points[i * 2 + 1];
      const next = (i + 1) % 8;
      // Use the nonzero ring for a cone (one of the rings can collapse to a point).
      const ring = def.shape.radiusTop > 0 ? sub(points[next * 2], top) : sub(points[next * 2 + 1], bottom);
      const side = sub(bottom, top);
      normals.push(normalize(cross(ring, side)));
      edges.push(normalize(ring), normalize(side));
    }
  }
  const result: Hull = { points, normals, edges, radius: shapeRadius(def), enclosure: def.modules.some(m => m.type === 'bay') };
  for (const mod of def.modules) if (mod.type === 'dockingPort') {
    const node = def.attachNodes.find(n => n.id === mod.node);
    if (node) result.port = { mod, position: node.position, direction: node.direction };
  }
  hulls.set(def, result);
  return result;
}

// Single-threaded solver scratch, never returned. All geometry stays relative to A's COM, in float64.
const makeFrame = () => ({
  centre: v3(), points: Array.from({ length: 16 }, () => v3()),
  normals: Array.from({ length: 10 }, () => v3()), edges: Array.from({ length: 16 }, () => v3()),
});
type Frame = ReturnType<typeof makeFrame>;
const fa = makeFrame(), fb = makeFrame();
const normal = v3(), point = v3(), axis = v3(), tmp = v3(), tmp2 = v3();
const ra = v3(), rb = v3(), va = v3(), vb = v3(), velocity = v3();
const torque = v3(), angular = v3(), impulse = v3(), tangent = v3();
const faceA = v3(), faceB = v3(), dirA = v3(), dirB = v3();
const scalars = new Float64Array(3);
const DEPTH = 0, MASS_A = 1, MASS_B = 2;

function rotate(out: Vec3, q: Quat, v: Vec3, inverse = false): void {
  const x = v.x, y = v.y, z = v.z;
  const qx = inverse ? -q.x : q.x, qy = inverse ? -q.y : q.y, qz = inverse ? -q.z : q.z;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out.x = x + q.w * tx + qy * tz - qz * ty;
  out.y = y + q.w * ty + qz * tx - qx * tz;
  out.z = z + q.w * tz + qx * ty - qy * tx;
}
function crossInto(out: Vec3, a: Vec3, b: Vec3): void {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  out.x = x; out.y = y; out.z = z;
}
function centre(out: Vec3, v: VesselState, p: PartState, origin: Vec3): void {
  out.x = p.position.x - v.com.x; out.y = p.position.y - v.com.y; out.z = p.position.z - v.com.z;
  rotate(out, v.orientation, out);
  out.x += v.position.x - origin.x; out.y += v.position.y - origin.y; out.z += v.position.z - origin.z;
}
function partDirection(out: Vec3, v: VesselState, p: PartState, local: Vec3): void {
  rotate(out, p.rotation, local);
  rotate(out, v.orientation, out);
}
function frame(f: Frame, h: Hull, v: VesselState, p: PartState): void {
  for (let i = 0; i < h.points.length; i++) {
    const o = f.points[i];
    partDirection(o, v, p, h.points[i]);
    o.x += f.centre.x; o.y += f.centre.y; o.z += f.centre.z;
  }
  for (let i = 0; i < h.normals.length; i++) partDirection(f.normals[i], v, p, h.normals[i]);
  for (let i = 0; i < h.edges.length; i++) partDirection(f.edges[i], v, p, h.edges[i]);
}

/** SAT includes edge-cross-edge axes, so slender rotated boxes cannot pass through one another. */
function testAxis(n: Vec3, a: Hull, b: Hull): boolean {
  const len2 = dot(n, n);
  if (len2 < 1e-16) return true;
  const inv = 1 / Math.sqrt(len2), nx = n.x * inv, ny = n.y * inv, nz = n.z * inv;
  let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
  for (let i = 0; i < a.points.length; i++) {
    const p = fa.points[i], d = p.x * nx + p.y * ny + p.z * nz;
    amin = Math.min(amin, d); amax = Math.max(amax, d);
  }
  for (let i = 0; i < b.points.length; i++) {
    const p = fb.points[i], d = p.x * nx + p.y * ny + p.z * nz;
    bmin = Math.min(bmin, d); bmax = Math.max(bmax, d);
  }
  const forward = amax - bmin, backward = bmax - amin;
  if (forward < 0 || backward < 0) return false;
  const d = Math.min(forward, backward);
  if (d < scalars[DEPTH]) {
    scalars[DEPTH] = d;
    const sign = forward <= backward ? 1 : -1;
    normal.x = nx * sign; normal.y = ny * sign; normal.z = nz * sign;
  }
  return true;
}
function support(out: Vec3, points: Vec3[], count: number, sign: number): void {
  let max = -Infinity;
  for (let i = 0; i < count; i++) max = Math.max(max, dot(points[i], normal) * sign);
  out.x = out.y = out.z = 0;
  let n = 0;
  for (let i = 0; i < count; i++) if (dot(points[i], normal) * sign >= max - 1e-7) {
    const p = points[i]; out.x += p.x; out.y += p.y; out.z += p.z; n++;
  }
  out.x /= n; out.y /= n; out.z /= n;
}
function intersect(a: Hull, b: Hull): boolean {
  scalars[DEPTH] = Infinity;
  for (let i = 0; i < a.normals.length; i++) if (!testAxis(fa.normals[i], a, b)) return false;
  for (let i = 0; i < b.normals.length; i++) if (!testAxis(fb.normals[i], a, b)) return false;
  for (let i = 0; i < a.edges.length; i++) for (let j = 0; j < b.edges.length; j++) {
    crossInto(axis, fa.edges[i], fb.edges[j]);
    if (!testAxis(axis, a, b)) return false;
  }
  support(tmp, fa.points, a.points.length, 1);
  support(tmp2, fb.points, b.points.length, -1);
  point.x = (tmp.x + tmp2.x) * 0.5; point.y = (tmp.y + tmp2.y) * 0.5; point.z = (tmp.z + tmp2.z) * 0.5;
  return true;
}

function freePort(v: VesselState, p: PartState, node: string): boolean {
  if (p.parent !== null && p.attachNode === node) return false;
  for (let i = 0; i < p.children.length; i++) if (v.cache.byUid.get(p.children[i])?.parentNode === node) return false;
  return true;
}
function pointVelocity(out: Vec3, v: VesselState, r: Vec3): void {
  rotate(tmp, v.orientation, v.angularVelocity);
  crossInto(out, tmp, r);
  out.x += v.velocity.x; out.y += v.velocity.y; out.z += v.velocity.z;
}
/** Match the capture envelope without allocating PortInfo/candidate objects on the contact path. */
function captureFaces(a: VesselState, pa: PartState, ha: Hull, b: VesselState, pb: PartState, hb: Hull): boolean {
  const ap = ha.port, bp = hb.port;
  if (!ap || !bp || ap.mod.size !== bp.mod.size || !freePort(a, pa, ap.mod.node) || !freePort(b, pb, bp.mod.node)) return false;
  partDirection(dirA, a, pa, ap.direction); partDirection(dirB, b, pb, bp.direction);
  if (-dot(dirA, dirB) < Math.cos(Math.min(ap.mod.captureAngle, bp.mod.captureAngle))) return false;
  partDirection(faceA, a, pa, ap.position); partDirection(faceB, b, pb, bp.position);
  faceA.x += fa.centre.x; faceA.y += fa.centre.y; faceA.z += fa.centre.z;
  faceB.x += fb.centre.x; faceB.y += fb.centre.y; faceB.z += fb.centre.z;
  const dx = faceB.x - faceA.x, dy = faceB.y - faceA.y, dz = faceB.z - faceA.z;
  const range = Math.min(ap.mod.captureRange, bp.mod.captureRange);
  if (dx * dx + dy * dy + dz * dz > range * range) return false;
  // The freshly undocked faces remain exempt while they drift apart, using the existing re-arm lifecycle.
  if (pa.dockDisarmed && pb.dockDisarmed) return true;
  if (pa.dockDisarmed || pb.dockDisarmed) return false;
  tmp2.x = faceB.x - (b.position.x - a.position.x);
  tmp2.y = faceB.y - (b.position.y - a.position.y);
  tmp2.z = faceB.z - (b.position.z - a.position.z);
  pointVelocity(va, a, faceA); pointVelocity(vb, b, tmp2);
  const vx = vb.x - va.x, vy = vb.y - va.y, vz = vb.z - va.z;
  const speed = Math.min(ap.mod.captureSpeed, bp.mod.captureSpeed);
  return vx * vx + vy * vy + vz * vz <= speed * speed;
}

function inverseInertia(out: Vec3, v: VesselState, n: Vec3): void {
  rotate(out, v.orientation, n, true);
  const m = v.invInertia, x = out.x, y = out.y, z = out.z;
  out.x = m[0] * x + m[1] * y + m[2] * z;
  out.y = m[3] * x + m[4] * y + m[5] * z;
  out.z = m[6] * x + m[7] * y + m[8] * z;
  rotate(out, v.orientation, out);
}
function angularMass(v: VesselState, r: Vec3, n: Vec3, slot: number): void {
  crossInto(torque, r, n);
  inverseInertia(angular, v, torque);
  scalars[slot] = dot(torque, angular);
}
function kick(v: VesselState, r: Vec3, j: Vec3, sign: number): void {
  v.velocity.x += j.x * sign / v.mass; v.velocity.y += j.y * sign / v.mass; v.velocity.z += j.z * sign / v.mass;
  crossInto(torque, r, j);
  rotate(torque, v.orientation, torque, true);
  const m = v.invInertia, x = torque.x * sign, y = torque.y * sign, z = torque.z * sign;
  v.angularVelocity.x += m[0] * x + m[1] * y + m[2] * z;
  v.angularVelocity.y += m[3] * x + m[4] * y + m[5] * z;
  v.angularVelocity.z += m[6] * x + m[7] * y + m[8] * z;
}
function relativeVelocity(a: VesselState, b: VesselState): void {
  pointVelocity(va, a, ra); pointVelocity(vb, b, rb);
  velocity.x = vb.x - va.x; velocity.y = vb.y - va.y; velocity.z = vb.z - va.z;
}
function resolve(a: VesselState, b: VesselState, dt: number): boolean {
  ra.x = point.x; ra.y = point.y; ra.z = point.z;
  rb.x = point.x - (b.position.x - a.position.x);
  rb.y = point.y - (b.position.y - a.position.y);
  rb.z = point.z - (b.position.z - a.position.z);
  relativeVelocity(a, b);
  const vn = dot(velocity, normal), invMass = 1 / a.mass + 1 / b.mass;
  angularMass(a, ra, normal, MASS_A); angularMass(b, rb, normal, MASS_B);
  const mass = invMass + scalars[MASS_A] + scalars[MASS_B];
  // Slop prevents chatter; capped recovery prevents a saved overlap from creating an explosive impulse.
  const bias = Math.min(0.5, 0.15 * Math.max(0, scalars[DEPTH] - 0.002) / dt);
  const restitution = vn < -0.2 ? 0.05 : 0;
  const j = Math.max(0, (bias - (1 + restitution) * vn) / mass);
  if (j === 0) return false;
  impulse.x = normal.x * j; impulse.y = normal.y * j; impulse.z = normal.z * j;
  kick(a, ra, impulse, -1); kick(b, rb, impulse, 1);
  relativeVelocity(a, b);
  const afterNormal = dot(velocity, normal);
  tangent.x = velocity.x - normal.x * afterNormal;
  tangent.y = velocity.y - normal.y * afterNormal;
  tangent.z = velocity.z - normal.z * afterNormal;
  const speed = Math.sqrt(dot(tangent, tangent));
  if (speed > 1e-9) {
    tangent.x /= speed; tangent.y /= speed; tangent.z /= speed;
    angularMass(a, ra, tangent, MASS_A); angularMass(b, rb, tangent, MASS_B);
    const jt = Math.min(0.35 * j, speed / (invMass + scalars[MASS_A] + scalars[MASS_B]));
    impulse.x = -tangent.x * jt; impulse.y = -tangent.y * jt; impulse.z = -tangent.z * jt;
    kick(a, ra, impulse, -1); kick(b, rb, impulse, 1);
  }
  return true;
}

/** Resolve loaded rigid vessels after integration, before docking. Returns the number of hull contacts.
 * No steady-state allocations; immutable shape data is cached on first near encounter. EVA has its own solver.
 */
export function stepVesselContacts(vessels: readonly VesselState[], dt: number): number {
  let contacts = 0;
  for (let i = 0; i < vessels.length; i++) {
    const a = vessels[i];
    if (a.destroyed || a.eva) continue;
    for (let j = i + 1; j < vessels.length; j++) {
      const b = vessels[j];
      if (b.destroyed || b.eva) continue;
      const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y, dz = b.position.z - a.position.z;
      const reach = a.cache.boundingRadius + b.cache.boundingRadius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) {
        separating.get(a)?.delete(b); separating.get(b)?.delete(a);
        continue;
      }
      if (separating.get(a)?.has(b) || separating.get(b)?.has(a)) continue;
      for (let ai = 0; ai < a.parts.length; ai++) {
        const pa = a.parts[ai];
        const ha = hull(pa.def);
        // A bay's catalogue cylinder encloses empty payload space. Open doors must release that space.
        if (ha.enclosure && pa.bayOpen) continue;
        centre(fa.centre, a, pa, a.position);
        let ready = false;
        for (let bi = 0; bi < b.parts.length; bi++) {
          const pb = b.parts[bi];
          const hb = hull(pb.def);
          if (hb.enclosure && pb.bayOpen) continue;
          centre(fb.centre, b, pb, a.position);
          const x = fb.centre.x - fa.centre.x, y = fb.centre.y - fa.centre.y, z = fb.centre.z - fa.centre.z;
          const r = ha.radius + hb.radius;
          if (x * x + y * y + z * z > r * r) continue;
          if (captureFaces(a, pa, ha, b, pb, hb)) continue;
          if (!ready) { frame(fa, ha, a, pa); ready = true; }
          frame(fb, hb, b, pb);
          if (intersect(ha, hb)) { resolve(a, b, dt); contacts++; }
        }
      }
    }
  }
  return contacts;
}
