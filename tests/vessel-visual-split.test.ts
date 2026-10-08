import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { buildVessel, splitVessel } from '../src/sim/vessel/assembly';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { VesselView } from '../src/render/vessel/VesselView';

it('moves split part visuals and their heat geometry once, without matching another craft by UID', () => {
  const craft = STOCK_CRAFTS.find(c => c.id === 'stock-kestrel')!.build();
  const vessel = buildVessel(craft, PART_CATALOG), unrelated = buildVessel(craft, PART_CATALOG);
  const view = new VesselView(vessel), other = new VesselView(unrelated);
  const originals = new Set<THREE.Object3D>(); view.root.traverse(o => originals.add(o));
  const part = vessel.parts.find(p => p.uid !== vessel.rootUid && p.def.modules.some(m => m.type === 'engine'))!;
  const [piece] = splitVessel(vessel, [part.uid]);
  const split = new VesselView(piece, [other, view]);
  const transferred = new Set<THREE.Object3D>();
  split.root.traverse(o => { if (originals.has(o)) transferred.add(o); });
  expect(transferred.size).toBeGreaterThan(5);
  const mesh = [...transferred].find(o => o instanceof THREE.Mesh) as THREE.Mesh;
  const dispose = vi.fn(); mesh.geometry.addEventListener('dispose', dispose);
  view.update({ x: 0, y: 0, z: 0 }, 0, 0, .02);
  view.dispose(); other.dispose();
  expect(dispose).not.toHaveBeenCalled();
  split.update({ x: 0, y: 0, z: 0 }, 0, 0, .02);
  split.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});

it('defers a split piece\'s static batch until the breakup settles, then batches it', () => {
  const craft = STOCK_CRAFTS.find(c => c.id === 'stock-kestrel')!.build();
  const vessel = buildVessel(craft, PART_CATALOG);
  const view = new VesselView(vessel);
  const instanced = (v: VesselView) => { let n = 0; v.root.traverse(o => { if (o instanceof THREE.InstancedMesh || o.userData.ownedGeometry) n++; }); return n; };
  const hidden = (v: VesselView) => { let n = 0; v.root.traverse(o => { if (o.userData.batchedVisible) n++; }); return n; };
  expect(hidden(view)).toBeGreaterThan(0); // initial build batches immediately
  const part = vessel.parts.find(p => p.uid !== vessel.rootUid && p.def.modules.some(m => m.type === 'engine'))!;
  const [piece] = splitVessel(vessel, [part.uid]);
  const split = new VesselView(piece, [view]);
  expect(instanced(split)).toBe(0);
  expect(hidden(split)).toBe(0);
  view.update({ x: 0, y: 0, z: 0 }, 0, 0, .02);
  expect(hidden(view)).toBe(0); // the donor draws unbatched on the event frame too
  // Frames 10 ms apart: deferred batches are spaced in wall time across views.
  let clock = performance.now();
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  for (let i = 0; i < 40; i++) { clock += 10; split.update({ x: 0, y: 0, z: 0 }, 0, 0, .02); view.update({ x: 0, y: 0, z: 0 }, 0, 0, .02); }
  now.mockRestore();
  expect(hidden(split)).toBeGreaterThan(0);
  expect(hidden(view)).toBeGreaterThan(0);
  view.dispose(); split.dispose();
});
