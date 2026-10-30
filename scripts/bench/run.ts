import '../earth-data/register';
/** Run: npx tsx scripts/bench/run.ts [filter]. Reports median/p95 microseconds per operation. */
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { Universe } from '../../src/game/universe';
import { World } from '../../src/game/world';
import { DEFAULT_START_UT } from '../../src/game/store';
import { PART_CATALOG } from '../../src/data/parts';
import { STOCK_CRAFTS } from '../../src/editor/stockCrafts';
import { placeInCircularOrbit, placeOnSurface } from '../../src/game/scenarios';
import { neutralInput, computeStageDeltaV, buildVessel } from '../../src/sim/vessel';
import { advanceISRU } from '../../src/sim/vessel/isru';
import { scienceContext, evaluateProgression } from '../../src/game/science';
import { worldNetwork } from '../../src/game/comms';
import { buildChunk } from '../../src/render/planet/chunkBuilder';
import { navball } from '../../src/flight/controller/navball';
import * as vectors from '../../src/util/vec3';
import { qIdentity } from '../../src/util/quat';

const filter = process.argv[2] ?? '';
const results: { name: string; medianUs: number; p95Us: number }[] = [];
let sink: unknown;
function bench(name: string, setup: () => () => unknown, n = 100) {
  if (!name.includes(filter)) return;
  const samples: number[] = [];
  for (let round = -5; round < 9; round++) {
    const run = setup();
    const start = performance.now();
    for (let i = 0; i < n; i++) sink = run();
    if (round >= 0) samples.push((performance.now() - start) * 1000 / n);
  }
  samples.sort((a,b) => a-b);
  const row = { name, medianUs: +samples[4].toFixed(3), p95Us: +samples[8].toFixed(3) };
  results.push(row); console.log(JSON.stringify(row));
}
function fixture(id = 'stock-selene', where = 'vacuum') {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  w.launch(STOCK_CRAFTS.find(c => c.id === id)!.build());
  const v = w.active!;
  if (where === 'landed') placeOnSurface(w, v, 'moon');
  else if (where !== 'pad') placeInCircularOrbit(w, v, 'earth', where === 'atmosphere' ? 15000 : 2e6);
  return { w, v };
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, samples: 9, warmups: 5 }));
for (const id of ['stock-kestrel', 'stock-selene']) for (const where of ['pad', 'atmosphere', 'vacuum', 'landed']) {
  const parts = STOCK_CRAFTS.find(c => c.id === id)!.build().parts.length;
  bench(`tick/${id}/${parts}parts/${where}`, () => {
    const {w, v} = fixture(id, where); const input = neutralInput();
    return () => { w.tick(.02, input); if (v.state.destroyed) throw new Error('fixture destroyed'); return w.ut; };
  }, 100);
}
bench('rails/1e6', () => { const {w} = fixture(); w.warp = {mode:'rails', index:8}; const input = neutralInput(); return () => { w.tick(.02,input); if (w.warp.index !== 8) throw new Error('warp clamped'); return w.ut; }; }, 20);
bench('trajectory/map', () => { const {w} = fixture(); return () => { w.ut += 3; return w.trajectory(); }; }, 10);
for (const id of ['stock-kestrel','stock-selene']) bench(`deltaV/${id}`, () => {const {v} = fixture(id); return () => computeStageDeltaV(v.state, 0, 9.81);});
const u = new Universe('standard');
const presets = new Set<string>();
for (const b of u.bodies.values()) {
  const preset = b.surface?.preset ?? 'rocky'; if (presets.has(preset)) continue; presets.add(preset);
  bench(`heightAt/${preset}`, () => { const terrain = u.terrain(b.id); let i = 0; return () => {const z = 1 - 2 * ((i++ % 997) + .5)/997; const r = Math.sqrt(1-z*z), a = i * 2.399963; return terrain.heightAt(r*Math.cos(a), r*Math.sin(a), z);}; }, 1000);
}
for (const id of ['earth','moon']) bench(`chunk/${id}/24`, () => { const terrain=u.terrain(id); return () => buildChunk(terrain,{face:0,level:10,ix:512,iy:512,res:24,radius:u.body(id).radius,ocean:terrain.ocean}); }, 8);
bench('comms/rebuild/20vessels', () => { const {w,v} = fixture(); const craft=STOCK_CRAFTS[0].build(); for(let i=0;i<19;i++) w.spawnVessel(craft,{position:{...v.state.position,x:v.state.position.x+i*1000},velocity:v.state.velocity,orientation:v.state.orientation},`Relay ${i}`); return () => worldNetwork(w); }, 50);
bench('science/context', () => {const {w,v}=fixture(); return () => scienceContext(w,v);});
bench('science/progression', () => {const {w}=fixture(); w.mode='science'; return () => evaluateProgression(w);});
bench('isru/absent', () => {const {v}=fixture(); return () => advanceISRU(v.state,.5,.02);},1000);
bench('isru/active', () => {
 const v=buildVessel({name:'Bench foundry',type:'VAB',version:1,parts:['regolith-silo','drill-burrow','converter-foundry','battery-brick','tank-1-short'].map((partId,i)=>({uid:i+1,partId,parent:i?1:undefined,position:vectors.v3(i*2,0,0),rotation:qIdentity()}))},PART_CATALOG);
 v.situation='landed'; v.parts[1].drillDeployed=true; v.parts[1].drillDeploy=1; v.parts[2].converterRunning=true;
 return () => {v.parts[0].resources.regolith=50; v.parts[3].resources.electricCharge=100; v.parts[4].resources.liquidFuel=0; v.parts[4].resources.oxidizer=0; return advanceISRU(v,.5,.02);};
});
// Exercise the maintained helper directly; DOM-owned telemetry requires a browser fixture.
for (const id of ['stock-kestrel', 'stock-selene']) {
 bench(`navball/${id}`, () => {
  const { w } = fixture(id);
  return () => navball.call({ world: w, network: null, speedMode: 'surface', mapMode: false }, { maneuverDirection: () => null });
 }, 1000);
}
void sink;
