import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { buildOrbiter } from '../../src/editor/stockCrafts';
import { neutralInput } from '../../src/sim/vessel';
import { add, v3 } from '../../src/util/vec3';

export function gravityOffTrace() {
  const u = new Universe('standard'), w = new World(u,PART_CATALOG,0);
  const v = w.launch(buildOrbiter()), b=u.ephem.getBodyState('earth',0), r=u.body('earth').radius+200000;
  v.mode='physics'; v.fixed=undefined; v.state.situation='flying';
  v.state.position=add(b.position,v3(r,0,0));
  v.state.velocity=add(b.velocity,v3(0,Math.sqrt(u.body('earth').gm/r),0));
  const trace: unknown[]=[];
  for (let i=0;i<100;i++) {
    w.warp={mode:'rails',index:i>=50 && i<75 ? 5:0};
    w.tick(.02,neutralInput());
    trace.push([w.ut,v.mode,v.body,v.state.position,v.state.velocity,v.state.orientation,v.state.mass]);
  }
  return trace;
}
