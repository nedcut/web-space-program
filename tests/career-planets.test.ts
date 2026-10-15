import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT } from '../src/game/store';
import { facilityProblem } from '../src/data/technology';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { buildCinderbloom } from '../src/editor/stock/space';
import { buildPetrel } from '../src/editor/stock/probes';
import { removeEmptyStages } from '../src/editor/core';
import { executeNode, planTransferToBody, runAutopilot } from '../src/game/autopilot';
import { generateContracts, newProgression } from '../src/sim/science/progression';
import { careerScaleMultiplier } from '../src/sim/bodies/scale';
import { nextGoal, researchFor } from '../src/ui/hub/nextGoal';
import { neutralInput } from '../src/sim/vessel';
import { length, normalize, scale, add, v3 } from '../src/util/vec3';
import { qFromTo } from '../src/util/quat';
import { toOrbit } from '../scripts/career/flights';
import { capture, toPlanet } from '../scripts/career/planets';

/** Career past the Moon: interplanetary legs flown through the real World and the flight-assist programs. */
const career = (preset: 'standard' | 'challenging' | 'real', ut = DEFAULT_START_UT) => new World(new Universe(preset), PART_CATALOG, ut, 'career');

describe('interplanetary departures', () => {
  it('flies a Venus departure with a plane change to the end (escape guidance stays well-conditioned)', () => {
    // Day 30, Standard: the planner's best Venus option is "now", 1.4 km/s with a large normal component. The
    // guidance aimed 174° around the escape hyperbola and its Lambert plane flipped: the burn stopped after 359 m/s.
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 30 * 86400, 'sandbox');
    w.launch(buildCinderbloom());
    expect(toOrbit(w, new Set(), 85000, 1)).toBeNull();
    const plan = planTransferToBody(w, 'venus');
    expect(plan).not.toBeNull();
    expect(Math.abs(plan!.node.normal)).toBeGreaterThan(200);
    const burn = executeNode(w, plan!.node, { minStage: 0 });
    expect(runAutopilot(w, burn, { maxTime: plan!.node.time - w.ut + 1e4 }), burn.error).toBe(true);
    expect(burn.dvUsed()).toBeGreaterThan(plan!.dv * 0.95);
    expect(burn.residual()).toBeLessThan(5);
    expect(w.orbitOf(w.active!).e).toBeGreaterThan(1);
  }, 240_000);
});

describe('planetary probes', () => {
  it('the Petrel needs the scale orbiter, Remote Navigation and Long Range Telemetry, and fits level-1 facilities', () => {
    const cost = { standard: 200, challenging: 450, real: 450 } as const;
    for (const preset of ['standard', 'challenging', 'real'] as const) {
      const stock = STOCK_CRAFTS.find(s => s.id === (preset === 'standard' ? 'stock-petrel' : `stock-petrel-${preset}`))!;
      expect(stock.scale).toBe(preset);
      const p = newProgression(careerScaleMultiplier(preset));
      expect(researchFor(stock.id, p, 'career').cost, preset).toBe(cost[preset]);
      expect(researchFor(stock.id, p, 'career').nodes).toEqual(expect.arrayContaining(['guidance-1', 'energy-2']));
      expect(facilityProblem(stock.build(), PART_CATALOG, 'career', p, preset), preset).toBeNull();
    }
  });

  it('a Standard Petrel reaches Mars in contact and captures into low orbit with its kick stage', () => {
    const w = career('standard', DEFAULT_START_UT + 30 * 86400);
    w.progression.unlocked.push(...researchFor('stock-petrel', w.progression, 'career').nodes);
    w.progression.funds = 1e6;
    w.launch(buildPetrel('standard'));
    const biomes = new Set<string>();
    expect(toOrbit(w, biomes, 85000, 2)).toBeNull();
    const mars = w.universe.body('mars');
    const leg = toPlanet(w, biomes, 'mars', 0, mars.atmosphere!.height * 1.5);
    expect(leg.err).toBeNull();
    expect(leg.leg!.contact).toBe(true);
    expect(leg.leg!.trimDv).toBeLessThan(100);
    expect(capture(w, biomes, mars.atmosphere!.height * 1.9, 0).err).toBeNull();
    const o = w.orbitSummary(w.active!);
    expect(o.pe).toBeGreaterThan(mars.atmosphere!.height);
    expect(w.progression.milestones).toContain('first-mars');
    expect(w.scienceInstruments().some(i => i.available && i.value > 0)).toBe(true);
  }, 300_000);

  it('the Kiln lander keeps its link on the Venus surface and sends its reading home', () => {
    const full = buildCinderbloom();
    const shell = full.parts.find(p => p.partId === 'shell-kiln')!.uid;
    const craft = removeEmptyStages({ ...full, parts: full.parts.filter(p => p.uid <= shell) });
    const w = career('standard');
    w.progression.unlocked.push(...researchFor('stock-cinderbloom', w.progression, 'career').nodes);
    const venus = w.universe.body('venus');
    const up = normalize(v3(0.3, 0.2, 0.93));
    const position = add(w.universe.ephem.getBodyState('venus', w.ut).position, scale(up, venus.radius + 4000));
    const wind = w.universe.createEnvironment(() => 'venus').air(position, w.ut).windVelocity;
    const lander = w.spawnVessel(craft, { position, velocity: wind, orientation: qFromTo(v3(0, 1, 0), up) });
    w.switchTo(lander.state.id);
    for (let i = 0; i < 20000 && lander.state.situation !== 'landed'; i++) w.tick(0.1, neutralInput({ sas: 'stabilityAssist' }));
    expect(lander.state.situation).toBe('landed');
    expect(lander.state.destroyed).toBe(false);
    expect(w.canControl()).toBe(true);
    const thermal = w.scienceInstruments().find(i => i.experiment === 'temperature' && i.available)!;
    expect(w.runExperiment(thermal.uid, thermal.experiment)).not.toBeNull();
    const before = w.progression.science;
    w.transmitScience();
    for (let i = 0; i < 400 && w.transmitting.length; i++) w.tick(0.25, neutralInput({ sas: 'stabilityAssist' }));
    expect(w.progression.science - before).toBeGreaterThan(thermal.value * 0.39);
    expect(length(w.surfaceVelocity(w.active!))).toBeLessThan(1);
  }, 240_000);
});

