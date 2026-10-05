import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Tessellation detail for part templates: 1 = full ('high'), 0.5 = 'low' LOD. Set only while a
 * template is being built (see buildPartMesh); builders keep using nominal segment counts.
 */
let DETAIL = 1;
export function withDetail<T>(d: number, f: () => T): T {
  const prev = DETAIL;
  DETAIL = d;
  try {
    return f();
  } finally {
    DETAIL = prev;
  }
}
export const detailLevel = () => DETAIL;
/** Scale a segment count by the current detail (full circles keep at least `min`). */
const seg = (n: number, min = 6) => (DETAIL === 1 ? n : Math.max(Math.min(n, min), Math.round(n * DETAIL)));

/** Profile point [radius, y]. Repeat a point to create a hard crease. */
export type Profile = Array<[number, number]>;

export interface LatheOpts {
  segments?: number;
  /** Texture tile size in metres (UVs = metres / tile). Default 1. */
  tile?: number;
  /** Override: number of texture repeats around the circumference. */
  uRepeat?: number;
  phiStart?: number;
  phiLength?: number;
  /** Add to v (metres) so stacked sections continue the texture seamlessly. */
  vOffset?: number;
  /** Auto-crease where the profile turns by more than this angle (radians). Default 35 deg. */
  creaseAngle?: number;
}

/** Duplicate profile points where the outline turns sharply so normals don't smear. */
function autoCrease(profile: Profile, maxAngle: number): Profile {
  const out: Profile = [];
  const n = profile.length;
  for (let j = 0; j < n; j++) {
    out.push(profile[j]);
    if (j === 0 || j === n - 1) continue;
    const a = profile[j - 1];
    const b = profile[j];
    const c = profile[j + 1];
    const d1x = b[0] - a[0];
    const d1y = b[1] - a[1];
    const d2x = c[0] - b[0];
    const d2y = c[1] - b[1];
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue; // already a crease
    const cos = (d1x * d2x + d1y * d2y) / (l1 * l2);
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > maxAngle) out.push(b);
  }
  return out;
}

/**
 * Lathe around +Y with analytic smooth normals (creases where points repeat) and metric UVs.
 * Profile is normally ordered bottom -> top for outward-facing surfaces.
 */
export function lathe(profileIn: Profile, opts: LatheOpts = {}): THREE.BufferGeometry {
  const profile = autoCrease(profileIn, opts.creaseAngle ?? (35 * Math.PI) / 180);
  const phi0 = opts.phiStart ?? 0;
  const phiL = opts.phiLength ?? Math.PI * 2;
  const segs = seg(opts.segments ?? 48, phiL > 6 ? 8 : 1);
  const tile = opts.tile ?? 1;
  const rMax = Math.max(...profile.map((p) => p[0]), 1e-3);
  const uRep = opts.uRepeat ?? Math.max(1, Math.round((rMax * phiL) / tile));
  const n = profile.length;
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

  // per-profile-point 2D normal and arc length
  const nr: number[] = [];
  const ny: number[] = [];
  const vs: number[] = [];
  let acc = opts.vOffset ?? 0;
  for (let j = 0; j < n; j++) {
    if (j > 0 && !same(profile[j], profile[j - 1])) acc += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
    vs.push(acc / tile);
    const prev = j > 0 && !same(profile[j], profile[j - 1]) ? profile[j - 1] : null;
    const next = j < n - 1 && !same(profile[j], profile[j + 1]) ? profile[j + 1] : null;
    let tr = 0;
    let ty = 0;
    const p = profile[j];
    if (prev) {
      const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      tr += (p[0] - prev[0]) / l;
      ty += (p[1] - prev[1]) / l;
    }
    if (next) {
      const l = Math.hypot(next[0] - p[0], next[1] - p[1]);
      tr += (next[0] - p[0]) / l;
      ty += (next[1] - p[1]) / l;
    }
    const l = Math.hypot(tr, ty) || 1;
    nr.push(ty / l);
    ny.push(-tr / l);
  }

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = phi0 + (i / segs) * phiL;
    const s = Math.sin(a);
    const c = Math.cos(a);
    for (let j = 0; j < n; j++) {
      const [r, y] = profile[j];
      pos.push(r * s, y, r * c);
      nor.push(nr[j] * s, ny[j], nr[j] * c);
      uv.push((i / segs) * uRep, vs[j]);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < n - 1; j++) {
      if (same(profile[j], profile[j + 1])) continue;
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c2 = (i + 1) * n + j + 1;
      const d = i * n + j + 1;
      idx.push(a, b, d, b, c2, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Fix winding so faces agree with analytic normals.
  if (idx.length >= 3) {
    const pa = new THREE.Vector3().fromArray(pos, idx[0] * 3);
    const pb = new THREE.Vector3().fromArray(pos, idx[1] * 3);
    const pc = new THREE.Vector3().fromArray(pos, idx[2] * 3);
    const fn = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    // find a face with non-degenerate area to test
    let k = 0;
    while (fn.lengthSq() < 1e-14 && k + 5 < idx.length) {
      k += 3;
      pa.fromArray(pos, idx[k] * 3);
      pb.fromArray(pos, idx[k + 1] * 3);
      pc.fromArray(pos, idx[k + 2] * 3);
      fn.crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    }
    const vn = new THREE.Vector3().fromArray(nor, idx[k] * 3);
    if (fn.dot(vn) < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  }
  g.setIndex(idx);
  return g;
}

/** Closed cylinder (sides + caps) via lathe so UVs are metric. */
export function cylinder(rTop: number, rBot: number, h: number, opts: LatheOpts & { y?: number; caps?: boolean } = {}): THREE.BufferGeometry {
  const y0 = (opts.y ?? 0) - h / 2;
  const y1 = (opts.y ?? 0) + h / 2;
  const p: Profile = [];
  if (opts.caps !== false) p.push([0, y0], [rBot, y0]);
  p.push([rBot, y0]);
  p.push([rTop, y1]);
  if (opts.caps !== false) p.push([rTop, y1], [0, y1]);
  return lathe(p, opts);
}

/** Simple three.js cylinder primitive (cheap, unit UVs), centred at y. */
export function cyl(rTop: number, rBot: number, h: number, segments = 16, y = 0, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg(segments), 1, open);
  g.translate(0, y, 0);
  return g;
}

/** Box with UVs scaled to metres / tile on every face. */
export function box(w: number, h: number, d: number, tile = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  return g;
}

export function sphere(r: number, w = 20, h = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg(w, 8), seg(h, 6));
}

export function torus(R: number, r: number, radial = 10, tubular = 40): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, r, seg(radial, 4), seg(tubular, 8));
  g.rotateX(Math.PI / 2); // lie in XZ plane around Y
  return g;
}

