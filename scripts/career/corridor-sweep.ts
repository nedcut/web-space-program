import '../earth-data/register';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { buildMoonLander } from '../../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../../src/game/store';
import { spawnRelative } from '../../src/scenarios/catalog';
import { neutralInput } from '../../src/sim/vessel';
import { sampleAtmosphere } from '../../src/sim/atmosphere';
import type { CraftDef } from '../../src/sim/vessel/types';
import { length, sub, v3 } from '../../src/util/vec3';
function capsule(): CraftDef {
  const craft = buildMoonLander();
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const above = (uid: number): boolean => { const p = byUid.get(uid)!; return !p.partId.startsWith('dec-') && (p.parent === undefined || above(p.parent)); };
  return { ...craft, parts: craft.parts.filter(p => above(p.uid)) };
}
function entryPass(scale: 'standard' | 'challenging' | 'real', pe: number) {
  const w = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT);
  const u = w.universe, b = u.body('earth'), atmo = b.atmosphere!.height;
  const ra = length(u.ephem.getRelativeState('moon', w.ut).position), rp = b.radius + pe, a = (ra + rp) / 2;
  const r0 = b.radius + atmo + 10000, v0 = Math.sqrt(b.gm * (2 / r0 - 1 / a)), vt = Math.sqrt(b.gm * a * (1 - ((ra - rp) / (ra + rp)) ** 2)) / r0;
  const wv = spawnRelative(w, capsule(), 'earth', v3(r0, 0, 0), v3(-Math.sqrt(v0 * v0 - vt * vt), vt, 0));
  let minAlt = Infinity, maxG = 0, maxT = 0;
  for (let i = 0; i < 20 * 1500; i++) {
    w.tick(1 / 20, neutralInput());
    if (wv.state.destroyed) return { minAlt, maxG, maxT, q: 0, dead: true };
    const alt = length(sub(wv.state.position, u.ephem.getBodyState('earth', w.ut).position)) - b.radius;
    minAlt = Math.min(minAlt, alt);
    maxG = Math.max(maxG, wv.state.telemetry.gForce ?? 0);
    for (const p of wv.state.parts) maxT = Math.max(maxT, p.temperature ?? 0);
    if (alt < 10000 || (i > 200 && alt > atmo + 15000)) break;
  }
  const vp2 = b.gm * (2 / rp - 1 / a);
  return { minAlt, maxG, maxT, q: 0.5 * sampleAtmosphere(b.atmosphere!, pe).density * vp2, dead: false };
}
const scale = process.argv[2] as 'standard';
const atmo = new Universe(scale).body('earth').atmosphere!.height;
for (const f of (process.argv[3] ?? '0.1,0.2,0.3,0.4').split(',').map(Number)) {
  const r = entryPass(scale, atmo * f);
  console.log(scale, 'pe', (atmo * f / 1000).toFixed(1), 'km q', (r.q / 1000).toFixed(1), 'kPa minAlt', (r.minAlt / 1000).toFixed(1), 'maxG', r.maxG.toFixed(1), 'maxT', r.maxT.toFixed(0), r.dead ? 'DEAD' : '');
}