describe('program milestones and offers past the Moon', () => {
  it('pays a first Venus and Mars arrival once, scaled like the Moon\'s', () => {
    const w = career('challenging'), p = w.progression;
    const funds = p.funds, science = p.science;
    w.emitProgress({ type: 'soi', body: 'mars', vesselId: 'x' });
    w.emitProgress({ type: 'soi', body: 'mars', vesselId: 'x' });
    expect(p.milestones).toContain('first-mars');
    expect(p.science - science).toBe(60);
    expect(p.funds - funds).toBe(Math.round(60000 * careerScaleMultiplier('challenging')));
    w.emitProgress({ type: 'landed', body: 'venus', vesselId: 'x' });
    expect(p.milestones).toContain('first-venus-landing');
  });

  it('offers Venus and Mars visits once a long-range probe can be built, never planet field surveys before landers', () => {
    const ready = { orbit: true, lunar: true, landing: true, planets: true };
    const offers = Array.from({ length: 12 }, (_, batch) => generateContracts(20300720, batch + 1, false, 1, ready)).flat();
    const visits = offers.filter(c => c.kind === 'flyby');
    expect(new Set(visits.map(c => c.body))).toEqual(new Set(['venus', 'mars']));
    expect(offers.some(c => c.kind === 'return' && c.body === 'moon')).toBe(true);
    expect(offers.filter(c => c.kind === 'science').every(c => c.body === 'earth' || c.body === 'moon')).toBe(true);
    // Without the dish, the same batches never send the program to the planets.
    const lunar = Array.from({ length: 12 }, (_, batch) => generateContracts(20300720, batch + 1, false, 1, { ...ready, planets: false })).flat();
    expect(lunar.some(c => c.body === 'venus' || c.body === 'mars')).toBe(false);
    // In a program, researching the dish after the first Moon arrival replaces the offers on the desk.
    const w = career('standard'), p = w.progression;
    p.milestones.push('first-orbit', 'first-moon-flyby');
    p.unlocked.push('propulsion-0', 'propulsion-1', 'structures-0', 'structures-1', 'guidance-0', 'guidance-1', 'energy-0', 'energy-1');
    p.science = 90;
    w.refreshContracts();
    const key = p.offerKey;
    expect(w.unlockTech('energy-2')).toBe(true);
    expect(p.offerKey).not.toBe(key);
  });
});

describe('hub next goal past the Moon', () => {
  it('sends a probe to whichever planet\'s season comes first, then lands on Venus (Standard)', () => {
    const p = newProgression();
    p.archive['temperature/earth/landed/Launch Complex'] = { body: 'earth', biome: 'Launch Complex', situation: 'landed', experiment: 'temperature', runs: 1, science: 8 };
    p.milestones.push('first-orbit', 'first-moon-flyby', 'first-moon');
    p.unlocked.push('propulsion-0', 'energy-0', 'structures-0', 'guidance-0');
    const soon = nextGoal(p, 'career', 'standard', { mars: 120, venus: 9 })!;
    expect(soon.title).toBe('Send a probe to Venus');
    expect(soon.detail).toMatch(/Petrel/);
    expect(nextGoal(p, 'career', 'standard', { mars: 20, venus: 150 })!.title).toBe('Send a probe to Mars');
    p.unlocked.push('guidance-1', 'energy-1', 'energy-2');
    expect(nextGoal(p, 'career', 'standard', { mars: 20, venus: 150 })!.detail).toMatch(/Next Mars launch season in about 20 days/);
    p.milestones.push('first-mars', 'first-venus');
    expect(nextGoal(p, 'career', 'standard')!.title).toBe('Land on Venus');
    expect(nextGoal(p, 'career', 'real')!.title).toBe('Explore the outer planets');
  });
});
