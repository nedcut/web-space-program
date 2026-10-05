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
  it('requires sustained thresholds, honors hysteresis, bounds and manual reset', () => {
    const q = new AdaptiveQuality();
    for(let i=0;i<99;i++) q.update(30,true);
    expect(q.scale).toBe(1); q.update(30,true); expect(q.scale).toBe(.9);
    for(let i=0;i<299;i++) q.update(10,true);
    expect(q.scale).toBe(.9); q.update(10,true); expect(q.scale).toBe(1);
    for(let i=0;i<10000;i++) q.update(30,true);
    expect(q.scale).toBe(.5); expect(q.update(16,false)).toBe(true); expect(q.scale).toBe(1);
    for(let i=0;i<99;i++) q.update(30,true);
    q.update(16,true);q.update(30,true);expect(q.scale).toBe(1);
    q.update(10000,true); expect(q.scale).toBe(1);
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
