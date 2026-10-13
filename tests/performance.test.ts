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
    // Pixel-bound: frame time falls with the pixel count but stays over budget down to the minimum.
    for (let t = 0; t < 30000;) { const ms = 30 + 40 * q.scale * q.scale; q.update(ms, true); t += ms; }
    expect(q.scale).toBe(0.5);
    expect(q.update(16, false)).toBe(true);
    expect(q.scale).toBe(1);
  });
  it('restores the resolution when lowering it does not help (not pixel-bound) and pauses reductions', () => {
    const q = new AdaptiveQuality();
    run(q, 33.4, 4.5); // severe every window, but frame time ignores the scale (another tab, main thread)
    expect(q.scale).toBe(1);
    run(q, 33.4, 15);
    expect(q.scale).toBe(1); // reductions paused
    run(q, 33.4, 5);
    expect(q.scale).toBeLessThan(1); // tried again after the 20 s pause
    run(q, 33.4, 3);
    expect(q.scale).toBe(1); // still useless: restored, next pause twice as long
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
  it('uncapped on a 120 Hz display: 8.3/16.7 ms alternation is over budget, down to 0.75 while 60 fps holds', () => {
    // As the owner's Zen ascent: 8.3/16.7 ms intervals, no GPU timer, idle main thread. Pixel-bound: the share of
    // missed frames is 0.5·scale², still over budget at 0.75.
    const q = new AdaptiveQuality();
    for (let t = 0, acc = 0; t < 30000;) {
      acc += 0.5 * q.scale * q.scale;
      const ms = acc >= 1 ? 16.7 : 8.33;
      if (acc >= 1) acc -= 1;
      q.update(ms, true, undefined, 2); t += ms;
    }
    expect(q.targetMs).toBeCloseTo(8.33, 1);
    expect(q.scale).toBe(0.75); // reductions that only chase >60 fps stop at highRateMin
    // Below 60 fps the full range applies again.
    for (let t = 0; t < 20000;) { const ms = 20 + 30 * q.scale * q.scale; q.update(ms, true, undefined, 2); t += ms; }
    expect(q.scale).toBeLessThan(0.75);
    // Once that lower scale makes 60 fps again it stays: no full-resolution trial below the >60 fps floor.
    let changes = 0;
    for (let t = 0; t < 120000;) { const ms = 10 + 30 * q.scale * q.scale; if (q.update(ms, true, undefined, 2)) changes++; t += ms; }
    expect(q.scale).toBe(0.5);
    expect(changes).toBe(0);
    // Not pixel-bound (frame times ignore the scale): the resolution is restored, as at 60 Hz.
    const r = new AdaptiveQuality();
    for (let t = 0, i = 0; t < 12000; i++) { const ms = i % 6 === 5 ? 16.7 : 8.33; r.update(ms, true, undefined, 2); t += ms; }
    expect(r.scale).toBe(1);
    // A loading transient during the reduction makes it look useful; the full-resolution trial at the floor
    // finds that frame times do not depend on the scale and restores it.
    const l = new AdaptiveQuality();
    for (let t = 0, i = 0; t < 4000; i++) { const ms = i % 2 ? 24 : 8.33; l.update(ms, true, undefined, 2); t += ms; }
    for (let t = 0, i = 0; t < 8000; i++) { const ms = i % 6 === 5 ? 16.7 : 8.33; l.update(ms, true, undefined, 2); t += ms; }
    expect(l.scale).toBe(0.75);
    for (let t = 0, i = 0; t < 20000; i++) { const ms = i % 6 === 5 ? 16.7 : 8.33; l.update(ms, true, undefined, 2); t += ms; }
    expect(l.scale).toBe(1);
    // Holding 120 fps while the timer query reads more than the interval (pipelined frames): no reduction.
    const m = new AdaptiveQuality();
    for (let t = 0; t < 10000; t += 8.33) m.update(8.33, true, 10.2, 2);
    expect(m.scale).toBe(1);
  });
  it('settles at 120 Hz on a pixel-bound GPU without oscillating, and ignores lone short intervals', () => {
    const q = new AdaptiveQuality();
    // GPU cost 9.5·scale² ms: fits 8.33 ms below scale ~0.93; above it one frame in four misses.
    const trace: number[] = [];
    for (let t = 0, i = 0; t < 180000; i++) {
      const fits = 9.5 * q.scale * q.scale <= 8.33;
      const ms = fits ? 8.33 : i % 4 === 3 ? 16.7 : 8.33;
      if (q.update(ms, true, undefined, 2)) trace.push(q.scale);
      t += ms;
    }
    expect(q.scale).toBeGreaterThanOrEqual(0.8);
    expect(q.scale).toBeLessThan(1);
    expect(trace.length).toBeLessThan(12); // failed increases back off (cooldown doubles)
    // 60 Hz display with 3% catch-up intervals (a late frame followed by a 4 ms one): budget stays 16.7 ms.
    const r = new AdaptiveQuality();
    for (let t = 0, i = 0; t < 20000; i++) { const ms = i % 33 === 0 ? 4 : 16.7; r.update(ms, true, undefined, 2); t += ms; }
    expect(r.targetMs).toBeGreaterThan(16);
    expect(r.scale).toBe(1);
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
  it('ignores the recompile stall after a context restore (hold), then judges frames again', () => {
    const q = new AdaptiveQuality();
    run(q, 16.7, 3);
    q.hold(5000);
    run(q, 120, 4.9); // every program recompiling: slow, but each frame under the 250 ms cutoff
    expect(q.scale).toBe(1);
    run(q, 16.7, 2);
    expect(q.scale).toBe(1);
    run(q, 120, 1.1);
    expect(q.scale).toBeLessThan(1); // sustained slowness after the hold still counts
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
  expect(glass.visible).toBe(true);expect(batch.children).toHaveLength(1);expect((batch.children[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(4*geometry.getAttribute('position').count);
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
