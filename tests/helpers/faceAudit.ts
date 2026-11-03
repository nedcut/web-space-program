import * as THREE from 'three';

/**
 * See-through face audit for part meshes.
 *
 * Part materials are single-sided, so a triangle is invisible from its culled side. If that side can be seen from
 * outside the part, the viewer looks straight through the surface: an outer shell that faces inward, or an open end
 * with no interior wall. For each triangle we trace a few rays from its centre into its culled half-space and walk
 * every hit. A hit blocks the view when the viewer at the far end of the ray would see that surface (its visible side
 * faces the viewer, or it is double-sided). Hits seen from their culled side are skipped, just as the renderer does.
 * If any ray escapes the part's bounds unblocked, the triangle is "exposed".
 */

/**
 * Gaps narrower than this (metres) count as closed: touching lathes with different segment counts leave sub-millimetre
 * slivers that never show at play distances. Real gaps found by this audit were 6 mm to 7 cm.
 */
export const GAP_TOLERANCE = 0.002;
/**
 * A culled face is harmless when a surface facing the viewer sits right behind it (overlapping shells, such as a
 * coarse inner bell poking through the outer bell at Low detail): the viewer sees that surface, not the background.
 */
export const BEHIND_TOLERANCE = 0.02;

export interface Tri {
  /** Visible-side unit normal (geometric normal, flipped for BackSide materials). */
  n: THREE.Vector3;
  c: THREE.Vector3;
  a: THREE.Vector3;
  b: THREE.Vector3;
  d: THREE.Vector3;
  area: number;
  /** Barycentric slack per edge so the triangle blocks rays within GAP_TOLERANCE of its edges. */
  slack: [number, number, number];
  doubleSided: boolean;
  /** Takes part in occlusion (false for alpha-tested decals and transparent glass). */
  blocks: boolean;
  /** Checked for exposure. */
  check: boolean;
  mesh: THREE.Mesh;
  index: number;
}

export interface FaceAuditOptions {
  /** Return false to leave a mesh out of the exposure check (it still occludes). */
  checkMesh?: (m: THREE.Mesh) => boolean;
  /** Extra double-sided occluders in root space (e.g. neighbour parts at attach nodes); never checked. */
  covers?: THREE.BufferGeometry[];
  /** Override GAP_TOLERANCE (metres). */
  gap?: number;
  /** Override BEHIND_TOLERANCE (metres). */
  behind?: number;
}

function matOf(m: THREE.Mesh, tri: number, g: THREE.BufferGeometry): THREE.Material {
  if (!Array.isArray(m.material)) return m.material;
  for (const gr of g.groups) if (tri * 3 >= gr.start && tri * 3 < gr.start + gr.count) return m.material[gr.materialIndex ?? 0];
  return m.material[0];
}

export function collectTris(root: THREE.Object3D, opts: FaceAuditOptions = {}): Tri[] {
  const gap = opts.gap ?? GAP_TOLERANCE;
  root.updateMatrixWorld(true);
  const tris: Tri[] = [];
  const visible = (o: THREE.Object3D): boolean => o.visible && (!o.parent || visible(o.parent));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !visible(m)) return;
    const g = m.geometry;
    const p = g.getAttribute('position');
    const idx = g.index;
    const count = idx ? idx.count : p.count;
    const check = opts.checkMesh ? opts.checkMesh(m) : true;
    const flip = m.matrixWorld.determinant() < 0;
    for (let t = 0; t < count; t += 3) {
      const ia = idx ? idx.getX(t) : t;
      const ib = idx ? idx.getX(t + 1) : t + 1;
      const ic = idx ? idx.getX(t + 2) : t + 2;
      const a = new THREE.Vector3().fromBufferAttribute(p, ia).applyMatrix4(m.matrixWorld);
      let b = new THREE.Vector3().fromBufferAttribute(p, ib).applyMatrix4(m.matrixWorld);
      let c = new THREE.Vector3().fromBufferAttribute(p, ic).applyMatrix4(m.matrixWorld);
      if (flip) [b, c] = [c, b];
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const area2 = n.length();
      if (area2 < 1e-12) continue;
      n.divideScalar(area2);
      const mat = matOf(m, t / 3, g) as THREE.MeshStandardMaterial;
      if (mat.side === THREE.BackSide) n.negate();
      const alpha = mat.alphaTest > 0 || (mat.transparent && mat.opacity < 0.99);
      tris.push({
        n, a, b, d: c, c: a.clone().add(b).add(c).divideScalar(3), area: area2 / 2,
        slack: [(gap * c.distanceTo(a)) / area2, (gap * b.distanceTo(a)) / area2, (gap * c.distanceTo(b)) / area2],
        doubleSided: mat.side === THREE.DoubleSide, blocks: !alpha, check: check && !alpha && mat.side !== THREE.DoubleSide,
        mesh: m, index: t / 3,
      });
    }
  });
  return tris;
}

