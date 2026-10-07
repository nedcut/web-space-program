import * as THREE from 'three';

/**
 * Engine-aware soot, baked per craft into the vertex colour every part material already reads (see ao.ts).
 *
 * Each nozzle exit ('exhaustAnchor', plume along its local -Y) is a source scaled by its exit radius:
 *  - base recirculation: surfaces beside and above the exit plane darken with height above the exit and with
 *    distance outside the nozzle radius, most where they face the plume (tank aft domes, skirts, neighbouring
 *    boosters, legs beside a descent engine);
 *  - plume: surfaces downstream inside a widening cone (interstages, the top of the stage below) darken with
 *    distance along the axis, most where they face the engine.
 * An engine never soots its own part (its nozzle materials carry their own heat staining). Streaks come from
 * angular noise around the plume axis so the gradient never reads as a smooth airbrush.
 *
 * Templates no longer carry generic soot; parts away from engines stay clean. No material or shader changes.
 */

interface Source { p: THREE.Vector3; d: THREE.Vector3; u: THREE.Vector3; w: THREE.Vector3; r: number; owner: THREE.Object3D; amp: number; len: number }

/** Original colours of every geometry this module has darkened (restored before each re-bake). */
const baseColors = new WeakMap<THREE.BufferGeometry, Float32Array>();
const sooted = new WeakSet<THREE.BufferGeometry>();
/** Per-mesh template geometry for meshes whose shared geometry was cloned here (editor clones). */
const originals = new WeakMap<THREE.Mesh, THREE.BufferGeometry>();

/** True when the geometry carries craft-specific soot (static batching must not instance it). */
export const isSooted = (g: THREE.BufferGeometry) => sooted.has(g);

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Vector3();
const _s = new THREE.Sphere();

function sources(parts: THREE.Object3D[], toFrame: THREE.Matrix4): Source[] {
  const out: Source[] = [];
  for (const owner of parts)
    owner.traverse((o) => {
      if (o.name !== 'exhaustAnchor') return;
      _m.multiplyMatrices(toFrame, o.matrixWorld);
      const p = new THREE.Vector3().setFromMatrixPosition(_m);
      const d = new THREE.Vector3(0, -1, 0).transformDirection(_m);
      const r = Math.max(0.05, (o.userData.exitRadius as number | undefined) ?? 0.3);
      const ref = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = ref.addScaledVector(d, -ref.dot(d)).normalize();
      out.push({ p, d, u, w: new THREE.Vector3().crossVectors(d, u), r, owner, amp: Math.min(0.95, 0.7 + 0.25 * r), len: engineLength(owner, toFrame, p, d) });
    });
  return out;
}

/** How far the engine part reaches upstream of its exit plane (soot is strong all along the engine bay). */
function engineLength(owner: THREE.Object3D, toFrame: THREE.Matrix4, p: THREE.Vector3, d: THREE.Vector3): number {
  let len = 0;
  const box = new THREE.Box3(), c = new THREE.Vector3(), m = new THREE.Matrix4();
  owner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!);
    m.multiplyMatrices(toFrame, mesh.matrixWorld);
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(m);
      len = Math.max(len, -c.sub(p).dot(d));
    }
  });
  return len;
}

