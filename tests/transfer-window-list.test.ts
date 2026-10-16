import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { interplanetaryWindows } from '../src/game/interplanetary';
import { transferWindows } from '../src/game/planning/windows';
import type { PlanningWorld } from '../src/game/planning/context';
import { stateToElements, period } from '../src/sim/orbit';
import { v3 } from '../src/util/vec3';

function parked() {
  const universe = new Universe('real'), ut = DEFAULT_START_UT, earth = universe.body('earth');
  const radius = earth.radius + 200000, speed = Math.sqrt(earth.gm / radius);
  const position = v3(radius, 0, 0), velocity = v3(0, speed * Math.cos(0.5), speed * Math.sin(0.5));
  const orbit = stateToElements(earth.gm, earth.id, position, velocity, ut);
  const world: PlanningWorld = { universe, ut, active: { body: earth.id }, orbitOf: () => orbit,
    relativeState: () => ({ position, velocity }), addNode: () => { throw new Error('Window list must not create nodes'); } };
  return { world, orbit };
}

it('finds successive Earth→Mars launch seasons about 26 months apart, with capture and flight estimates', () => {
  const { world } = parked();
  const windows = interplanetaryWindows(world, 'mars');
  const seasons = windows.filter(w => w.kind === 'window').sort((a, b) => a.departure - b.departure);
  expect(seasons.length).toBeGreaterThanOrEqual(2);
  const gapDays = (seasons[1].departure - seasons[0].departure) / 86400;
  expect(gapDays).toBeGreaterThan(700);
  expect(gapDays).toBeLessThan(850);
  expect(windows.find(w => w.kind === 'now')?.wait).toBe(300);
  expect(windows.every(w => w.dv > 0 && w.captureDv! > 0 && w.timeOfFlight > 0 && Number.isFinite(w.dv + w.captureDv!))).toBe(true);
}, 30000);

it('bounds the Moon go-now option to the next orbit even while polishing, including an inclined plane change', () => {
  const { world, orbit } = parked();
  const windows = transferWindows(world, 'moon', { earliest: world.ut + 300, span: 86400 });
  const now = windows.find(w => w.kind === 'now')!;
  expect(now).toBeDefined();
  expect(now.departure).toBeGreaterThanOrEqual(world.ut + 300);
  expect(now.departure).toBeLessThanOrEqual(world.ut + 300 + period(orbit));
  expect(Math.abs(now.seed[1])).toBeGreaterThan(1);
  expect(now.captureDv).toBeGreaterThan(0);
  expect(windows.every(w => w.departure <= world.ut + 300 + 86400)).toBe(true);
}, 30000);

it.each(['standard', 'challenging', 'real'] as const)('budgets direct Earth entry from lunar orbit without a capture burn (%s)', preset => {
  const universe = new Universe(preset), ut = DEFAULT_START_UT, moon = universe.body('moon');
  const radius = moon.radius + 40000, position = v3(radius, 0, 0), velocity = v3(0, Math.sqrt(moon.gm / radius), 0);
  const orbit = stateToElements(moon.gm, moon.id, position, velocity, ut);
  const world: PlanningWorld = { universe, ut, active: { body: moon.id }, orbitOf: () => orbit,
    relativeState: () => ({ position, velocity }), addNode: () => { throw new Error('Window list must not create nodes'); } };
  const direct = transferWindows(world, 'earth', { earliest: ut + 300, span: period(orbit) });
  expect(direct.length).toBeGreaterThan(0);
  expect(direct.every(w => w.captureDv === 0)).toBe(true);
  // An explicitly requested parking orbit above the air still needs its capture burn.
  const earth = universe.body('earth');
  const capture = transferWindows(world, 'earth', { earliest: ut + 300, span: period(orbit), periapsisRadius: earth.radius + earth.atmosphere!.height + 10000 });
  expect(capture.length).toBeGreaterThan(0);
  expect(capture.every(w => w.captureDv! > 0)).toBe(true);
}, 30000);
