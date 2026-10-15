import '../earth-data/register';
/**
 * Part template build cost (dominated by the per-vertex AO bake) over the whole catalogue, at both detail levels.
 * `--dump <file>` writes a hash of every template's vertex colours, to check an AO change is bit-identical.
 * Usage: npx tsx scripts/bench/partao.ts [--dump out.json]
 */
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PART_CATALOG } from '../../src/data/parts';
import { buildPartMesh, disposePartMeshCache } from '../../src/render/parts';
const dump = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
const defs = [...PART_CATALOG.values()];
const runs: number[] = [];
const hashes: Record<string, string> = {};
for (let r = 0; r < 3; r++) {
  disposePartMeshCache();
  const t = performance.now();
  for (const def of defs) for (const detail of ['high', 'low'] as const) {
    const obj = buildPartMesh(def, detail);
    if (r || !dump) continue;
    const h = createHash('sha1');
    obj.traverse((o) => { const c = (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.getAttribute('color'); if (c) h.update(new Uint8Array((c.array as Float32Array).buffer.slice(0))); });
    hashes[`${def.id}:${detail}`] = h.digest('hex');
  }
  runs.push(performance.now() - t);
}
console.log(JSON.stringify({ name: 'partTemplates', parts: defs.length, runsMs: runs.map((x) => +x.toFixed(0)) }));
if (dump) writeFileSync(dump, JSON.stringify(hashes, null, 1));
