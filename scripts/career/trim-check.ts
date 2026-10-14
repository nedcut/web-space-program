/** Return conic from the Moon's distance with a periapsis off the corridor → Entry trim → fly the pass. */
import '../earth-data/register';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { DEFAULT_START_UT } from '../../src/game/store';
import { buildOrbiter } from '../../src/editor/stockCrafts';
import { spawnRelative } from '../../src/scenarios/catalog';
import { neutralInput } from '../../src/sim/vessel';
import { coastUntil, localFrame } from '../../src/game/autopilot';
import { entryTrim } from './flights';
import { length, normalize, scale, v3 } from '../../src/util/vec3';
import type { CraftDef } from '../../src/sim/vessel/types';
import { propagate } from '../../src/sim/orbit';
function returnStage(): CraftDef {
  const craft = buildOrbiter();
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const sep = craft.parts.filter(p => p.partId === 'dec-1')[1];
  const above = (uid: number): boolean => { const p = byUid.get(uid)!; return p.uid !== sep.uid && (p.parent === undefined || above(p.parent)); };
  return { ...craft, parts: craft.parts.filter(p => above(p.uid)) };
}
export function trimAndEnter(scaleId: 'standard' | 'challenging' | 'real', peOffset: number) {
  const w = new World(new Universe(scaleId), PART_CATALOG, DEFAULT_START_UT, 'sandbox');
  const u = w.universe, b = u.body('earth'), atmo = b.atmosphere!.height;
  const ra = length(u.ephem.getRelativeState('moon', w.ut).position) * 0.9, rp = b.radius + atmo * 0.3 + peOffset, a = (ra + rp) / 2;
  const r0 = ra * 0.6, v0 = Math.sqrt(b.gm * (2 / r0 - 1 / a)), vt = Math.sqrt(b.gm * a * (1 - ((ra - rp) / (ra + rp)) ** 2)) / r0;
  const wv = spawnRelative(w, returnStage(), 'earth', v3(r0, 0, 0), v3(-Math.sqrt(v0 * v0 - vt * vt), vt, 0));
  const t = Date.now();
  const { err, plan } = entryTrim(w, 0);
  const ms = Date.now() - t;
  if (err || !plan) return { err, ms };
  const pe = w.orbitSummary(wv).pe;
  // Coast to the interface, drop the service stage, hold retrograde through the pass.
  const o = w.orbitOf(wv);
  let te = w.ut;
  while (length(propagate(o, te).position) - b.radius > atmo * 1.02) te += 5;
  coastUntil(w, te);
  for (let i = 0; i < 8 && w.active!.state.nextStage >= 0; i++) w.stageActive();
  let lateG = 0, maxG = 0, minAlt = Infinity, exited = false, steps = 0;
  for (; steps < 50 * 3000; steps++) {
    const f = localFrame(w, w.active!);
    w.warp = { mode: 'rails', index: 0 };
    w.tick(0.02, neutralInput({ sas: 'maneuver', maneuverDirection: scale(normalize(f.surfVel), -1), throttle: 0 }));
    if (!w.active || w.active.state.destroyed) return { err: 'destroyed', ms, plan, pe };
    const g = w.active.state.telemetry.gForce ?? 0;
    if (length(localFrame(w, w.active).surfVel) > 1000) maxG = Math.max(maxG, g); else lateG = Math.max(lateG, g);
    const alt = localFrame(w, w.active).altitude;
    minAlt = Math.min(minAlt, alt);
    if (alt > atmo * 1.01 && steps > 500) { exited = true; break; }
    if (alt < atmo * 0.1) break;
  }
  return { err: null, ms, plan, pe, maxG, lateG, minAlt, exited };
}
if (process.argv[1]?.endsWith('trim-check.ts')) {
  const s = process.argv[2] as 'standard' | 'challenging' | 'real';
  for (const off of (process.argv[3] ?? '15000,-8000').split(',').map(Number)) {
    const r = trimAndEnter(s, off * (s === 'real' ? 2 : 1));
    console.log(s, off, r.err, `${r.ms} ms`, r.plan && `dv ${r.plan.dv.toFixed(2)} before ${(r.plan.before/1000).toFixed(1)} after ${(r.plan.after/1000).toFixed(1)} corridor ${(r.plan.corridor.steep/1000).toFixed(1)}–${(r.plan.corridor.shallow/1000).toFixed(1)} target ${(r.plan.corridor.target/1000).toFixed(1)} flown pe ${((r.pe ?? 0)/1000).toFixed(1)}`, 'maxG', r.maxG?.toFixed(1), 'below 1 km/s', r.lateG?.toFixed(1), 'minAlt', ((r.minAlt ?? 0) / 1000).toFixed(1), r.exited ? 'SKIPPED' : 'captured');
  }
}
