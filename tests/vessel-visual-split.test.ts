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
