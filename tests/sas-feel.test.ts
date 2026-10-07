import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildMoonLander, buildOrbiter, buildSoundingRocket, STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { PHYSICS_DT, World } from '../src/game/world';
import { spawnRelative } from '../src/scenarios/catalog';
import { neutralInput } from '../src/sim/vessel';
import { qRotate } from '../src/util/quat';
import { dot, length, normalize, sub, v3 } from '../src/util/vec3';

/**
 * SAS feel on three stock craft of very different size, in a vacuum orbit with engines off (reaction wheels
 * only, the hardest case): a step to prograde must converge without overshoot or oscillation, and stability
 * assist must kill a tumble and then hold.
 */
const CRAFT = [
  { name: 'Sounding rocket', build: buildSoundingRocket, step: 45 },
  { name: 'Orbiter', build: buildOrbiter, step: 30 },
  { name: 'Moon lander', build: buildMoonLander, step: 15 },
];

function inOrbit(build: () => ReturnType<typeof buildOrbiter>, offsetDeg: number) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const b = world.universe.body('earth');
  const r = b.radius + 200000;
  const v = Math.sqrt(b.gm / r);
  const a = (offsetDeg * Math.PI) / 180;
  const wv = spawnRelative(world, build(), 'earth', v3(r, 0, 0), v3(0, v, 0), v3(Math.sin(a), Math.cos(a), 0));
  return { world, wv };
}

describe('SAS response on stock craft', () => {
  for (const c of CRAFT) {
    it(`${c.name}: ${c.step}° step to prograde converges without overshoot`, () => {
      const { world, wv } = inOrbit(c.build, c.step);
      const errs: number[] = [];
      for (let i = 0; i < 50 * 90; i++) {
        world.tick(PHYSICS_DT, neutralInput({ sas: 'prograde' }));
        const bs = world.universe.ephem.getBodyState('earth', world.ut);
        const pro = normalize(sub(wv.state.velocity, bs.velocity));
        errs.push((Math.acos(Math.min(1, dot(qRotate(wv.state.orientation, v3(0, 1, 0)), pro))) * 180) / Math.PI);
      }
      const reach = errs.findIndex((e) => e < 1);
      expect(reach, 'reaches 1°').toBeGreaterThan(0);
      const after = errs.slice(reach);
      const overshoot = Math.max(...after);
      const settle = reach + after.findIndex((_, k) => after.slice(k).every((e) => e < 0.3));
      const finalRate = length(wv.state.angularVelocity);
      console.log(`${c.name} (${(wv.state.mass / 1000).toFixed(1)} t): ${c.step}° → within 1° at ${(reach * PHYSICS_DT).toFixed(1)} s, settled <0.3° at ${(settle * PHYSICS_DT).toFixed(1)} s, max error after reaching ${overshoot.toFixed(2)}°, final rate ${finalRate.toExponential(1)} rad/s`);
      expect(overshoot).toBeLessThan(1.2);
      expect((settle - reach) * PHYSICS_DT).toBeLessThan(4);
      // Holding prograde means turning once per orbit (≈2.6e-3 rad/s here), with no residual wobble on top.
      const orbitRate = length(wv.state.velocity) > 0 ? Math.sqrt(world.universe.body('earth').gm / (world.universe.body('earth').radius + 200000) ** 3) : 0;
      expect(Math.abs(finalRate - orbitRate)).toBeLessThan(3e-4);
    }, 60000);
  }

  it('stability assist kills a tumble and then holds attitude', () => {
    const { world, wv } = inOrbit(buildOrbiter, 0);
    wv.state.angularVelocity = v3(0.15, 0.02, -0.1);
    let stopped = -1;
    for (let i = 0; i < 50 * 60; i++) {
      world.tick(PHYSICS_DT, neutralInput({ sas: 'stabilityAssist' }));
      if (stopped < 0 && length(wv.state.angularVelocity) < 0.005) stopped = i;
    }
    const held = { ...wv.state.orientation };
    for (let i = 0; i < 50 * 20; i++) world.tick(PHYSICS_DT, neutralInput({ sas: 'stabilityAssist' }));
    const d = Math.abs(dot(qRotate(held, v3(0, 1, 0)), qRotate(wv.state.orientation, v3(0, 1, 0))));
    const drift = (Math.acos(Math.min(1, d)) * 180) / Math.PI;
    console.log(`Orbiter tumble 0.18 rad/s stopped in ${(stopped * PHYSICS_DT).toFixed(1)} s; nose drift over 20 s hold ${drift.toFixed(3)}°`);
    expect(stopped).toBeGreaterThan(0);
    expect(drift).toBeLessThan(0.5);
  }, 60000);
});

describe('SAS on every standard stock craft (RCS on, engines off, 30° step to prograde)', () => {
  // Measured 2026-10-06: every craft with useful authority reaches 1° in 1.3–35 s and never overshoots by more
  // than 1°; the fully fuelled 240 t stacks with only a 2 kNm pod wheel turn too slowly to finish in 60 s (physics).
  for (const sc of STOCK_CRAFTS.filter(s => s.scale === 'standard')) {
    it(`${sc.id}: no overshoot, no wobble`, () => {
      const { world, wv } = inOrbit(sc.build, 30);
      const errs: number[] = [];
      for (let i = 0; i < 50 * 60; i++) {
        world.tick(PHYSICS_DT, neutralInput({ sas: 'prograde', rcs: true }));
        const bs = world.universe.ephem.getBodyState('earth', world.ut);
        const pro = normalize(sub(wv.state.velocity, bs.velocity));
        errs.push((Math.acos(Math.min(1, dot(qRotate(wv.state.orientation, v3(0, 1, 0)), pro))) * 180) / Math.PI);
      }
      // Monotone approach until within 1° (no swing back past the target and out again).
      const reach = errs.findIndex(e => e < 1);
      // Too little authority to finish in a minute: it must at least be closing in, not swinging about.
      if (reach < 0) { expect(errs.at(-1)!).toBeLessThan(errs[0] * 0.8); return; }
      expect(Math.max(...errs.slice(reach))).toBeLessThan(1.2);
    }, 60000);
  }
});
