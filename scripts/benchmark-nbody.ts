/** Run with npx tsx scripts/benchmark-nbody.ts. Measures this machine, not a hardware FPS guarantee. */
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { add,v3 } from '../src/util/vec3';
for (const [body,radius] of [['earth',4e6],['sun',2e10]] as const) {
  const u=new Universe('standard'),w=new World(u,PART_CATALOG,0),v=w.launch(buildOrbiter()),b=u.ephem.getBodyState(body,0);
  v.body=body;v.mode='physics';v.fixed=undefined;v.state.situation='flying';
  v.state.position=add(b.position,v3(radius,0,0));v.state.velocity=add(b.velocity,v3(0,Math.sqrt(u.body(body).gm/radius),0));
  w.setPreciseGravity(true);
  const times:number[]=[];let reductions=0;
  for(let i=0;i<120;i++) {
    w.warp={mode:'rails',index:8};const before=performance.now();w.tick(1/60,neutralInput());times.push(performance.now()-before);
    if(w.warp.index<8) reductions++;
  }
  times.sort((a,b)=>a-b);
  const start=performance.now();let frames=0;
  do {w.mapTrajectory();frames++;} while(!w.numericalPrediction?.complete && !w.numericalPrediction?.truncated && frames<1000);
  console.log(JSON.stringify({body,catalogBodies:u.bodies.size,requestedWarp:1e6,frames:120,simulatedSeconds:w.ut,
    effectiveWarpAt60FPS:w.ut/2,medianMs:times[60],p95Ms:times[114],maxMs:times[119],reductions,
    predictionMs:performance.now()-start,predictionFrames:frames,predictionAttempts:w.numericalPrediction?.attempts,
    predictionComplete:w.numericalPrediction?.complete,predictionTruncated:w.numericalPrediction?.truncated}));
}
