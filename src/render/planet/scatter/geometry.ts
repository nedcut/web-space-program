import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Original, faceted silhouettes; the bottom of every asset is y=0. Rocks are sunk 18 % of their height (the
 * placement puts y=0 on the terrain, which is flat only at the instance origin) and carry a vertex-colour
 * occlusion term that darkens their buried flanks, so they read as embedded rather than resting on a point.
 */
export function rockGeometry(variant: number): THREE.BufferGeometry {
  // Small pebbles (variant 0) stay at 20 faces; the larger variants get 80.
  const g = new THREE.IcosahedronGeometry(1, variant === 0 ? 0 : 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 0.8 + 0.12 * Math.sin(x * 13 + y * 7 + z * 17 + variant * 3) + 0.08 * Math.sin(x * 5 - z * 9 + variant);
    // Flatter tops and bases: blocky ejecta fragments rather than gems.
    const yy = Math.sign(y) * Math.pow(Math.abs(y), 0.75);
    p.setXYZ(i, x * r, (yy * r + 1) * (0.42 + variant * 0.08), z * r * (0.8 + variant * 0.12));
  }
  g.computeBoundingBox();
  const h = g.boundingBox!.max.y - g.boundingBox!.min.y;
  g.translate(0, -g.boundingBox!.min.y - 0.18 * h, 0);
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  flat.computeVertexNormals();
  const q = flat.getAttribute('position');
  const color = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i++) {
    const t = Math.min(1, Math.max(0, (q.getY(i) + 0.05) / (0.45 * h)));
    color.fill(0.42 + 0.58 * t * t * (3 - 2 * t), i * 3, i * 3 + 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return flat;
}

/** Unit disc (radius 1, y = 0) for the rocks' contact/cast shadow blobs; `uv` keeps the undistorted position. */
export function shadowBlobGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  return g;
}

export function plantGeometry(kind: 'grass' | 'bush' | 'tree'): THREE.BufferGeometry {
  if (kind === 'grass') {
    const verts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI / 5, x = Math.cos(a) * 0.3, z = Math.sin(a) * 0.3;
      verts.push(-x, 0, -z, x, 0, z, x * 0.4, 0.8 + i * 0.06, z * 0.4);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.computeVertexNormals(); return g;
  }
  if (kind === 'tree') {
    return coastalTreeGeometry().scale(0.27, 0.27, 0.27);
  }
  const g = new THREE.IcosahedronGeometry(0.7, 1);
  g.translate(0, 0.7, 0); return g;
}

/**
 * Wind-shaped coastal pine: exposed trunk, branching limbs and irregular rounded needle crowns.
 * `mid` is the distant level (a few pixels tall): no limbs (sub-pixel), a 5-sided uncapped trunk and 20-face
 * crowns with the same placement, scale and tint, shaded smooth so their silhouettes read round — ~5× fewer
 * triangles than `full`.
 */
export function coastalTreeGeometry(detail: 'full' | 'mid' = 'full'): THREE.BufferGeometry {
  const mid = detail === 'mid';
  const pieces: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, tint: number[]) => {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    const p = geo.getAttribute('position');
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const ao = 0.68 + Math.max(0, p.getY(i)) * 0.028;
      c.set(tint.map(v => v * ao), i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    pieces.push(geo);
  };
  add(new THREE.CylinderGeometry(0.15, 0.34, 8.5, mid ? 5 : 7, 1, mid).translate(0, 4.25, 0), [0.8, 0.57, 0.35]);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996, spread = i === 6 ? 0 : 1.6 + Math.sin(i * 7) * 0.5;
    const x = Math.cos(a) * spread, z = Math.sin(a) * spread, y = 5.8 + i * 0.67;
    if (!mid) {
      const branch = new THREE.CylinderGeometry(0.07, 0.15, Math.hypot(spread, 1.3), 5);
      branch.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 1.3, z).normalize()));
      add(branch.translate(x * 0.5, y - 0.65, z * 0.5), [0.8, 0.57, 0.35]);
    }
    const crown = new THREE.IcosahedronGeometry(1, mid ? 0 : 1);
    const p = crown.getAttribute('position');
    for (let j = 0; j < p.count; j++) {
      const k = 1 + 0.16 * Math.sin(p.getX(j) * 13 + p.getY(j) * 9 + i);
      p.setXYZ(j, p.getX(j) * k, p.getY(j) * k, p.getZ(j) * k);
    }
    if (mid) smoothSphereNormals(crown); else crown.computeVertexNormals();
    add(crown.scale(1.9, 1.15, 1.65).translate(x, y, z), [0.95 + i * 0.015, 1, 0.8]);
  }
  const merged = mergeGeometries(pieces)!;
  pieces.forEach(g => g.dispose());
  return merged;
}

/** Normals of a (non-indexed) blob as if it were a sphere about its centre: round shading on few faces. */
export function smoothSphereNormals(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position'), n = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.set([v.x, v.y, v.z], i * 3); }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}
