import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG, getPart } from '../src/data/parts';
import { buildVessel, cloneVessel } from '../src/sim/vessel/assembly';
import { stepVessel, neutralInput } from '../src/sim/vessel';
import { vacuumEnv } from '../src/sim/vessel/testing';
import { radiationRate, hazardAtmosphere, sunExposure } from '../src/sim/hazards/environment';
import { pressureLimit, stepHazards } from '../src/sim/hazards/vessel';
import { stepThermal } from '../src/sim/vessel/heating';
import { hasControl } from '../src/sim/crew/crew';
import { qIdentity } from '../src/util/quat';
import { add, normalize, scale, sub, v3 } from '../src/util/vec3';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { vesselDeltas, applyDeltas } from '../src/net/snapshots';
import { advanceCrewDose } from '../src/game/world/hazards';
import { instruments } from '../src/game/science';
import type { CraftDef } from '../src/sim/vessel/types';

const craft = (id: string): CraftDef => ({ name: id, type: 'VAB', version: 1,
  parts: [{ uid: 1, partId: id, position: v3(), rotation: qIdentity() }] });
const vessel = (id: string) => buildVessel(craft(id), PART_CATALOG);
const vacuum = { pressure: 0, temperature: 0, density: 0, speedOfSound: 0 };
const u = new Universe('standard');
const venus = hazardAtmosphere(u.body('venus'), 0);

