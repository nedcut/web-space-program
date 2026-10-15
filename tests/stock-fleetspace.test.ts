import { orbitState, placeOnState } from './helpers/orbits';
import { requireIntactFlight } from './helpers/structural';
import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { removeEmptyStages } from '../src/editor/core';
import {
  buildCinderbloom, buildPipit, buildDuskwing, buildHopscotch, buildKeystone, buildLamplighter, buildLodestar,
} from '../src/editor/stock/space';
import { buildRelayLauncher, buildRingTour, STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import {
  ascentGuidance, coastUntil, executeNode, landingController, localFrame, noseDirection, planCircularization,
  planCourseCorrection, planTransferToBody, propulsion, radarAltitude, runAutopilot, type Autopilot,
} from '../src/game/autopilot';
import type { ScalePresetId } from '../src/sim/bodies/scale';
import { buildVessel, computeStageDeltaV, neutralInput } from '../src/sim/vessel';
import { peakTemperature } from '../src/sim/vessel/heating';
import type { CraftDef } from '../src/sim/vessel/types';
import { qFromTo } from '../src/util/quat';
import { add, cross, dot, length, normalize, scale, v3 } from '../src/util/vec3';

/** Flight checks for the stock fleet wave's launchers and spacecraft (src/editor/stock/space.ts). */

function launch(preset: ScalePresetId, craft: CraftDef) {
  const world = new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const vessel = world.launch(craft);
  return { world, vessel };
}

function fly(world: World, ap: Autopilot, maxTime: number): void {
  const ok = runAutopilot(world, ap, { maxTime });
  expect(ok, `${ap.name}: ${ap.error ?? 'timed out'}`).toBe(true);
}

/** Ascent and circularization; returns the parking orbit. */
function toOrbit(world: World, targetApoapsis: number, minStage = 0, turnExponent?: number) {
  fly(world, ascentGuidance(world, { targetApoapsis, minStage, turnExponent }), 2000);
  fly(world, executeNode(world, planCircularization(world, 'apoapsis'), { minStage }), 10000);
  const orbit = world.orbitSummary(world.active!);
  expect(orbit.pe).toBeGreaterThan(world.universe.body('earth').atmosphere!.height);
  return orbit;
}

const dvLeft = (world: World) => computeStageDeltaV(world.active!.state, 0, 9.81).reduce((a, s) => a + s.dvVac, 0);

/** Interplanetary departure, a few trims and arrival in the target's sphere of influence. */
function cruise(world: World, target: string, periapsisAltitude: number, minStage: number) {
  const plan = planTransferToBody(world, target, { periapsisAltitude });
  expect(plan, `${target} transfer`).not.toBeNull();
  fly(world, executeNode(world, plan!.node, { minStage }), 1e9);
  coastUntil(world, world.ut + 86400 * 60, { stopOnSoi: true });
  let encounter = plan!.encounterTime;
  for (const fraction of [0.05, 0.6, 0.9]) {
    const trim = planCourseCorrection(world, target, periapsisAltitude, world.ut + (encounter - world.ut) * fraction, 300);
    if (!trim) continue;
    fly(world, executeNode(world, trim.node, { minStage }), 1e9);
    encounter = trim.encounterTime;
  }
  coastUntil(world, encounter + 600, { stopOnSoi: true });
  expect(world.active!.body).toBe(target);
  return plan!;
}

describe('stock fleet: launchers and spacecraft', () => {
  it('registers every design once, with original names, on the scales it is built for', () => {
    const ids = ['stock-pipit', 'stock-lodestar', 'stock-cinderbloom', 'stock-lamplighter', 'stock-hopscotch',
      'stock-hopscotch-challenging', 'stock-hopscotch-real', 'stock-duskwing-challenging', 'stock-keystone-real'];
    for (const id of ids) expect(STOCK_CRAFTS.filter(s => s.id === id), id).toHaveLength(1);
    expect(new Set(STOCK_CRAFTS.map(s => s.id)).size).toBe(STOCK_CRAFTS.length);
    expect(STOCK_CRAFTS.find(s => s.id === 'stock-duskwing-challenging')!.scale).toBe('challenging');
    expect(STOCK_CRAFTS.find(s => s.id === 'stock-keystone-real')!.scale).toBe('real');
  });

  it('Pipit reaches orbit with its kick motor and Mistral fuel to spare for the Moon', () => {
    const { world } = launch('standard', buildPipit());
    toOrbit(world, 85000, 0, 0.3);
    const moon = planTransferToBody(world, 'moon', { periapsisAltitude: 30000 });
    expect(moon).not.toBeNull();
    expect(dvLeft(world)).toBeGreaterThan(moon!.dv * 1.5);
    expect(world.active!.state.parts.some(p => p.partId === 'probe-pebble')).toBe(true);
  }, 120000);

  it('Lodestar reaches orbit, then its ion drive runs on solar power with over 10 km/s', () => {
    const { world } = launch('standard', buildLodestar());
    toOrbit(world, 85000);
    const ion = computeStageDeltaV(world.active!.state, 0, 9.81).at(-1)!;
    expect(ion.dvVac).toBeGreaterThan(10000);
    // Drop the spent upper stage and run the drive at full power for most of an orbit.
    while (world.active!.state.nextStage >= 0) world.stageActive();
    const v = world.active!.state;
    const xenon = () => v.parts.reduce((x, p) => x + (p.resources.xenon ?? 0), 0);
    const x0 = xenon();
    // Thrust phases after spool-up: sunlit, Earth's shadow (no power, no thrust, drive stays lit), sunlit again.
    const phases: boolean[] = [];
    for (let i = 0; i < 50 * 1200; i++) {
      world.tick(0.02, neutralInput({ throttle: 1, sas: 'prograde' }));
      const on = v.telemetry.thrust > 200;
      if (phases.at(-1) !== on) phases.push(on);
    }
    expect(phases.slice(phases.indexOf(true), phases.indexOf(true) + 3)).toEqual([true, false, true]);
    expect(v.parts.find(p => p.partId === 'eng-whisper')!.engine!.ignited).toBe(true);
    expect(xenon()).toBeLessThan(x0);
  }, 180000);

  it('Hopscotch climbs, falls back and lands upright on its legs', () => {
    const { world, vessel } = launch('standard', buildHopscotch());
    const parts = vessel.state.parts.length;
    world.tick(0.02, neutralInput({ throttle: 1, stage: true, sas: 'stabilityAssist' }));
    let peak = 0;
    for (let i = 0; i < 50 * 300; i++) {
      const climbing = dot(localFrame(world, vessel).rs.velocity, localFrame(world, vessel).up) > 0;
      peak = Math.max(peak, radarAltitude(world, vessel));
      if (!climbing && i > 200) break;
      world.tick(0.02, neutralInput({ throttle: peak < 1000 ? 1 : 0, sas: 'stabilityAssist', gear: false }));
    }
    expect(peak).toBeGreaterThan(1000);
    const land = landingController(world, {});
    fly(world, land, 600);
    expect(vessel.state.situation).toBe('landed');
    expect(land.touchdown!.speed).toBeLessThan(4);
    expect(dot(noseDirection(vessel.state), localFrame(world, vessel).up)).toBeGreaterThan(0.95);
    expect(vessel.state.parts).toHaveLength(parts);
    // Fuel for more hops.
    expect(computeStageDeltaV(vessel.state, 0, 9.81)[0].dvVac).toBeGreaterThan(1000);
  }, 120000);
  it('Lamplighter lands on the Moon, hops to a second site, returns to orbit and heads home', () => {
    const { world, vessel } = launch('standard', buildLamplighter());
    // Stage numbers: booster 7 … Zephyr transfer 4, lander separation 3, Rill lander 2, capsule separation 1.
    toOrbit(world, 90000, 4);
    const tli = planTransferToBody(world, 'moon', { periapsisAltitude: 30000 });
    expect(tli).not.toBeNull();
    fly(world, executeNode(world, tli!.node, { minStage: 4 }), 2e6);
    const mcc = planCourseCorrection(world, 'moon', 30000, world.ut + 1800);
    expect(mcc).not.toBeNull();
    fly(world, executeNode(world, mcc!.node, { minStage: 4 }), 1e5);
    coastUntil(world, mcc!.encounterTime + 600, { stopOnSoi: true });
    expect(vessel.body).toBe('moon');
    fly(world, executeNode(world, planCircularization(world, 'periapsis'), { minStage: 2 }), 1e6);
    // Drop whatever is left of the transfer stage; the lander flies on its own.
    while (vessel.state.nextStage > 2) world.stageActive();
    world.stageActive();
    expect(propulsion(vessel.state).thrust).toBeGreaterThan(0);
    const parts = vessel.state.parts.length;
    const landAt = (label: string) => {
      const land = landingController(world, { minStage: 2 });
      fly(world, land, 1e5);
      expect(vessel.state.situation, label).toBe('landed');
      expect(land.touchdown!.speed, label).toBeLessThan(5);
      expect(dot(noseDirection(vessel.state), localFrame(world, vessel).up), label).toBeGreaterThan(0.9);
      expect(vessel.state.parts, label).toHaveLength(parts);
      return world.universe.surfaceInfo('moon', vessel.state.position, world.ut);
    };
    const first = landAt('first landing');
    // Hop: climb on the lander, tilt east a little, then land again somewhere else.
    for (let i = 0; i < 50 * 120; i++) {
      const f = localFrame(world, vessel);
      const climbing = dot(f.rs.velocity, f.up) > 0 || i < 100;
      if (!climbing) break;
      const dir = normalize(add(f.up, scale(f.east, 0.25)));
      world.tick(0.02, neutralInput({ throttle: i < 50 * 6 ? 1 : 0, sas: 'maneuver', maneuverDirection: dir }));
    }
    const second = landAt('hop landing');
    const hop = Math.hypot(second.lat - first.lat, second.lon - first.lon) * world.universe.body('moon').radius;
    expect(hop).toBeGreaterThan(200);
    fly(world, ascentGuidance(world, { targetApoapsis: 30000, minStage: 2 }), 1200);
    fly(world, executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 2 }), 1e5);
    const tei = planTransferToBody(world, 'earth', { periapsisAltitude: 35000 });
    expect(tei).not.toBeNull();
    fly(world, executeNode(world, tei!.node, { minStage: 2 }), 1e6);
    coastUntil(world, tei!.encounterTime + 600, { stopOnSoi: true });
    expect(vessel.body).toBe('earth');
    const pe = world.orbitSummary(vessel).pe;
    expect(pe).toBeGreaterThan(0);
    expect(pe).toBeLessThan(world.universe.body('earth').atmosphere!.height);
  }, 600000);

  it('Duskwing reaches Challenging orbit, flies to Mars and captures with fuel left in the orbiter', () => {
    const { world } = launch('challenging', buildDuskwing());
    toOrbit(world, 140000);
    cruise(world, 'mars', 150000, 1);
    fly(world, executeNode(world, planCircularization(world, 'periapsis')), 1e6);
    const orbit = world.orbitSummary(world.active!);
    expect(orbit.pe).toBeGreaterThan(world.universe.body('mars').atmosphere!.height);
    expect(orbit.ap).toBeLessThan(400000);
    expect(world.active!.state.parts.some(p => p.partId === 'probe-vault')).toBe(true);
    // The orbiter keeps its own Mistral stage for orbit changes and aerobraking passes.
    expect(dvLeft(world)).toBeGreaterThan(1500);
  }, 300000);

  it('Keystone puts its five-metre payload into Real orbit with margin', () => {
    const { world } = launch('real', buildKeystone());
    // Stage 0 is the module release; never separate it during ascent.
    toOrbit(world, 220000, 1);
    expect(dvLeft(world)).toBeGreaterThan(500);
    expect(world.active!.state.parts.some(p => p.partId === 'battery-bank-3')).toBe(true);
  }, 300000);

  it('Cinderbloom has the Δv for Venus, and its Kiln shell lands intact without parachutes', () => {
    {
      const { world } = launch('standard', buildCinderbloom());
      toOrbit(world, 85000, 1);
      const plan = planTransferToBody(world, 'venus');
      expect(plan).not.toBeNull();
      expect(dvLeft(world)).toBeGreaterThan(plan!.dv * 1.5);
    }
    // Entry: the lander (Kiln probe, shell and shield) arrives at the top of the atmosphere at 3.4 km/s, 20° down.
    const full = buildCinderbloom();
    const shieldUid = full.parts.find(p => p.partId === 'shield-2')!.uid;
    const craft = removeEmptyStages({ ...full, parts: full.parts.filter(p => p.uid <= shieldUid) });
    const universe = new Universe('standard');
    const world = new World(universe, PART_CATALOG, DEFAULT_START_UT);
    const venus = universe.body('venus');
    const up = normalize(v3(0.3, 0.2, 0.93));
    const east = normalize(cross(v3(0, 0, 1), up));
    const path = 20 * Math.PI / 180;
    const position = add(universe.ephem.getBodyState('venus', world.ut).position, scale(up, venus.radius + venus.atmosphere!.height));
    const direction = normalize(add(scale(east, Math.cos(path)), scale(up, -Math.sin(path))));
    const wind = universe.createEnvironment(() => 'venus').air(position, world.ut).windVelocity;
    const lander = world.spawnVessel(craft, { position, velocity: add(wind, scale(direction, 3400)), orientation: qFromTo(v3(0, 1, 0), scale(direction, -1)) });
    world.switchTo(lander.state.id);
    let dropped = false, hottest = 0, touchdown = 0;
    for (let i = 0; i < 40000 && lander.state.situation !== 'landed'; i++) {
      const speed = length(world.surfaceVelocity(lander));
      const stage: boolean = !dropped && speed < 300;
      dropped ||= stage;
      touchdown = speed;
      world.tick(0.1, neutralInput({ stage, sas: 'retrograde', sasReference: 'surface' }));
      for (const p of lander.state.parts) if (p.partId === 'shield-2') hottest = Math.max(hottest, peakTemperature(p));
      expect(lander.state.destroyed).toBe(false);
    }
    expect(dropped).toBe(true);
    expect(hottest).toBeLessThan(PART_CATALOG.get('shield-2')!.maxTemp);
    expect(lander.state.situation).toBe('landed');
    expect(touchdown).toBeLessThan(PART_CATALOG.get('shell-kiln')!.crashTolerance);
    expect(lander.state.parts.map(p => p.partId).sort()).toEqual(['probe-kiln', 'shell-kiln']);
  }, 300000);
  it('Duskwing\'s orbiter aerobrakes at Mars: one pass through the thin air shrinks its orbit, intact', () => {
    const full = buildDuskwing();
    const release = Math.min(...full.parts.filter(p => p.partId === 'dec-2').map(p => p.uid));
    const orbiter = removeEmptyStages({ ...full, parts: full.parts.filter(p => p.uid < release) });
    const { world, vessel } = launch('challenging', orbiter);
    placeOnState(world, vessel, 'mars', orbitState(world, 'mars', { pe: 35000, ap: 3000000, inc: 5, nu: 200 }));
    world.switchTo(vessel.state.id);
    const parts = vessel.state.parts.length;
    const before = world.orbitSummary(vessel);
    coastUntil(world, world.ut + before.timeToPe - 300);
    for (let i = 0; i < 50 * 600; i++) world.tick(0.02, neutralInput({ sas: 'retrograde' }));
    const after = world.orbitSummary(vessel);
    expect(after.ap).toBeLessThan(before.ap * 0.7);
    expect(after.pe).toBeGreaterThan(20000);
    expect(vessel.state.parts).toHaveLength(parts);
  }, 120000);

  it('payloads with fragile antennas launch inside fairings (Gossamer, Beaconseed, Lodestar, Duskwing)', () => {
    for (const craft of [buildRingTour(), buildRelayLauncher(), buildLodestar(), buildDuskwing()]) {
      const v = buildVessel(craft, PART_CATALOG);
      const exposed = v.parts.filter(p => p.def.modules.some(m => m.type === 'antenna' || m.type === 'solarPanel') && !v.cache.shielded?.has(p.uid));
      expect(exposed.map(p => p.partId), craft.name).toEqual([]);
    }
  });

  it('Gossamer still reaches orbit with its Saturn departure budget', () => {
    const { world } = launch('standard', buildRingTour());
    toOrbit(world, 85000);
    const saturn = planTransferToBody(world, 'saturn');
    expect(saturn).not.toBeNull();
    expect(dvLeft(world)).toBeGreaterThan(saturn!.dv * 1.8);
  }, 120000);
});
