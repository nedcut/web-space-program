import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { transferWindows } from '../src/game/planning/windows';
import { stateToElements } from '../src/sim/orbit';
import { planTransferToBody } from '../src/game/planning/transfers';
import { arrivalTime } from '../src/game/planning/arrival';
import { v3 } from '../src/util/vec3';
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

it('times a verified Moon transfer to periapsis, as the departure estimate does, not to the SOI entry', () => {
  // Moon playtest: the estimate said "1d 0h trip", the verified timeline "in 19h 10m" (SOI entry, hours earlier).
  const universe = new Universe('standard'), ut = DEFAULT_START_UT, earth = universe.body('earth');
  const radius = earth.radius + 82000, speed = Math.sqrt(earth.gm / radius);
  const position = v3(radius, 0, 0), velocity = v3(0, speed * Math.cos(0.5), speed * Math.sin(0.5));
  const orbit = stateToElements(earth.gm, earth.id, position, velocity, ut);
  const world: PlanningWorld = { universe, ut, active: { body: earth.id }, orbitOf: () => orbit,
    relativeState: () => ({ position, velocity }), addNode: time => ({ id: 1, time, prograde: 0, normal: 0, radial: 0 }) };
  const now = transferWindows(world, 'moon', { earliest: ut + 300 }).find(w => w.kind === 'now')!;
  const plan = planTransferToBody(world, 'moon', { departure: now.departure })!;
  expect(plan).not.toBeNull();
  const toPe = arrivalTime(plan, 'moon') - plan.node.time, toSoi = plan.encounterTime - plan.node.time;
  expect(Math.abs(toPe - now.timeOfFlight) / now.timeOfFlight).toBeLessThan(0.05);
  expect(toSoi).toBeLessThan(toPe - 3 * 3600);
}, 60000);

it('estimates a Moon return to Earth periapsis, including the climb out of the Moon SOI', () => {
  // The return estimate used to leave out the hours spent leaving the Moon's sphere of influence.
  const universe = new Universe('standard'), ut = DEFAULT_START_UT + 5 * 86400, moon = universe.body('moon');
  const radius = moon.radius + 25000, speed = Math.sqrt(moon.gm / radius);
  const position = v3(radius, 0, 0), velocity = v3(0, speed * Math.cos(0.3), speed * Math.sin(0.3));
  const orbit = stateToElements(moon.gm, moon.id, position, velocity, ut);
  const world: PlanningWorld = { universe, ut, active: { body: moon.id }, orbitOf: () => orbit,
    relativeState: () => ({ position, velocity }), addNode: time => ({ id: 1, time, prograde: 0, normal: 0, radial: 0 }) };
  const window = transferWindows(world, 'earth', { earliest: ut + 300 }).find(w => w.kind === 'window')!;
  const plan = planTransferToBody(world, 'earth', { departure: window.departure })!;
  expect(plan).not.toBeNull();
  const toPe = arrivalTime(plan, 'earth') - plan.node.time;
  expect(Math.abs(toPe - window.timeOfFlight) / toPe).toBeLessThan(0.1);
}, 60000);