describe('environmental hazards', () => {
  it('assigns category pressure ratings and continues giant pressure below datum', () => {
    expect(venus.temperature).toBeCloseTo(737, 0);
    expect(venus.pressure).toBeCloseTo(9.2e6, -5);
    expect(pressureLimit(getPart('probe-pebble'))).toBeLessThan(pressureLimit(getPart('pod-lantern-1')));
    const b = u.body('jupiter');
    expect(hazardAtmosphere(b, -200_000).pressure).toBeGreaterThan(15e6);
    expect(hazardAtmosphere(b, -200_000).temperature).toBeGreaterThan(hazardAtmosphere(b, 0).temperature);
  });
  it('crushes a standard Venus probe and separately verifies ambient heat-soak failure', () => {
    const ordinary = vessel('probe-pebble');
    expect(stepHazards(ordinary, { air: venus, radiation: 0, timeScale: Math.sqrt(0.1) }, 10)).toContainEqual([1, 'pressure']);
    const heatOnly = vessel('probe-pebble');
    heatOnly.parts[0].def = { ...heatOnly.parts[0].def, maxPressure: 20e6 };
    expect(stepHazards(heatOnly, { air: venus, radiation: 0, timeScale: 1 }, 60)).toContainEqual([1, 'overheat']);
  });
  it.each(['standard', 'real'] as const)('keeps hardened Venus avionics alive for a finite scaled reserve (%s)', preset => {
    const scaleTime = preset === 'real' ? 1 : Math.sqrt(0.1);
    const v = vessel('probe-kiln');
    const ctx = { air: venus, radiation: 0, timeScale: scaleTime };
    expect(stepHazards(v, ctx, 3600 * scaleTime)).toEqual([]);
    expect(stepHazards(v, ctx, 1800 * scaleTime)).toEqual([]);
    expect(stepHazards(v, ctx, 1800 * scaleTime)).toContainEqual([1, 'overheat']);
    expect(v.parts[0].pressureExposure).toBe(0);
  });
  it('hardened hardware survives real thermal exchange until its equipment reserve expires', () => {
    const v = vessel('probe-kiln');
    const thermal = { air: venus, airVelocityBody: v3(), sunDirBody: v3(1, 0, 0), sunDistance: 1.08e10 };
    const ctx = { air: venus, radiation: 0, timeScale: Math.sqrt(0.1) };
    for (let t = 0; t < 1800; t += 0.2) {
      if (stepThermal(v, thermal, 0.2).length || stepHazards(v, ctx, 0.2).length) throw new Error(`Premature failure at ${t}s`);
    }
    expect(v.parts[0].temperature).toBeGreaterThan(700);
    expect(v.parts[0].ambientTemperature).toBeLessThan(400);
    expect(stepHazards(v, ctx, 600)).toContainEqual([1, 'overheat']);
  });
  it('integrates orbital radiation on rails, including the parent belt inside a moon SOI', () => {
    const world = new World(u, PART_CATALOG, 0), wv = world.launch(craft('probe-cairn'));
    const b = u.body('jupiter'), bs = u.ephem.getBodyState(b.id, 0), r = b.radius * 2.5;
    wv.body = b.id; wv.mode = 'physics'; wv.fixed = undefined; wv.state.situation = 'flying';
    wv.state.position = add(bs.position, u.ephem.fromBodyFixed(b.id, v3(r, 0, 0), 0));
    wv.state.velocity = add(bs.velocity, u.ephem.fromBodyFixed(b.id, v3(0, Math.sqrt(b.gm / r), 0), 0));
    world.advanceRailsTo(900);
    expect(wv.state.parts[0].electronicsFailed).toBe(true);
    const io = u.ephem.getBodyState('io', 0).position;
    expect(u.createEnvironment(() => 'io').radiation!(io, 0)).toBeGreaterThan(0.001);
  });
  it('physics destruction uses pressure events instead of a world depth cutoff', () => {
    const v = vessel('probe-pebble');
    const env = { ...vacuumEnv(), air: () => ({ sample: venus, windVelocity: v3() }) };
    const events = [];
    for (let t = 0; t < 10 && !v.destroyed; t += 0.02) events.push(...stepVessel(v, neutralInput(), env, t).events);
    expect(v.destroyed).toBe(true);
    expect(events.some(e => e.type === 'partDestroyed' && e.reason === 'pressure')).toBe(true);
  });
  it('Jupiter fails ordinary electronics in tens of minutes; shielding extends dose lifetime tenfold', () => {
    const rate = radiationRate('jupiter', v3(2.5, 0, 0), 1);
    const ctx = { air: vacuum, radiation: rate, timeScale: 1 };
    const v = vessel('probe-cairn'), vault = vessel('probe-vault');
    stepHazards(v, ctx, 1100);
    expect(v.parts[0].electronicsDegraded).toBe(true);
    expect(hasControl(v)).toBe(true);
    stepHazards(v, ctx, 1000); stepHazards(vault, ctx, 2100);
    expect(hasControl(v)).toBe(false);
    expect(hasControl(vault)).toBe(true);
    expect(vault.parts[0].radiationDose).toBeCloseTo(v.parts[0].radiationDose! / 10);
    stepHazards(vault, ctx, 19000);
    expect(hasControl(vault)).toBe(false);
  });
  it('keeps LEO and short Saturn expeditions mild, and polar paths safer', () => {
    expect(radiationRate('earth', v3(1 + 400 / 6371, 0, 0), 1) * 86400).toBeLessThan(1e-5);
    expect(radiationRate('saturn', v3(3, 0, 0), 1) * 86400).toBeLessThan(0.2);
    expect(radiationRate('jupiter', v3(0, 0, 2.5), 1)).toBeLessThan(1e-6);
  });
  it('uses finite segments for eclipses and blocks actual panel charging in Earth shadow', () => {
    expect(sunExposure(v3(-2, 0, 0), v3(10, 0, 0), [{ position: v3(), radius: 1 }])).toBe(0);
    expect(sunExposure(v3(2, 0, 0), v3(10, 0, 0), [{ position: v3(), radius: 1 }])).toBe(1);
    const t = 0, bs = u.ephem.getBodyState('earth', t), sun = u.ephem.getBodyState('sun', t).position;
    const direction = normalize(sub(sun, bs.position));
    const env = u.createEnvironment(() => 'earth');
    const panel = { ...getPart('probe-cairn'), id: 'solar-test', modules: [{ type: 'solarPanel' as const, tracking: true, chargeRate: 1 }] };
    const v = buildVessel(craft(panel.id), new Map([[panel.id, panel]]));
    v.parts[0].resources.electricCharge = 0;
    v.position = add(bs.position, scale(direction, -(u.body('earth').radius + 100_000)));
    v.velocity = bs.velocity;
    expect(env.sun(v.position, t).exposure).toBe(0);
    stepVessel(v, neutralInput(), env, t);
    expect(v.parts[0].resources.electricCharge).toBe(0);
    v.position = add(bs.position, scale(direction, u.body('earth').radius + 100_000));
    stepVessel(v, neutralInput(), env, t);
    expect(v.parts[0].resources.electricCharge).toBeGreaterThan(0);
  });
  it('preserves hazard fields in clones, saves and rails deltas and disables failed instruments', () => {
    const world = new World(u, PART_CATALOG, 0);
    const wv = world.launch(craft('shell-kiln'));
    stepHazards(wv.state, { air: vacuum, radiation: 1, timeScale: 1 }, 101);
    const copy = cloneVessel(wv.state);
    copy.parts[0].radiationDose = 0;
    expect(wv.state.parts[0].radiationDose).toBe(101);
    expect(instruments(world, wv)).toEqual([]);
    const restored = deserializeWorld(serializeWorld(world), PART_CATALOG);
    expect(restored.active!.state.parts[0].electronicsFailed).toBe(true);
    wv.mode = 'landedRails';
    wv.state.parts[0].radiationDose = 120;
    applyDeltas(restored, 1, vesselDeltas(world));
    expect(restored.active!.state.parts[0].radiationDose).toBe(120);
  });
  it('tracks crew dose across saves and deltas without changing rails hibernation', () => {
    const world = new World(u, PART_CATALOG, 0), wv = world.launch(craft('pod-lantern-1'));
    const ec = wv.state.parts[0].resources.electricCharge;
    world.advanceRailsTo(86400);
    expect(wv.state.parts[0].resources.electricCharge).toBe(ec);
    advanceCrewDose(world, wv, 1, 0.2);
    expect(world.crew[0].radiationDose).toBeGreaterThanOrEqual(0.2);
    const restored = deserializeWorld(serializeWorld(world), PART_CATALOG);
    advanceCrewDose(world, wv, 1, 0.3);
    wv.state.parts[0].resources.electricCharge = 17;
    applyDeltas(restored, world.ut, vesselDeltas(world));
    expect(restored.crew[0].radiationDose).toBe(world.crew[0].radiationDose);
    expect(restored.active!.state.parts[0].resources.electricCharge).toBe(17);
  });
  it('also removes thermal sunlight when the environment reports eclipse', () => {
    const light = vessel('probe-cairn'), dark = cloneVessel(light);
    const env = vacuumEnv();
    stepVessel(light, neutralInput(), env, 0);
    stepVessel(dark, neutralInput(), { ...env, sun: () => ({ ...env.sun(v3(), 0), exposure: 0 }) }, 0);
    expect(Math.max(...light.parts[0].skinTemperature)).toBeGreaterThan(Math.max(...dark.parts[0].skinTemperature));
  });
  it('cannot freeze a Venus thermal reserve using landed time warp', () => {
    const world = new World(u, PART_CATALOG, 0), wv = world.launch(craft('probe-kiln'));
    wv.body = 'venus'; wv.mode = 'landedRails';
    wv.fixed = { pos: v3(u.body('venus').radius, 0, 0), orient: qIdentity() };
    world.advanceRailsTo(1700);
    expect(world.vessels.has(wv.state.id)).toBe(true);
    world.advanceRailsTo(2400);
    expect(world.vessels.has(wv.state.id)).toBe(false);
  });
});
