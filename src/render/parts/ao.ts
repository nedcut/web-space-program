import * as THREE from 'three';

/**
 * Baked per-vertex ambient occlusion for part templates (once per template, before optimizePartTemplate).
 *
 * Each rigid group of a template (the root, plus every deployable/animated subtree) is voxelised, and each
 * vertex casts a fixed cosine-weighted ray set through the grid; nearer hits occlude more. The result
 * multiplies an existing `color` attribute (builders bake grime/soot gradients there) or creates one. Every
 * part material enables `vertexColors`, so this costs one vertex attribute and no shader variants.
 * Moving subtrees only occlude themselves, so a stowed leg never leaves a baked shadow on a deployed one.
 */

const RAYS = 24;
const DIRS: number[] = [];
{
  const sin2Max = 1 - Math.cos((74 * Math.PI) / 180) ** 2;
  for (let i = 0; i < RAYS; i++) {
    const sinT = Math.sqrt(((i + 0.5) / RAYS) * sin2Max); // cosine-weighted, grazing rays excluded
    const phi = i * 2.399963229728653;
    DIRS.push(sinT * Math.cos(phi), sinT * Math.sin(phi), Math.sqrt(1 - sinT * sinT));
  }
}

/** Subtrees that move relative to their parent (deploy animation, gear, control surfaces, EVA limbs). */
const MOVING = /^(controlSurface|gear\w+|arm-?\d|leg-?\d)$/;
const isGroupRoot = (o: THREE.Object3D, root: THREE.Object3D) => o !== root && (!!o.userData.deploy || MOVING.test(o.name));

const baked = new WeakSet<THREE.BufferGeometry>();

interface Entry { mesh: THREE.Mesh; toGroup: THREE.Matrix4; occludes: boolean }

export interface AOOptions {
  /** 0..1 darkening at full occlusion. */
  strength?: number;
}

export function bakePartAO(root: THREE.Object3D, opts: AOOptions = {}): void {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Object3D, Entry[]>();
  const visit = (o: THREE.Object3D, group: THREE.Object3D, hidden: boolean) => {
    const g = isGroupRoot(o, root) ? o : group;
    const h = hidden || !o.visible;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && mesh.geometry?.getAttribute('position')) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const decal = mats.some((m) => m.name === 'decal');
      const occludes = !h && !decal && !mats.some((m) => m.transparent || m.side === THREE.BackSide);
      let list = groups.get(g);
      if (!list) groups.set(g, (list = []));
      list.push({ mesh, toGroup: new THREE.Matrix4(), occludes });
    }
    for (const c of o.children) visit(c, g, h);
  };
  visit(root, root, false);
  const strength = opts.strength ?? 0.8;
  const own = new Set<THREE.BufferGeometry>();
  for (const [group, entries] of groups) {
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    for (const e of entries) {
      e.toGroup.multiplyMatrices(inv, e.mesh.matrixWorld);
      // Shared geometry (within or across templates) gets its own copy so each placement keeps its own AO.
      if (own.has(e.mesh.geometry) || baked.has(e.mesh.geometry)) e.mesh.geometry = e.mesh.geometry.clone();
      own.add(e.mesh.geometry);
    }
    bakeGroup(entries, strength);
    for (const e of entries) baked.add(e.mesh.geometry);
  }
}