/** Smooth pipe through points. */
export function pipe(points: [number, number, number][], radius: number, radialSeg = 8, tubularSeg?: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  return new THREE.TubeGeometry(curve, seg(tubularSeg ?? Math.max(8, points.length * 8), 6), radius, seg(radialSeg, 4), false);
}

/** Rod between two points. */
export function rod(a: [number, number, number], b: [number, number, number], r: number, segments = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg(segments, 4), 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** n copies of geo placed around the Y axis at radius r; geo's +Z faces outward. */
export function around(geo: THREE.BufferGeometry, n: number, r: number, phase = 0, y = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const g = geo.clone();
    g.rotateY(a);
    g.translate(r * Math.sin(a), y, r * Math.cos(a));
    out.push(g);
  }
  return out;
}

/** Merge geometries (normalising attributes and indexing). */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const anyNonIndexed = geos.some((g) => !g.index);
  const prepared = geos.map((g) => {
    let h = anyNonIndexed && g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(h.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') h.deleteAttribute(name);
    if (!h.getAttribute('uv')) {
      h = h.clone();
      h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((h.getAttribute('position').count) * 2), 2));
    }
    if (!h.getAttribute('normal')) h.computeVertexNormals();
    h.clearGroups();
    return h;
  });
  const m = mergeGeometries(prepared, false);
  if (!m) throw new Error('mergeGeometries failed');
  return m;
}

export function mk(geo: THREE.BufferGeometry | THREE.BufferGeometry[], mat: THREE.Material | THREE.Material[], name?: string): THREE.Mesh {
  const g = Array.isArray(geo) ? merge(geo) : geo;
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

/** Group helper. */
export function grp(name?: string, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (name) g.name = name;
  for (const c of children) g.add(c);
  return g;
}

/** Bell-nozzle contour from throat (s=0) to exit (s=1). */
export function bellRadius(s: number, rThroat: number, rExit: number, k: number): number {
  return rThroat + (rExit - rThroat) * (1 - Math.pow(1 - s, k));
}

/**
 * Deploy animation metadata stored on an object's userData (JSON-safe so clones keep it).
 * `setPartDeploy(root, t)` interpolates every node that has it.
 */
export interface DeployData {
  pos0?: [number, number, number];
  pos1?: [number, number, number];
  rot0?: [number, number, number];
  rot1?: [number, number, number];
  scale0?: [number, number, number];
  scale1?: [number, number, number];
  /** Node visible only when t > this. */
  visibleAbove?: number;
}

export function setDeployData(o: THREE.Object3D, d: DeployData) {
  o.userData.deploy = d;
}