/** Minimal BVH over triangles (median split), flat arrays. */
class Bvh {
  private min: Float64Array;
  private max: Float64Array;
  private left: Int32Array;
  private right: Int32Array;
  private start: Int32Array;
  private cnt: Int32Array;
  private order: Int32Array;
  private nodes = 0;
  constructor(private tris: Tri[]) {
    const n = tris.length;
    const cap = Math.max(1, 2 * n);
    this.min = new Float64Array(cap * 3);
    this.max = new Float64Array(cap * 3);
    this.left = new Int32Array(cap);
    this.right = new Int32Array(cap);
    this.start = new Int32Array(cap);
    this.cnt = new Int32Array(cap);
    this.order = new Int32Array(n).map((_, i) => i);
    this.build(0, n);
  }
  private build(s: number, e: number): number {
    const id = this.nodes++;
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = this.tris[this.order[i]];
      for (const v of [t.a, t.b, t.d]) {
        mn[0] = Math.min(mn[0], v.x); mn[1] = Math.min(mn[1], v.y); mn[2] = Math.min(mn[2], v.z);
        mx[0] = Math.max(mx[0], v.x); mx[1] = Math.max(mx[1], v.y); mx[2] = Math.max(mx[2], v.z);
      }
    }
    for (let k = 0; k < 3; k++) { this.min[id * 3 + k] = mn[k] - 1e-6; this.max[id * 3 + k] = mx[k] + 1e-6; }
    if (e - s <= 4) { this.start[id] = s; this.cnt[id] = e - s; this.left[id] = -1; return id; }
    const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    const axis = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2;
    const key = (i: number) => this.tris[i].c.getComponent(axis);
    const sub = Array.from(this.order.subarray(s, e)).sort((x, y) => key(x) - key(y));
    this.order.set(sub, s);
    const mid = (s + e) >> 1;
    this.cnt[id] = 0;
    this.left[id] = this.build(s, mid);
    this.right[id] = this.build(mid, e);
    return id;
  }
  private boxT(id: number, o: THREE.Vector3, inv: THREE.Vector3): number {
    let t0 = 0, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      const oo = o.getComponent(k), ii = inv.getComponent(k);
      let a = (this.min[id * 3 + k] - oo) * ii, b = (this.max[id * 3 + k] - oo) * ii;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return Infinity;
    }
    return t0;
  }
  /** Visit every triangle hit by the ray (any order). */
  hits(o: THREE.Vector3, dir: THREE.Vector3, visit: (tri: Tri, t: number) => boolean): boolean {
    const inv = new THREE.Vector3(1 / dir.x, 1 / dir.y, 1 / dir.z);
    const stack = [0];
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), pv = new THREE.Vector3(), tv = new THREE.Vector3(), qv = new THREE.Vector3();
    while (stack.length) {
      const id = stack.pop()!;
      if (this.boxT(id, o, inv) === Infinity) continue;
      if (this.left[id] >= 0) { stack.push(this.left[id], this.right[id]); continue; }
      for (let i = this.start[id]; i < this.start[id] + this.cnt[id]; i++) {
        const t = this.tris[this.order[i]];
        e1.subVectors(t.b, t.a); e2.subVectors(t.d, t.a);
        pv.crossVectors(dir, e2);
        const det = e1.dot(pv);
        if (Math.abs(det) < 1e-14) continue;
        const id2 = 1 / det;
        tv.subVectors(o, t.a);
        const u = tv.dot(pv) * id2;
        if (u < -t.slack[0] || u > 1 + t.slack[0] + t.slack[1]) continue;
        qv.crossVectors(tv, e1);
        const v = dir.dot(qv) * id2;
        if (v < -t.slack[1] || u + v > 1 + t.slack[2]) continue;
        const tt = e2.dot(qv) * id2;
        if (tt > 0 && visit(t, tt)) return true;
      }
    }
    return false;
  }
}

/** Directions sampled in the culled half-space: straight back plus four at 45 deg. */
function backDirs(n: THREE.Vector3): THREE.Vector3[] {
  const t = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(n, t).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const back = n.clone().negate();
  const k = Math.SQRT1_2;
  return [back, ...[u, u.clone().negate(), v, v.clone().negate()].map((s) => back.clone().multiplyScalar(k).addScaledVector(s, k))];
}

/** Two directions tilted about 3 degrees off d, in perpendicular planes. */
function jitter(d: THREE.Vector3): THREE.Vector3[] {
  const t = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(d, t).normalize();
  const v = new THREE.Vector3().crossVectors(d, u);
  return [d.clone().addScaledVector(u, 0.05).normalize(), d.clone().addScaledVector(v, -0.05).normalize()];
}

/** Triangles whose culled side can be seen from outside the part. */
export function exposedFaces(root: THREE.Object3D, opts: FaceAuditOptions = {}): Tri[] {
  const tris = collectTris(root, opts);
  if (opts.covers?.length) {
    const host = new THREE.Group();
    for (const g of opts.covers) host.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
    tris.push(...collectTris(host, { gap: opts.gap }));
  }
  const occluders = tris.filter((t) => t.blocks);
  if (!occluders.length) return [];
  const bvh = new Bvh(occluders);
  const out: Tri[] = [];
  const back = new THREE.Vector3();
  const behind = opts.behind ?? BEHIND_TOLERANCE;
  for (const tri of tris) {
    if (!tri.check) continue;
    // Rays start on the face itself (it is excluded), so a surface touching it still counts.
    const escapes = (d: THREE.Vector3): boolean => {
      if (bvh.hits(tri.c, d, (h) => h !== tri && (h.doubleSided || h.n.dot(d) > 1e-6))) return false;
      return !bvh.hits(tri.c, back.copy(d).negate(), (h, tt) => h !== tri && tt < behind && (h.doubleSided || h.n.dot(d) > 1e-6));
    };
    // A ray can slip along a zero-width crack between triangles; a real opening also lets a slightly tilted ray out.
    if (backDirs(tri.n).some((d) => escapes(d) && jitter(d).some((j) => j.dot(tri.n) < 0 && escapes(j)))) out.push(tri);
  }
  return out;
}
