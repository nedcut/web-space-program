import { describe, expect, it } from 'vitest';
import { World, PHYSICS_DT } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { flightPredictions } from '../src/game/flightData';
import { neutralInput } from '../src/sim/vessel';
import { elementsToState, stateToElements } from '../src/sim/orbit';
import { warpTargets } from '../src/flight/controller/warp';
import { distance, length, v3 } from '../src/util/vec3';

describe('near-radial trajectories', () => {
  it('keeps conic elements finite and exact for hyperbolas within rounding of an asymptote', () => {
    const mu = 4.9028e12, R = 66_000_000;
    for (const transverse of [0, 1e-12, 1e-9, 1e-6, 1e-3, 1, 250]) {
      for (const radial of [-1500, 1500]) {
        const r = v3(R, 0, 0), v = v3(radial, transverse, 0);
        const o = stateToElements(mu, 'moon', r, v, 1000);
        expect(Number.isFinite(o.m0), `m0 ${transverse} ${radial}`).toBe(true);
        const s = elementsToState(o, 1000);
        expect(distance(s.position, r) / R).toBeLessThan(1e-9);
        expect(distance(s.velocity, v) / length(v)).toBeLessThan(1e-6);
        // An hour later the conic still evaluates without leaving the asymptotes.
        const later = elementsToState(o, 4600);
        expect(Number.isFinite(later.position.x) && Number.isFinite(later.velocity.x)).toBe(true);
      }
    }
  });

  it('crosses into the Moon SOI on a radial approach with HUD, map and warp predictions running', () => {
    for (const transverse of [0, 1e-6]) {
      const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
      world.launch(buildOrbiter());
      const v = world.active!, u = world.universe;
      const moon = u.body('moon'), m = u.ephem.getBodyState('moon', world.ut), e = u.ephem.getBodyState('earth', world.ut);
      const d = v3(e.position.x - m.position.x, e.position.y - m.position.y, e.position.z - m.position.z);
      const n = length(d), r = moon.soi + 20000, tn = Math.hypot(d.x, d.y);
      v.mode = 'physics'; v.body = 'earth'; v.fixed = undefined; v.orbit = undefined; v.state.situation = 'flying';
      for (const k of ['x', 'y', 'z'] as const) {
        const tangent = k === 'x' ? -d.y : k === 'y' ? d.x : 0;
        v.state.position[k] = m.position[k] + d[k] / n * r;
        v.state.velocity[k] = m.velocity[k] - d[k] / n * 1500 + tangent / tn * transverse;
      }
      world.renderHistory.invalidate();
      for (let step = 0; step < 400; step++) {
        world.tick(PHYSICS_DT * 4, neutralInput());
        if (step % 20 === 0) {
          flightPredictions(world, v);
          world.mapTrajectory();
          warpTargets(world);
        }
      }
      expect(v.body).toBe('moon');
      expect(Number.isFinite(world.orbitSummary(v).orbit.m0)).toBe(true);
    }
  });
});
