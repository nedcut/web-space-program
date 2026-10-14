import '../earth-data/register';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { buildMoonLander } from '../../src/editor/stockCrafts';
import { buildVessel } from '../../src/sim/vessel/assembly';
import { entryCorridor, entryDragPerMass, entryPass } from '../../src/game/planning/entry';
import { sampleAtmosphere } from '../../src/sim/atmosphere';
import { length } from '../../src/util/vec3';
import { DEFAULT_START_UT } from '../../src/game/store';
import type { CraftDef } from '../../src/sim/vessel/types';
function capsule(): CraftDef {
  const craft = buildMoonLander();
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const above = (uid: number): boolean => { const p = byUid.get(uid)!; return !p.partId.startsWith('dec-') && (p.parent === undefined || above(p.parent)); };
  return { ...craft, parts: craft.parts.filter(p => above(p.uid)) };
}
const v = buildVessel(capsule(), PART_CATALOG);
const kd = entryDragPerMass(v) * Number(process.argv[2] ?? 1);
console.log('mass', v.mass.toFixed(0), 'kd', kd.toExponential(3), 'CdA', (kd * v.mass).toFixed(2));
for (const scale of ['standard', 'challenging', 'real'] as const) {
  const u = new Universe(scale), b = u.body('earth');
  const ra = length(u.ephem.getRelativeState('moon', DEFAULT_START_UT).position);
  const t0 = Date.now();
  const energy = (pe: number) => -b.gm / (ra + b.radius + pe);
  const c = entryCorridor(b, energy(30000), kd)!;
  const ms = Date.now() - t0;
  const q = (pe: number) => 0.5 * sampleAtmosphere(b.atmosphere!, pe, b.surfaceGravity).density * 2 * (energy(pe) + b.gm / (b.radius + pe));
  const pass = (pe: number) => entryPass(b, b.radius + pe, energy(pe), kd);
  console.log(scale, `steep ${(c.steep / 1000).toFixed(1)} km (${(q(c.steep)/1000).toFixed(0)} kPa) target ${(c.target / 1000).toFixed(1)} km (${(q(c.target)/1000).toFixed(1)} kPa, ${pass(c.target).peakG.toFixed(1)} g) shallow ${(c.shallow / 1000).toFixed(1)} km (${(q(c.shallow)/1000).toFixed(1)} kPa) ${ms} ms`);
}
