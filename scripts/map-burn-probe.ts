/**
 * Headless map-path probe for a scripted burn and cut-off: logs the live current-conic periapsis against the
 * vessel's osculating orbit and the patch sequence each frame.
 *   node --import tsx --import ./scripts/earth-data/register.ts scripts/map-burn-probe.ts
 * Env: FLYBY=ahead_km,speed_ms,side_km (lunar flyby, default 2500,330,600), BURN=seconds (default 10).
 */
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { PHYSICS_DT, World } from '../src/game/world';
import { apoapsisRadius, periapsisRadius } from '../src/sim/orbit/kepler';
import { neutralInput } from '../src/sim/vessel';
import { add, scale } from '../src/util/vec3';

{
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  world.commsSettings.enabled = false;
  const wv = world.launch(STOCK_CRAFTS.find(s => s.id === 'stock-meridian')!.build());
  placeInCircularOrbit(world, wv, 'moon', 30_000);
  {
    const ms = world.universe.ephem.getBodyState('moon', world.ut);
    const [ahead, speed, side] = (process.env.FLYBY ?? '2500,330,600').split(',').map(Number);
    const vhat = scale(ms.velocity, 1 / Math.hypot(ms.velocity.x, ms.velocity.y, ms.velocity.z));
    const rhat = scale(ms.position, 1 / Math.hypot(ms.position.x, ms.position.y, ms.position.z));
    wv.state.position = add(ms.position, add(scale(vhat, ahead * 1000), scale(rhat, side * 1000)));
    wv.state.velocity = add(ms.velocity, scale(vhat, -speed));
  }
  world.tick(PHYSICS_DT, neutralInput({ throttle: 0, stage: true }));
  const R = world.universe.body('moon').radius;
  const rows: string[] = [];
  let maxMs = 0, sumMs = 0, n = 0, changes = 0, lastSig = '';
  const frames = 60 * Number(process.env.BURN ?? 10);
  for (let f = 0; f < frames + 180; f++) {
    const thr = f < frames ? 1 : 0;
    world.tick(1 / 60, neutralInput({ throttle: thr, sas: 'retrograde' }));
    const t0 = performance.now();
    const p = world.mapTrajectory();
    const ms = performance.now() - t0;
    maxMs = Math.max(maxMs, ms); sumMs += ms; n++;
    const o = world.orbitOf(wv);
    const sig = p.map(x => `${x.orbit.body}:${x.endReason}`).join('>');
    if (sig !== lastSig) { changes++; lastSig = sig; }
    const pPe = (periapsisRadius(p[0].orbit) - R) / 1000, oPe = (periapsisRadius(o) - R) / 1000;
    const tail = p.slice(1).map(x => x.orbit.body === 'moon' ? `moonPe=${((periapsisRadius(x.orbit) - R) / 1000).toFixed(0)}@${(x.startTime - world.ut).toFixed(0)}` : '').join(' ');
    if (f % 6 === 0 || f >= frames - 2 && f < frames + 30) rows.push(tail + ' | ' + `${(f / 60).toFixed(2)} thr=${thr} thrust=${(wv.state.telemetry.thrust/1000).toFixed(1)} curPe=${oPe.toFixed(2)} pathPe=${pPe.toFixed(2)} dPe=${(pPe - oPe).toFixed(3)} curAp=${o.e < 1 ? ((apoapsisRadius(o) - R) / 1000).toFixed(0) : 'hyp'} e=${o.e.toFixed(4)} ${ms.toFixed(2)}ms ${sig}`);
  }
  console.log(rows.join('\n'));
  console.log(`trajectory ms: mean ${(sumMs / n).toFixed(3)} max ${maxMs.toFixed(2)}; patch-sequence changes ${changes}`);
}
