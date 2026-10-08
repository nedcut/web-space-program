import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { transferWindows } from '../src/game/planning/windows';
import { stateToElements } from '../src/sim/orbit';
import { cross, normalize, scale } from '../src/util/vec3';
import type { PlanningWorld } from '../src/game/planning/context';

it('offers a next-orbit Moon departure near the real 200 km LEO Hohmann value (3.13 km/s, ~5 days)', () => {
  const universe = new Universe('real'), ut = DEFAULT_START_UT;
  const earth = universe.body('earth');
  const moon = universe.ephem.getRelativeState('moon', ut);
  const normal = normalize(cross(moon.position, moon.velocity));
  const radius = earth.radius + 200000;
  const position = scale(normalize(moon.position), radius);
  const velocity = scale(normalize(cross(normal, position)), Math.sqrt(earth.gm / radius));
  const orbit = stateToElements(earth.gm, earth.id, position, velocity, ut);
  const world: PlanningWorld = { universe, ut, active: { body: earth.id }, orbitOf: () => orbit,
    relativeState: () => ({ position, velocity }), addNode: () => { throw new Error('Window estimation must not add nodes'); } };
  const windows = transferWindows(world, 'moon', { earliest: ut + 120, span: 86400, max: 4 });
  expect(windows.length).toBeGreaterThan(1);
  const now = windows.find(w => w.kind === 'now')!;
  expect(now).toBeDefined();
  expect(now.wait).toBeGreaterThanOrEqual(120);
  expect(now.wait).toBeLessThan(6000);
  expect(now.dv).toBeGreaterThan(3000);
  expect(now.dv).toBeLessThan(3300);
  expect(now.timeOfFlight / 86400).toBeGreaterThan(3);
  expect(now.timeOfFlight / 86400).toBeLessThan(7);
  expect(windows.every(w => Number.isFinite(w.dv) && w.dv > 0)).toBe(true);
}, 30000);
