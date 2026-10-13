import '../earth-data/register';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { DEFAULT_START_UT } from '../../src/game/store';
import { buildMoonLander, buildOrbiter } from '../../src/editor/stockCrafts';
import { captureMoon, deorbitAndRecover, landMoon, moonAscent, moonHome, sensor, toMoon, toOrbit, buy } from './flights';
const which = process.argv[2] ?? 'selene';
const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'science');
w.progression.unlocked = ['foundation', 'propulsion-0', 'propulsion-1', 'structures-0', 'structures-1', 'guidance-0', 'energy-0'];
w.onEvent = (e: any) => { if (['partDestroyed', 'chute', 'structuralFailure', 'decouple'].includes(e.type)) console.log((w.ut - DEFAULT_START_UT).toFixed(0), JSON.stringify(e).slice(0, 160)); };
const b = new Set<string>();
let err: string | null;
if (which === 'selene') {
  buy(w, sensor(buildMoonLander()));
  err = toOrbit(w, b, 90000, 4) ?? toMoon(w, b, 4) ?? captureMoon(w, b, 2);
  if (!err) { w.stageActive(); w.stageActive(); err = landMoon(w, b, 2) ?? moonAscent(w, b, 2) ?? moonHome(w, b, 0); }
} else {
  buy(w, sensor(buildOrbiter()));
  err = toOrbit(w, b, 90000, 2) ?? toMoon(w, b, 2, which === 'meridian-capture' ? 30000 : 60000) ?? (which === 'meridian-capture' ? captureMoon(w, b, 0) : null) ?? moonHome(w, b, 0);
  console.log('fuel left', w.active?.state.parts.reduce((n, p) => n + (p.resources.liquidFuel ?? 0), 0));
}
console.log('before entry', err, w.active && w.orbitSummary(w.active), w.active?.state.parts.map(p => p.def.id).join(' '));
err = err ?? deorbitAndRecover(w, b);
console.log('result', err, 'science', w.progression.science.toFixed(1), [...b].join(', '));
