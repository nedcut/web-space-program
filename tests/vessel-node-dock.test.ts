import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { RESOURCES } from '../src/data/resources';
import { buildTender } from '../src/editor/stockCrafts';
import { buildVessel, freePorts, mergeVessels, undock, dockedPorts } from '../src/sim/vessel';
import type { VesselState } from '../src/sim/vessel';
import { VesselView } from '../src/render/vessel/VesselView';
import { allocateNodes, nodeRows, releaseNodes, NODES_PER_ROW } from '../src/render/core/rigidNodes';
import { add, sub, v3 } from '../src/util/vec3';
import { qFromAxisAngle } from '../src/util/quat';

type Internals = { nodes: THREE.Object3D[]; nodeBase: number; batch?: THREE.Group; inner: THREE.Group };
const internals = (v: VesselView) => v as unknown as Internals;
const origin = { x: 0, y: 0, z: 0 };
// Frames 10 ms apart: deferred batches are spaced in wall time across views.
let clock = 0;
const step = (views: VesselView[], n: number) => { for (let i = 0; i < n; i++) { clock += 10; for (const v of views) v.update(origin, i * 0.02, 0, 0.02); } };

/** Vessel-frame bounds of what is drawn: merged batch vs the individual meshes it replaced. */
function bounds(view: VesselView) {
  const { batch, inner } = internals(view);
  const merged = new THREE.Box3(), individual = new THREE.Box3(), v = new THREE.Vector3();
  for (const mesh of batch!.children as THREE.Mesh[]) {
    const pos = mesh.geometry.getAttribute('position'), slot = mesh.geometry.getAttribute('wspNode');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const r = nodeRows(slot ? slot.getX(i) : 0);
      merged.expandByPoint(new THREE.Vector3(r[0] * v.x + r[1] * v.y + r[2] * v.z + r[3], r[4] * v.x + r[5] * v.y + r[6] * v.z + r[7], r[8] * v.x + r[9] * v.y + r[10] * v.z + r[11]));
    }
  }
  inner.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !o.userData.batchedVisible) return;
    const m = new THREE.Matrix4();
    for (let q: THREE.Object3D | null = o; q && q !== inner; q = q.parent) { if (q.matrixAutoUpdate) q.updateMatrix(); m.premultiply(q.matrix); }
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) individual.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  return { merged, individual };
}
const close = (a: THREE.Box3, b: THREE.Box3) => a.min.distanceTo(b.min) < 1e-3 && a.max.distanceTo(b.max) < 1e-3;

function pair(): [VesselState, VesselState] {
  const craft = buildTender();
  const A = buildVessel(craft, PART_CATALOG, { id: 'A', resourceDefs: RESOURCES });
  const B = buildVessel(craft, PART_CATALOG, { id: 'B', resourceDefs: RESOURCES, orientation: qFromAxisAngle(v3(1, 0, 0), Math.PI) });
  const pa = freePorts(A)[0], pb = freePorts(B)[0];
  B.position = add(B.position, sub(pa.pos, pb.pos));
  return [A, B];
}

it('re-batches docked and undocked vessels with fresh node slots and complete geometry', () => {
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const [A, B] = pair();
  const viewA = new VesselView(A), viewB = new VesselView(B);
  step([viewA, viewB], 2);
  const meshesA = (internals(viewA).batch!.children as THREE.Mesh[]).reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
  const pa = freePorts(A)[0].part.uid, pb = freePorts(B)[0].part.uid;
  // Dock: B's parts join A; the controller disposes B's view and A's view re-batches after its settle frames.
  mergeVessels(A, B, pa, pb);
  viewB.dispose();
  step([viewA], 1);
  expect(internals(viewA).batch).toBeUndefined();
  step([viewA], 20);
  const merged = internals(viewA).batch!;
  const docked = (merged.children as THREE.Mesh[]).reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
  expect(docked).toBeGreaterThan(1.9 * meshesA);
  const b1 = bounds(viewA);
  expect(close(b1.merged, b1.individual)).toBe(true);
  const nodesDocked = internals(viewA).nodes.length;
  // Undock: the split piece adopts A's visuals (donor path) and both re-batch.
  const port = dockedPorts(A)[0].uid;
  const C = undock(A, port)!;
  expect(C).toBeTruthy();
  const viewC = new VesselView(C, [viewA]);
  step([viewA, viewC], 25);
  for (const v of [viewA, viewC]) {
    expect(internals(v).batch).toBeDefined();
    const b = bounds(v);
    expect(close(b.merged, b.individual)).toBe(true);
    expect(internals(v).nodes.length).toBeLessThan(nodesDocked);
    // No part mesh left both hidden by a stale batch and missing from this one.
    internals(v).inner.traverse(o => { if (o.userData.batchedVisible) expect(o.visible).toBe(false); });
  }
  expect(new Set([internals(viewA).nodeBase, internals(viewC).nodeBase]).size).toBe(2);
  viewA.dispose(); viewC.dispose();
  // All rows free again.
  const held: number[] = [];
  for (let b = allocateNodes(NODES_PER_ROW); b; b = allocateNodes(NODES_PER_ROW)) held.push(b);
  expect(held.length).toBe(63);
  for (const b of held) releaseNodes(b, NODES_PER_ROW);
  now.mockRestore();
});
