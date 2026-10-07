/**
 * Per-part triangle counts at High and Low part detail, grouped by mesh builder (art pass budgets).
 * Usage: npx tsx scripts/art/partBudget.ts [meshKind,...] [--json]
 */
import * as THREE from 'three';
import { PART_DEFS } from '../../src/data/parts';
import { buildPartMesh } from '../../src/render/parts';

const tris = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};
const filter = process.argv[2] && !process.argv[2].startsWith('--') ? new Set(process.argv[2].split(',')) : null;
const rows = PART_DEFS.filter((d) => !filter || filter.has(d.mesh)).map((d) => ({ id: d.id, mesh: d.mesh, high: tris(buildPartMesh(d, 'high')), low: tris(buildPartMesh(d, 'low')) }));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const r of rows.sort((a, b) => a.mesh.localeCompare(b.mesh) || b.high - a.high)) console.log(`${r.mesh.padEnd(16)} ${r.id.padEnd(24)} ${String(r.high).padStart(6)} ${String(r.low).padStart(6)}`);
