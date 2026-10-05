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
    const trunk = new THREE.CylinderGeometry(0.07, 0.12, 1.0, 6).translate(0, 0.5, 0);
    const lower = new THREE.ConeGeometry(0.8, 1.7, 7).translate(0, 1.55, 0);
    const upper = new THREE.ConeGeometry(0.55, 1.5, 7).translate(0, 2.3, 0);
    const pieces = [trunk, lower, upper].map((g, i) => {
      const tint = new Float32Array(g.getAttribute('position').count * 3);
      for (let j = 0; j < tint.length; j += 3) { tint[j] = i === 0 ? 2.5 : 1; tint[j + 1] = i === 0 ? 0.7 : 1; tint[j + 2] = i === 0 ? 0.5 : 1; }
      g.setAttribute('color', new THREE.BufferAttribute(tint, 3)); return g;
    });
    const tree = mergeGeometries(pieces)!;
    pieces.forEach(g => g.dispose()); return tree;
  }
  const g = new THREE.IcosahedronGeometry(0.7, 1);
  g.translate(0, 0.7, 0); return g;
}
