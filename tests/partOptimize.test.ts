import { expect, it } from 'vitest';
import * as THREE from 'three';
import { PART_CATALOG } from '../src/data/parts';
import { MESH_BUILDERS, setPartDeploy } from '../src/render/parts';
import { optimizePartTemplate } from '../src/render/parts/optimize';

/** Per material: triangle count and a world-space vertex checksum (order independent). */
function signature(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const out = new Map<string, { tris: number; sum: number; draws: number }>();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    let p: THREE.Object3D | null = o; while (p) { if (!p.visible) return; p = p.parent; }
    const g = o.geometry; const pos = g.attributes.position; const index = g.index;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0]; if (!m) continue;
      const e = out.get(m.uuid) ?? { tris: 0, sum: 0, draws: 0 };
      e.draws++;
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
        e.sum += v.x * 1.3 + v.y * 1.7 + v.z * 2.1;
      }
      e.tris += gr.count / 3;
      out.set(m.uuid, e);
    }
  });
  return out;
}

it('part template optimisation keeps every triangle, material and pose while cutting draws', () => {
  let before = 0, after = 0;
  const seen = new Set<string>();
  for (const def of PART_CATALOG.values()) {
    if (seen.has(def.mesh + def.id)) continue; seen.add(def.mesh + def.id);
    const builder = MESH_BUILDERS[def.mesh];
    if (!builder) continue;
    for (const deploy of [0, 1]) {
      const raw = builder(def); setPartDeploy(raw, deploy);
      const opt = builder(def); optimizePartTemplate(opt); setPartDeploy(opt, deploy);
      const a = signature(raw), b = signature(opt);
      expect([...b.keys()].sort(), def.id).toEqual([...a.keys()].sort());
      for (const [k, x] of a) {
        const y = b.get(k)!;
        expect(y.tris, `${def.id} tris`).toBe(x.tris);
        expect(Math.abs(y.sum - x.sum), `${def.id} geometry`).toBeLessThan(1e-3 * Math.max(1, Math.abs(x.sum)));
        if (deploy === 0) { before += x.draws; after += y.draws; }
      }
    }
  }
  expect(after).toBeLessThan(before);
  console.info(`part draws (one of each part): ${before} → ${after}`);
});
