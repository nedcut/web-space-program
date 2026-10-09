import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildVessel } from '../src/sim/vessel/assembly';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { VesselView } from '../src/render/vessel/VesselView';
import { PartHeat } from '../src/render/fx/PartHeat';
import { buildStaticBatch, countMovingNodes, isMovingNode } from '../src/render/vessel/staticBatch';
import { allocateNodes, nodeRows, NODES_PER_ROW, releaseNodes } from '../src/render/core/rigidNodes';

type Internals = { nodes: THREE.Object3D[]; nodeBase: number; movingMeshes: THREE.Mesh[] };
const internals = (v: VesselView) => v as unknown as Internals;
/** Visible meshes under a deploy node that draw individually. */
function liveDeployMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh) || o.userData.ownedGeometry) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.deploy) { out.push(o); return; }
  });
  return out;
}
const step = (view: VesselView, n: number, t0 = 0) => { for (let i = 0; i < n; i++) view.update({ x: 0, y: 0, z: 0 }, t0 + i * 0.02, 0, 0.02); };
/** Slot transform applied to a point (rows are the 3×4 affine matrix). */
const apply = (rows: Float32Array, p: THREE.Vector3) => new THREE.Vector3(
  rows[0] * p.x + rows[1] * p.y + rows[2] * p.z + rows[3],
  rows[4] * p.x + rows[5] * p.y + rows[6] * p.z + rows[7],
  rows[8] * p.x + rows[9] * p.y + rows[10] * p.z + rows[11]);

describe('rigid node batching', () => {
  it('batches moving solar arrays at once and moves them through their node slots', () => {
    const craft = STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build();
    const vessel = buildVessel(craft, PART_CATALOG);
    const panels = vessel.parts.filter(p => p.def.modules.some(m => m.type === 'solarPanel' && m.tracking));
    expect(panels.length).toBeGreaterThan(0);
    const view = new VesselView(vessel);
    step(view, 1);
    const { nodes, nodeBase, movingMeshes } = internals(view);
    expect(nodeBase).toBeGreaterThan(0);
    const deploy = nodes.filter(n => n.userData.deploy);
    expect(deploy.length).toBeGreaterThan(0);
    expect(movingMeshes.length).toBeGreaterThan(0);
    // Arrays extend over ~1.7 s; they stay merged the whole time.
    step(view, 20, 0.02);
    expect(liveDeployMeshes(view.root)).toHaveLength(0);
    const i = nodes.indexOf(deploy[0]);
    const mid = Array.from(nodeRows(nodeBase + i));
    const version = movingMeshes[0].userData.casterVersion;
    step(view, 200, 0.5);
    expect(Array.from(nodeRows(nodeBase + i))).not.toEqual(mid);
    expect(movingMeshes[0].userData.casterVersion).not.toBe(version);
    // The slot equals the node's pose relative to the vessel frame (what the individual mesh would draw).
    const inner = view.root.children[0];
    inner.updateMatrixWorld(true);
    const local = new THREE.Matrix4().copy(inner.matrixWorld).invert().multiply(deploy[0].matrixWorld);
    const probe = new THREE.Vector3(0.3, -0.2, 0.7);
    const expected = probe.clone().applyMatrix4(local);
    expect(apply(nodeRows(nodeBase + i), probe).distanceTo(expected)).toBeLessThan(1e-4);
    // Settled: no further slot or shadow changes.
    const settled = movingMeshes[0].userData.casterVersion;
    step(view, 5, 5);
    expect(movingMeshes[0].userData.casterVersion).toBe(settled);
    view.dispose();
  });

  it('splits multi-material leaves by group and keeps their faces', () => {
    const geometry = new THREE.BoxGeometry();
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, [a, b]);
    // Box groups: six faces with material indices 0..5; map faces 0-2 to a, 3-5 to b.
    geometry.groups.forEach((g, i) => { g.materialIndex = i < 3 ? 0 : 1; });
    const heat = new PartHeat(mesh);
    const { group } = buildStaticBatch([mesh]);
    expect(mesh.visible).toBe(false);
    const meshes = group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    const tris = meshes.map(m => m.geometry.index!.count / 3).sort();
    expect(tris).toEqual([6, 6]);
    heat.dispose();
  });

  it('collapses a hidden node and keeps non-thermal leaves under nodes individual', () => {
    const material = new THREE.MeshStandardMaterial();
    const part = new THREE.Group();
    const arm = new THREE.Group(); arm.name = 'gimbal'; arm.position.set(1, 0, 0); part.add(arm);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(), material); arm.add(leaf);
    const basic = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); arm.add(basic);
    const heat = new PartHeat(part);
    expect(countMovingNodes([part], () => false, isMovingNode)).toBe(1);
    const base = allocateNodes(1);
    expect(base % NODES_PER_ROW).toBe(0);
    const batch = buildStaticBatch([part], { node: isMovingNode, slotBase: base });
    expect(batch.nodes).toEqual([arm]);
    expect(leaf.visible).toBe(false);
    expect(basic.visible).toBe(true);
    const merged = batch.group.children[0] as THREE.Mesh;
    expect(merged.geometry.getAttribute('wspNode').getX(0)).toBe(base);
    expect(merged.frustumCulled).toBe(false);
    expect(merged.customDepthMaterial).toBeDefined();
    releaseNodes(base, 1);
    expect(allocateNodes(1)).toBe(base);
    releaseNodes(base, 1);
    heat.dispose();
  });

  it('collapses node slots of hidden deployables and frees slots on dispose', () => {
    const craft = STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build();
    const view = new VesselView(buildVessel(craft, PART_CATALOG));
    step(view, 1);
    const { nodes, nodeBase } = internals(view);
    nodes[0].visible = false;
    step(view, 1, 1);
    expect(Array.from(nodeRows(nodeBase))).toEqual(new Array(12).fill(0));
    nodes[0].visible = true;
    step(view, 1, 2);
    expect(Array.from(nodeRows(nodeBase)).some(v => v !== 0)).toBe(true);
    view.dispose();
    expect(allocateNodes(1)).toBe(nodeBase);
    releaseNodes(nodeBase, 1);
  });

  it('draws moving frames individually when node slots run out', () => {
    const held: number[] = [];
    for (let b = allocateNodes(NODES_PER_ROW); b; b = allocateNodes(NODES_PER_ROW)) held.push(b);
    const craft = STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build();
    const view = new VesselView(buildVessel(craft, PART_CATALOG));
    step(view, 1);
    expect(internals(view).nodes).toHaveLength(0);
    let gimbalMeshes = 0;
    view.root.traverse(o => { if (o.name === 'gimbal') o.traverseVisible(c => { if (c instanceof THREE.Mesh) gimbalMeshes++; }); });
    expect(gimbalMeshes).toBeGreaterThan(0);
    view.dispose();
    for (const b of held) releaseNodes(b, NODES_PER_ROW);
  });
});
