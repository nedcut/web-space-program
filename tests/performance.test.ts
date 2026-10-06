import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AdaptiveQuality } from '../src/render/core/adaptiveQuality';
import { cachedStageDeltaV } from '../src/game/stageDeltaVCache';
import { buildVessel, computeStageDeltaV, activateNextStage, recomputeMassProperties } from '../src/sim/vessel';
import { rebuildTopology } from '../src/sim/vessel/assembly';
import { buildMoonLander } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { VesselView } from '../src/render/vessel/VesselView';
import { batchStaticParts, disposeStaticBatch } from '../src/render/vessel/staticBatch';
import { snapshotEqual } from '../src/util/snapshotEqual';

it('stage cache matches uncached calculations exactly through drain, pressure, crew and topology changes', () => {
  const v = buildVessel(buildMoonLander(), PART_CATALOG);
  const check = (pressure = 0) => { const a=cachedStageDeltaV(v, pressure,9.81); expect(a).toEqual(computeStageDeltaV(v,pressure,9.81)); expect(cachedStageDeltaV(v,pressure,9.81)).toBe(a); };
  check(); check(55000);
  const tank = v.parts.find(p=>p.resources.liquidFuel)!;
  tank.resources.liquidFuel! -= 10; recomputeMassProperties(v); check();
  activateNextStage(v); check();
  const pod=v.parts.find(p=>p.def.modules.some(m=>m.type==='command'))!;
  pod.crew=[]; recomputeMassProperties(v);check();
  rebuildTopology(v);check();
});

describe('adaptive scale', () => {
  const run = (q: AdaptiveQuality, ms: number, seconds: number, gpu?: number) => { for (let t = 0; t < seconds * 1000; t += ms) q.update(ms, true, gpu); };
  // A quarter of the frames miss vsync: over budget, but not severely.
  const marginal = (q: AdaptiveQuality, seconds: number) => { for (let t = 0, i = 0; t < seconds * 1000; i++) { const ms = i % 4 === 3 ? 40 : 16.7; q.update(ms, true); t += ms; } };
  it('drops after two marginal windows or one severe window, never below 0.5, and resets when disabled', () => {
    const q = new AdaptiveQuality();
    run(q, 16.7, 3);
    expect(q.scale).toBe(1);
    marginal(q, 1.05);
    expect(q.scale).toBe(1); // one marginal window is not enough
    marginal(q, 1.05);
    expect(q.scale).toBe(0.9);
    run(q, 33.4, 1.05);
    expect(q.scale).toBe(0.75); // every frame missed: immediate, larger step
    run(q, 33.4, 30);
    expect(q.scale).toBe(0.5);
    expect(q.update(16, false)).toBe(true);
    expect(q.scale).toBe(1);
  });
  it('treats slow frames with an idle main thread as GPU-bound even when timer queries read low', () => {
    const q = new AdaptiveQuality();
    for (let t = 0; t < 1100; t += 33.4) q.update(33.4, true, 6, 8); // compositing etc. not in the timer
    expect(q.scale).toBeLessThan(1);
  });
  it('jumps to the resolution predicted by GPU time', () => {
    const q = new AdaptiveQuality();
    run(q, 33.4, 1.05, 33); // GPU needs ~2x the budget: pixels ∝ scale², capped step
    expect(q.scale).toBe(0.65);
  });
  it('ignores isolated hitches, suspended frames and CPU-bound slowness', () => {
    const q = new AdaptiveQuality();
    for (let i = 0; i < 600; i++) q.update(i % 60 === 0 ? 40 : 16.7, true); // ~2% hitches
    q.update(10000, true);
    expect(q.scale).toBe(1);
    for (let t = 0; t < 5000; t += 33.4) q.update(33.4, true, 4, 25); // GPU 4 ms, main thread 25 ms: CPU-bound
    expect(q.scale).toBe(1);
    run(q, 16.7, 3, 16); // GPU saturated even though frames hit vsync
    expect(q.scale).toBeLessThan(1);
  });
  it('drops on a steady sub-target rate even when few frames exceed 1.5x the interval (120 Hz display)', () => {
    const q = new AdaptiveQuality();
    // ~48 fps on a ProMotion display: intervals alternate 16.7 / 25 ms (24.9 so none counts as a missed frame).
    for (let t = 0, i = 0; t < 2100; i++) { const ms = i % 2 ? 24.9 : 16.7; q.update(ms, true); t += ms; }
    expect(q.scale).toBe(0.9);
  });
  it('recovers with headroom after a cooldown and backs off after oscillation', () => {
    const q = new AdaptiveQuality();
    run(q, 33.4, 1.05);
    expect(q.scale).toBe(0.85);
    run(q, 16.7, 3);
    expect(q.scale).toBe(0.85); // 4 s cooldown
    run(q, 16.7, 2.5);
    expect(q.scale).toBe(0.95);
    for (let i = 0; i < 90 && q.scale === 0.95; i++) q.update(33.4, true); // the increase failed immediately
    expect(q.scale).toBe(0.8);
    run(q, 16.7, 6);
    expect(q.scale).toBe(0.8); // cooldown doubled to 8 s
    run(q, 16.7, 4);
    expect(q.scale).toBe(0.9);
  });
});
it('batching preserves world bounds, transparent leaves and shared geometry', () => {
  const group=new THREE.Group(), geometry=new THREE.BoxGeometry(), mat=new THREE.MeshBasicMaterial();
  for(let i=0;i<4;i++){const mesh=new THREE.Mesh(geometry,mat);mesh.position.x=i*3;group.add(mesh);}
  const glass=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({transparent:true}));glass.position.y=2;group.add(glass);
  group.updateMatrixWorld(true);const before=new THREE.Box3().setFromObject(group);
  const batch=batchStaticParts([group]);const result=new THREE.Group();result.add(group,batch);result.updateMatrixWorld(true);
  const bounds=new THREE.Box3();result.traverseVisible(o=>{if(o instanceof THREE.Mesh)bounds.expandByObject(o)});
  expect(bounds.min.toArray()).toEqual(before.min.toArray());expect(bounds.max.toArray()).toEqual(before.max.toArray());
  expect(glass.visible).toBe(true);expect(batch.children.some(o=>o instanceof THREE.InstancedMesh && o.count===4)).toBe(true);
  let disposed=false;geometry.addEventListener('dispose',()=>{disposed=true});disposeStaticBatch(batch);expect(disposed).toBe(false);
});
it('vessel batches survive staging and distant LOD returns to full detail', () => {
  const v=buildVessel(buildMoonLander(),PART_CATALOG), view=new VesselView(v);
  view.update({x:0,y:0,z:0},0,0,.02,true);
  let meshes=0,points=0;view.root.traverseVisible(o=>{if(o instanceof THREE.Mesh)meshes++;if(o instanceof THREE.Points)points++;});
  expect(meshes).toBe(0);expect(points).toBe(1);
  activateNextStage(v); activateNextStage(v);
  view.update({x:0,y:0,z:0},0,0,.02);
  view.root.traverseVisible(o=>{if(o instanceof THREE.Mesh)meshes++;});expect(meshes).toBeGreaterThan(0);
  view.dispose();
});
it('snapshot equality detects changes while treating NaN readouts as stable', () => {
  expect(snapshotEqual({v:NaN,r:[{fuel:2}]},{v:NaN,r:[{fuel:2}]})).toBe(true);
  expect(snapshotEqual({v:NaN,r:[{fuel:2}]},{v:NaN,r:[{fuel:1}]})).toBe(false);
});
