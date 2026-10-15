import '../earth-data/register';
/** Engine-soot bake CPU cost per stock craft (flight bakes it synchronously; the editor in idle turns). */
import * as THREE from 'three';
import { performance } from 'node:perf_hooks';
import { STOCK_CRAFTS } from '../../src/editor/stockCrafts';
import { PART_CATALOG } from '../../src/data/parts';
import { buildVessel } from '../../src/sim/vessel';
import { VesselView } from '../../src/render/vessel/VesselView';
import { bakeEngineSoot, prepareEngineSoot } from '../../src/render/parts/soot';
const filter = process.argv[2];
for (const craft of STOCK_CRAFTS) {
  if (filter && !craft.id.includes(filter)) continue;
  const v = buildVessel(craft.build(), PART_CATALOG), view = new VesselView(v);
  view.update({ x: 0, y: 0, z: 0 }, 0, 0, .02);
  const inner = (view as unknown as { inner: THREE.Object3D }).inner;
  const parts = [...(view as unknown as { parts: Map<number, { object: THREE.Object3D }> }).parts.values()].map(p => p.object);
  let verts = 0; inner.traverse(o => { if ((o as THREE.Mesh).isMesh) verts += (o as THREE.Mesh).geometry.getAttribute('position').count; });
  const runs: number[] = [];
  for (let r = 0; r < 5; r++) { const t = performance.now(); bakeEngineSoot(parts, inner); runs.push(performance.now() - t); }
  runs.sort((a, b) => a - b);
  const apply = prepareEngineSoot(parts, inner);
  let worstPart = 0;
  for (const p of parts) { const t = performance.now(); apply([p]); worstPart = Math.max(worstPart, performance.now() - t); }
  console.log(JSON.stringify({ name: `soot/${craft.id}`, parts: parts.length, verts, medianMs: +runs[2].toFixed(2), worstPartMs: +worstPart.toFixed(2) }));
  view.dispose();
}
