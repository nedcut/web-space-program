import * as THREE from 'three';
import { expect, it } from 'vitest';
import { buildVessel } from '../src/sim/vessel/assembly';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { VesselView } from '../src/render/vessel/VesselView';

/** Visible meshes under a deploy node (individually drawn deployables). */
function liveDeployMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.deploy) { out.push(o); return; }
  });
  return out;
}
const visibleMeshes = (root: THREE.Object3D) => { let n = 0; root.traverseVisible(o => { if (o instanceof THREE.Mesh) n++; }); return n; };

it('batches settled solar arrays and restores them before they move again', () => {
  const craft = STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build();
  const vessel = buildVessel(craft, PART_CATALOG);
  const panels = vessel.parts.filter(p => p.def.modules.some(m => m.type === 'solarPanel' && m.tracking));
  expect(panels.length).toBeGreaterThan(0);
  const view = new VesselView(vessel);
  const step = (n: number) => { for (let i = 0; i < n; i++) view.update({ x: 0, y: 0, z: 0 }, i * 0.02, 0, 0.02); };
  // Arrays extend over ~1.7 s; while moving they are drawn individually.
  step(20);
  const moving = liveDeployMeshes(view.root).length;
  expect(moving).toBeGreaterThan(0);
  const drawnWhileMoving = visibleMeshes(view.root);
  step(200);
  expect(liveDeployMeshes(view.root)).toHaveLength(0);
  expect(visibleMeshes(view.root)).toBeLessThan(drawnWhileMoving);
  // Retracting restores the individual meshes in the same frame the pose changes.
  for (const p of panels) p.tweaks = { ...p.tweaks, extended: false };
  step(1);
  expect(liveDeployMeshes(view.root).length).toBe(moving);
  view.dispose();
});
