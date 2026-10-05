/** Isolated kernels; BENCH_BASELINE=1 is for temporary *.baseline.ts copies of the parent revision. */
import { performance } from 'node:perf_hooks';
import { buildVessel } from '../../src/sim/vessel';
import { buildMoonLander } from '../../src/editor/stockCrafts';
import { PART_CATALOG } from '../../src/data/parts';
import { World } from '../../src/game/world';
const {hullPoints}=await import(process.env.BENCH_BASELINE?'../../src/sim/vessel/shapes.baseline.ts':'../../src/sim/vessel/shapes.ts');
const {recomputeMassProperties}=await import(process.env.BENCH_BASELINE?'../../src/sim/vessel/assembly.baseline.ts':'../../src/sim/vessel/assembly.ts');
const {Universe}=await import(process.env.BENCH_BASELINE?'../../src/game/universe.baseline.ts':'../../src/game/universe.ts');
const v=buildVessel(buildMoonLander(),PART_CATALOG),u=new Universe('standard'),w=new World(u,PART_CATALOG,1e8);w.launch(buildMoonLander());
const env=u.createEnvironment(()=> 'earth');
let sink:unknown;
for(const [name,run,n] of [
 ['hullPoints/28parts',()=>{for(const p of v.parts)sink=hullPoints(p.def)},10000],
 ['massProperties/28parts',()=>recomputeMassProperties(v,false),1000],
 ['ground/earth/pad',()=>env.ground(w.active!.state.position,w.ut),1000],
] as const){
 const times=[];
 for(let r=-5;r<9;r++){const start=performance.now();for(let i=0;i<n;i++)sink=run();if(r>=0)times.push((performance.now()-start)*1000/n);}
 times.sort((a,b)=>a-b);console.log(JSON.stringify({name,medianUs:times[4],p95Us:times[8]}));
}
void sink;
