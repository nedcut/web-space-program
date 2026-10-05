import { expect, it } from 'vitest';
import * as THREE from 'three';
import { PART_CATALOG } from '../src/data/parts';
import { buildVessel } from '../src/sim/vessel/assembly';
import { stackCraft } from '../src/sim/vessel/testing';
import { VesselView } from '../src/render/vessel/VesselView';
import { defaultBindings } from '../src/input/bindings';

it('toggles per-part stress colours through static batching and restores original materials', () => {
  const v = buildVessel(stackCraft(['tank-1-mid', 'tank-1-mid'], PART_CATALOG), PART_CATALOG);
  const view = new VesselView(v);
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  view.root.traverse(o => { if (o instanceof THREE.Mesh && o.userData.batchedVisible) originals.set(o, o.material); });
  expect(originals.size).toBeGreaterThan(0);
  v.cache.jointLoads = new Map([[2, { force: { x: 0, y: 0, z: 0 }, torque: { x: 0, y: 0, z: 0 }, fraction: 1.2 }]]);
  view.setStressOverlay(true);
  view.update({ x: 0, y: 0, z: 0 }, 0, 0, 0);
  const colors = new Set<string>();
  for (const mesh of originals.keys()) {
    expect(mesh.visible).toBe(true);
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    colors.add((mesh.material as THREE.MeshBasicMaterial).color.getHexString());
  }
  expect(colors.size).toBe(2); // root green, overloaded attachment red
  view.setStressOverlay(false);
  for (const [mesh, material] of originals) expect(mesh.material).toBe(material);
  expect(defaultBindings().stressOverlay).toEqual(['F4']);
  view.dispose();
});
