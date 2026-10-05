/**
 * Headless part-mesh statistics (triangles, meshes, distinct materials) for the art pass.
 * Usage: npx tsx scripts/art/partStats.ts [--json]
 */
import * as THREE from 'three';
import { PART_DEFS } from '../../src/data/parts';
import { buildPartMesh } from '../../src/render/parts';

const rows: { id: string; tris: number; meshes: number; mats: number }[] = [];
const allMats = new Set<string>();
for (const def of PART_DEFS) {
  const o = buildPartMesh(def);
  let tris = 0;
  let meshes = 0;
  const mats = new Set<string>();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      mats.add(mat.name || mat.uuid);
      allMats.add(mat.name || mat.uuid);
    }
  });
  rows.push({ id: def.id, tris, meshes, mats: mats.size });
}
rows.sort((a, b) => b.tris - a.tris);
const sum = rows.reduce((s, r) => s + r.tris, 0);
const med = rows.map((r) => r.tris).sort((a, b) => a - b)[rows.length >> 1];
if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, sum, med, materials: [...allMats].sort() }, null, 1));
else {
  console.log(`parts ${rows.length}  total tris ${sum}  mean ${Math.round(sum / rows.length)}  median ${med}  max ${rows[0].id} ${rows[0].tris}`);
  console.log(`distinct materials ${allMats.size}; mean meshes/part ${(rows.reduce((s, r) => s + r.meshes, 0) / rows.length).toFixed(1)}; mean materials/part ${(rows.reduce((s, r) => s + r.mats, 0) / rows.length).toFixed(1)}`);
  for (const r of rows.slice(0, 12)) console.log(`  ${r.id.padEnd(22)} ${String(r.tris).padStart(6)} tris  ${r.meshes} meshes  ${r.mats} mats`);
}