/** Angular streak noise around the plume axis, 0..1. */
function streak(phi: number, seed: number): number {
  const h = (k: number) => {
    const v = Math.sin(((((k % 29) + 29) % 29) + 1) * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const x = ((phi / (2 * Math.PI)) % 1 + 1) % 1 * 29;
  const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
  return h(i) * (1 - t) + h(i + 1) * t;
}

/** Soot at a craft-frame point with normal n from one source (0..1, before amplitude). */
function sootAt(s: Source, x: THREE.Vector3, n: THREE.Vector3): number {
  _v.subVectors(x, s.p);
  const a = _v.dot(s.d);
  _q.copy(_v).addScaledVector(s.d, -a);
  const rho = _q.length();
  const facing = n.dot(s.d);
  if (a <= 0) {
    // full strength along the engine bay, decaying above it
    const h = Math.max(0, -a - s.len);
    const out = Math.max(0, rho - 1.15 * s.r);
    // far field fades out: the stage itself shields hardware well above its engine bay
    const k = Math.exp(-h / (0.75 * s.r + 0.36) - (h / (1.6 + s.r)) ** 4) * Math.exp(-out / (1.3 * s.r + 0.45));
    return k * (0.85 + 0.15 * Math.max(0, facing));
  }
  // cone plus a near-field wall jet: exhaust hitting a surface close to the exit spreads radially along it
  const w = s.r * 1.1 + a * 0.24 + (1.2 + 1.5 * s.r) * Math.exp(-a / (2 * s.r + 0.4));
  const k = 0.8 * Math.exp(-a / (7 * s.r + 2.5)) * Math.exp(-((rho / w) ** 2));
  return k * (0.4 + 0.6 * Math.max(0, -facing));
}

/** Upper bound of a source's soot anywhere within a bounding sphere (for culling). */
function bound(s: Source, sp: THREE.Sphere): number {
  const dist = Math.max(0, sp.center.distanceTo(s.p) - sp.radius - s.len);
  const reach = Math.max(1.1 * s.r + 0.55 + s.len, 7 * s.r + 2.5);
  return s.amp * Math.exp(-dist / (reach + 1.3 * s.r + 0.45));
}

function restore(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  const base = baseColors.get(g);
  if (base) {
    (g.getAttribute('color') as THREE.BufferAttribute).array.set(base);
    g.getAttribute('color').needsUpdate = true;
  }
  sooted.delete(g);
  const orig = originals.get(mesh);
  if (orig) {
    g.dispose();
    mesh.geometry = orig;
    originals.delete(mesh);
  }
}

export interface SootOptions {
  /** Clone geometry shared with a part template before darkening it (editor). Flight geometry is already per part. */
  cloneShared?: boolean;
}

/**
 * (Re-)bake engine soot for one craft. `parts` are the part roots, placed in `frame` (the craft group).
 * Safe to call repeatedly: previous soot is removed first.
 */
export function bakeEngineSoot(parts: THREE.Object3D[], frame: THREE.Object3D, opts: SootOptions = {}): void {
  frame.updateMatrixWorld(true);
  const toFrame = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const src = sources(parts, toFrame);
  const x = new THREE.Vector3(), n = new THREE.Vector3();
  for (const part of parts) {
    const local = src.filter((s) => s.owner !== part);
    part.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!mats.every((m) => (m as THREE.MeshStandardMaterial).vertexColors && !m.transparent)) return;
      restore(mesh);
      const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!local.length || !color || color.itemSize !== 3) return;
      _m.multiplyMatrices(toFrame, mesh.matrixWorld);
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      _s.copy(mesh.geometry.boundingSphere!).applyMatrix4(_m);
      const near = local.filter((s) => bound(s, _s) > 0.025);
      if (!near.length) return;
      _n.getNormalMatrix(_m);
      const pos = mesh.geometry.getAttribute('position');
      const nor = mesh.geometry.getAttribute('normal');
      const dark = new Float32Array(pos.count);
      let any = false;
      for (let i = 0; i < pos.count; i++) {
        x.fromBufferAttribute(pos, i).applyMatrix4(_m);
        if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize();
        else n.set(0, 0, 0);
        let keep = 1;
        for (const s of near) {
          const k = sootAt(s, x, n);
          if (k < 1e-3) continue;
          // streaks: angular noise around the plume axis (sootAt leaves the radial offset in _q)
          const phi = Math.atan2(_q.dot(s.w), _q.dot(s.u));
          const st = 0.45 + 0.8 * streak(phi, 3) * (0.55 + 0.45 * streak(phi * 2.7, 7));
          keep *= 1 - Math.min(1, s.amp * k * st);
        }
        const v = Math.min(0.9, 1 - keep);
        dark[i] = v;
        if (v > 0.06) any = true;
      }
      if (!any) return;
      if (opts.cloneShared && !originals.has(mesh)) {
        const clone = mesh.geometry.clone();
        originals.set(mesh, mesh.geometry);
        mesh.geometry = clone;
      }
      const g = mesh.geometry;
      const attr = g.getAttribute('color') as THREE.BufferAttribute;
      let base = baseColors.get(g);
      if (!base) baseColors.set(g, (base = new Float32Array(attr.array as Float32Array)));
      const arr = attr.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const v = dark[i];
        arr[i * 3] = base[i * 3] * (1 - v * 0.9);
        arr[i * 3 + 1] = base[i * 3 + 1] * (1 - v * 0.95);
        arr[i * 3 + 2] = base[i * 3 + 2] * (1 - v);
      }
      attr.needsUpdate = true;
      sooted.add(g);
    });
  }
}

/** Drop soot clones made with `cloneShared` (call when an editor part leaves the scene). */
export function releaseSoot(part: THREE.Object3D): void {
  part.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && originals.has(mesh)) restore(mesh);
  });
}
