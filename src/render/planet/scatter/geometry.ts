import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original, faceted silhouettes; the bottom of every asset is y=0. */
export function rockGeometry(variant: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, variant === 2 ? 1 : 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 0.82 + 0.18 * Math.sin(x * 13 + y * 7 + z * 17 + variant * 3);
    p.setXYZ(i, x * r, (y * r + 1) * (0.42 + variant * 0.08), z * r * (0.8 + variant * 0.12));
  }
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox!.min.y, 0);
  g.computeVertexNormals(); return g;
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