function worldPositions(e: Entry): Float32Array {
  const p = e.mesh.geometry.getAttribute('position');
  const out = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(e.toGroup);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

function bakeGroup(entries: Entry[], strength: number) {
  const pos = entries.map(worldPositions);
  const box = new THREE.Box3();
  for (const p of pos) for (let i = 0; i < p.length; i += 3) box.expandByPoint(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const ext = Math.max(size.x, size.y, size.z, 1e-3);
  let cell = Math.max(ext / 96, 0.008);
  const MAXD = 150;
  const dim = (s: number) => Math.ceil(s / cell) + 6;
  while (dim(size.x) * dim(size.y) * dim(size.z) > MAXD * MAXD * MAXD) cell *= 1.15;
  const nx = dim(size.x), ny = dim(size.y), nz = dim(size.z);
  const ox = box.min.x - 3 * cell, oy = box.min.y - 3 * cell, oz = box.min.z - 3 * cell;
  const grid = new Uint8Array(nx * ny * nz);
  const inv = 1 / cell;
  const mark = (x: number, y: number, z: number) => {
    const i = Math.floor((x - ox) * inv), j = Math.floor((y - oy) * inv), k = Math.floor((z - oz) * inv);
    grid[(k * ny + j) * nx + i] = 1;
  };

  // Rasterise occluding triangles by barycentric sampling at under a cell's spacing.
  entries.forEach((e, ei) => {
    if (!e.occludes) return;
    const p = pos[ei];
    const index = e.mesh.geometry.index;
    const tri = index ? index.count / 3 : p.length / 9;
    for (let t = 0; t < tri; t++) {
      const a = (index ? index.getX(t * 3) : t * 3) * 3;
      const b = (index ? index.getX(t * 3 + 1) : t * 3 + 1) * 3;
      const c = (index ? index.getX(t * 3 + 2) : t * 3 + 2) * 3;
      const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
      const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
      const l = Math.max(Math.hypot(abx, aby, abz), Math.hypot(acx, acy, acz), Math.hypot(abx - acx, aby - acy, abz - acz));
      const n = Math.min(600, Math.max(1, Math.ceil(l / (cell * 0.6))));
      for (let i = 0; i <= n; i++)
        for (let j = 0; i + j <= n; j++) {
          const u = i / n, v = j / n;
          mark(p[a] + abx * u + acx * v, p[a + 1] + aby * u + acy * v, p[a + 2] + abz * u + acz * v);
        }
    }
  });

  const reach = Math.min(0.9, Math.max(0.18, ext * 0.22));
  const steps = Math.max(4, Math.min(28, Math.ceil(reach / cell)));
  const nrm = new THREE.Matrix3();
  const N = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3();
  entries.forEach((e, ei) => {
    const g = e.mesh.geometry;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const na = g.getAttribute('normal');
    const p = pos[ei];
    const count = na.count;
    nrm.getNormalMatrix(e.toGroup);
    const prev = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    const col = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      N.fromBufferAttribute(na, v).applyMatrix3(nrm);
      if (N.lengthSq() < 1e-12) N.set(0, 1, 0);
      N.normalize();
      T.set(Math.abs(N.x) < 0.9 ? 1 : 0, Math.abs(N.x) < 0.9 ? 0 : 1, 0).cross(N).normalize();
      B.crossVectors(N, T);
      const sx = p[v * 3] + N.x * cell * 2.1, sy = p[v * 3 + 1] + N.y * cell * 2.1, sz = p[v * 3 + 2] + N.z * cell * 2.1;
      let occ = 0;
      for (let r = 0; r < RAYS; r++) {
        const a = DIRS[r * 3], b = DIRS[r * 3 + 1], c = DIRS[r * 3 + 2];
        const dx = (T.x * a + B.x * b + N.x * c) * cell, dy = (T.y * a + B.y * b + N.y * c) * cell, dz = (T.z * a + B.z * b + N.z * c) * cell;
        for (let s = 0; s < steps; s++) {
          const i = Math.floor((sx + dx * s - ox) * inv), j = Math.floor((sy + dy * s - oy) * inv), k = Math.floor((sz + dz * s - oz) * inv);
          if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) break;
          if (grid[(k * ny + j) * nx + i]) {
            const f = s / steps;
            occ += 1 - f * f;
            break;
          }
        }
      }
      const ao = Math.max(0.25, 1 - strength * Math.pow(occ / RAYS, 0.85));
      col[v * 3] = ao * (prev ? prev.getX(v) : 1);
      col[v * 3 + 1] = ao * (prev ? prev.getY(v) : 1);
      col[v * 3 + 2] = ao * (prev ? prev.getZ(v) : 1);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  });
}
