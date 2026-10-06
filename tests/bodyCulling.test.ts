import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { findDominantBody } from '../src/sim/orbit/soi';
import { radiationRate, sunExposure } from '../src/sim/hazards/environment';
import { SCALE_PRESETS } from '../src/sim/bodies/scale';
import { add, distance, length, normalize, scale, sub, v3, type Vec3 } from '../src/util/vec3';
import { DEFAULT_START_UT } from '../src/game/store';

// Reference (pre-culling) implementations: every body's ephemeris is evaluated.
function dominantRef(u: Universe, pos: Vec3, t: number): string {
  let best: string | undefined, depth = -1, bestSoi = Infinity;
  for (const b of u.bodies.values()) {
    if (distance(pos, u.ephem.getBodyState(b.id, t).position) > b.soi) continue;
    let d = 0; for (let p = b.parent; p; p = u.bodies.get(p)?.parent) d++;
    if (d > depth || (d === depth && b.soi < bestSoi)) { best = b.id; depth = d; bestSoi = b.soi; }
  }
  return best!;
}
function exposureRef(u: Universe, pos: Vec3, t: number): number {
  const sp = u.ephem.getBodyState(u.sunId, t).position;
  return sunExposure(pos, sp, [...u.bodies.values()].filter(b => b.id !== u.sunId).map(b => ({ radius: b.radius, position: u.ephem.getBodyState(b.id, t).position })));
}
function radiationRef(u: Universe, pos: Vec3, t: number): number {
  let dose = 0;
  for (const id of ['earth', 'jupiter', 'saturn']) {
    const b = u.body(id);
    const rel = sub(pos, u.ephem.getBodyState(id, t).position);
    if (length(rel) > b.radius * 30) continue;
    dose += radiationRate(id, u.ephem.toBodyFixed(id, rel, t), b.radius);
  }
  return dose / Math.sqrt(SCALE_PRESETS[u.preset].s);
}

describe('ephemeris culling by heliocentric distance bounds', () => {
  for (const preset of ['standard', 'real'] as const) {
    it(`matches brute force for SOI, Sun exposure and radiation (${preset})`, () => {
      const u = new Universe(preset);
      let seed = 12345;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      let shadowed = 0, n = 0;
      for (const t of [DEFAULT_START_UT, DEFAULT_START_UT + 3.7e7, DEFAULT_START_UT + 9.1e8]) {
        const sp = u.ephem.getBodyState(u.sunId, t).position;
        for (const b of u.bodies.values()) {
          const c = u.ephem.getBodyState(b.id, t).position;
          const antiSun = normalize(sub(c, sp));
          for (const k of [1.0005, 1.3, 3, 12, 40, 200]) {
            const dirs = [antiSun, normalize(v3(rand() - 0.5, rand() - 0.5, rand() - 0.5))];
            for (const dir of dirs) {
              const pos = add(c, scale(dir, b.radius * k));
              const env = u.createEnvironment(() => b.id);
              expect(u.dominantBody(pos, t)).toBe(dominantRef(u, pos, t));
              expect(findDominantBody(u.ephem, u.bodies, pos, t)).toBe(dominantRef(u, pos, t));
              const e = env.sun(pos, t).exposure;
              expect(e).toBe(exposureRef(u, pos, t));
              expect(env.radiation!(pos, t)).toBe(radiationRef(u, pos, t));
              if (e === 0) shadowed++;
              n++;
            }
          }
        }
      }
      expect(n).toBeGreaterThan(1000);
      expect(shadowed).toBeGreaterThan(50); // the anti-Sun samples exercise occlusion, not just sunlight
    });
  }
});
