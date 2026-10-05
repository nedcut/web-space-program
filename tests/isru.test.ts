import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { RESOURCES, resourceMass } from '../src/data/resources';
import { concentrationAt } from '../src/sim/resources/deposits';
import { advanceISRU } from '../src/sim/vessel/isru';
import { buildVessel, cloneVessel, neutralInput, stepVessel } from '../src/sim/vessel';
import { totalResource } from '../src/sim/vessel/resources';
import { vacuumEnv } from '../src/sim/vessel/testing';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { qIdentity, qRotate } from '../src/util/quat';
import { v3, add, scale } from '../src/util/vec3';
import type { CraftDef, ResourceId } from '../src/sim/vessel/types';
import { TECH_NODES } from '../src/data/technology';
import { ISRU_PARTS } from '../src/data/isru';

const u = new Universe('standard');
const craft = (): CraftDef => ({ name: 'Surface foundry', type: 'VAB', version: 1,
  parts: ['regolith-silo', 'drill-burrow', 'converter-foundry', 'battery-brick', 'tank-1-short', 'mono-pip', 'scanner-meridian', 'scanner-assay'].map((id, i) => ({
    uid: i + 1, partId: id, parent: i ? 1 : undefined, attachNode: i ? 'srf' : undefined,
    position: v3(i * 2, 0, 0), rotation: qIdentity(),
    resources: id.startsWith('regolith') ? { regolith: 0 } : id.startsWith('tank') ? { liquidFuel: 0, oxidizer: 0 } : undefined,
  })) });
function vessel() {
  const v = buildVessel(craft(), PART_CATALOG); v.situation = 'landed';
  for (const p of v.parts) if (p.maxResources.monopropellant) p.resources.monopropellant = 0;
  return v;
}
const mass = (v: ReturnType<typeof vessel>) => v.parts.reduce((s, p) => s + resourceMass(p.resources), 0);
const amounts = (v: ReturnType<typeof vessel>) => Object.keys(RESOURCES).map(id => totalResource(v, id as ResourceId));

describe('regolith deposits', () => {
  it('is deterministic, bounded, scale independent and absent on nonsolid bodies', () => {
    const real = new Universe('real');
    for (const b of u.bodies.values()) for (let i = 0; i < 80; i++) {
      const d = v3(Math.sin(i), Math.cos(i), Math.sin(i * 17));
      const c = concentrationAt(b, d);
      expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1);
      expect(concentrationAt(real.body(b.id), d)).toBe(c);
      if (!b.solidSurface) expect(c).toBe(0);
    }
    expect(concentrationAt(u.body('moon'), v3(1, 0, 0))).not.toBe(concentrationAt(u.body('mars'), v3(1, 0, 0)));
  });
});
describe('resource machinery', () => {
  it('requires landed and deployed, consumes EC, heats its core and scales with concentration', () => {
    const v = vessel(), drill = v.parts[1];
    advanceISRU(v, 0.5, 5); expect(totalResource(v, 'regolith')).toBe(0);
    drill.drillDeployed = true; v.situation = 'flying'; advanceISRU(v, 0.5, 5);
    expect(totalResource(v, 'regolith')).toBe(0);
    v.situation = 'splashed'; advanceISRU(v, 0.5, 5); expect(totalResource(v, 'regolith')).toBe(0);
    v.situation = 'landed'; const ec = totalResource(v, 'electricCharge');
    advanceISRU(v, 0.5, 5);
    expect(totalResource(v, 'regolith')).toBeCloseTo(0.75, 12);
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(ec - 10, 12);
    expect(drill.processTemperature).toBeGreaterThan(288);
    const other = vessel(); other.parts[1].drillDeployed = true; other.parts[1].drillDeploy = 1;
    advanceISRU(other, 1, 5); expect(totalResource(other, 'regolith')).toBeCloseTo(1.5, 12);
  });
  it.each(['kerolox', 'monopropellant'] as const)('%s conserves mass within 1e-9 and consumes EC', recipe => {
    const v = vessel(); v.parts[0].resources.regolith = 50;
    v.parts[2].converterRunning = true; v.parts[2].converterRecipe = recipe;
    const before = mass(v), ec = totalResource(v, 'electricCharge');
    advanceISRU(v, 0, 10);
    expect(Math.abs(mass(v) - before)).toBeLessThan(1e-9);
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(ec - 40, 10);
    expect(totalResource(v, recipe === 'kerolox' ? 'liquidFuel' : 'monopropellant')).toBeGreaterThan(0);
  });
  it('stalls without charge, feedstock or output capacity, without wasting inputs', () => {
    const v = vessel(); v.parts[2].converterRunning = true;
    const before = amounts(v); advanceISRU(v, 0, 100); expect(amounts(v)).toEqual(before);
    v.parts[0].resources.regolith = 50;
    for (const p of v.parts) if (p.maxResources.oxidizer) p.resources.oxidizer = p.maxResources.oxidizer;
    const full = amounts(v); advanceISRU(v, 0, 100); expect(amounts(v)).toEqual(full);
    for (const p of v.parts) p.resources.electricCharge = 0;
    v.parts[1].drillDeployed = true; v.parts[1].drillDeploy = 1;
    const emptyEC = amounts(v); advanceISRU(v, 0.8, 100); expect(amounts(v)).toEqual(emptyEC);
  });
  it.each([0, 0.1, 899.9])('analytical catch-up matches 50 Hz through deployment and capacity/power boundaries (feed %s)', feed => {
    const a = vessel(); a.parts[0].resources.regolith = feed;
    a.parts[1].drillDeployed = true; a.parts[2].converterRunning = true;
    const b = cloneVessel(a);
    advanceISRU(a, 0.72, 100);
    for (let i = 0; i < 5000; i++) advanceISRU(b, 0.72, 0.02);
    amounts(a).forEach((n, i) => expect(n).toBeCloseTo(amounts(b)[i], 8));
    expect(a.parts[1].processTemperature).toBeCloseTo(b.parts[1].processTemperature!, 8);
    expect(a.parts[2].processTemperature).toBeCloseTo(b.parts[2].processTemperature!, 8);
  });
  it.each([null, 'generator-isotope', 'fuelcell-1'])('physics and landed rails agree with power source %s', source => {
    const design = craft();
    if (source) design.parts.push({ uid: 9, partId: source, parent: 5, attachNode: 'srf', position: v3(), rotation: qIdentity() });
    const w = new World(u, PART_CATALOG, 0); const wv = w.launch(design);
    wv.state.parts[4].resources.liquidFuel = 10; wv.state.parts[4].resources.oxidizer = 20;
    wv.mode = 'landedRails'; wv.state.situation = 'landed';
    wv.state.parts[1].drillDeployed = true; wv.state.parts[1].drillDeploy = 1;
    const v = cloneVessel(wv.state), c = w.localConcentration(wv);
    // Constant inertial test frame, ground contact latches landed each step.
    const env = { ...vacuumEnv(), regolithConcentration: () => c };
    v.position = v3(); v.velocity = v3();
    for (let i = 0; i < 500; i++) { v.situation = 'landed'; stepVessel(v, neutralInput(), env, i * 0.02, 0.02); }
    w.advanceRailsTo(10);
    expect(totalResource(wv.state, 'regolith')).toBeGreaterThan(0);
    amounts(v).forEach((n, i) => expect(n).toBeCloseTo(amounts(wv.state)[i], 8));
  });
  it.each(['generator-isotope', 'fuelcell-1'])('advances %s during landed rails catch-up through battery and fuel boundaries', source => {
    const design = craft();
    design.parts.push({ uid: 9, partId: source, parent: 5, attachNode: 'srf', position: v3(), rotation: qIdentity() });
    const w = new World(u, PART_CATALOG, 0), wv = w.launch(design);
    wv.mode = 'landedRails'; wv.state.situation = 'landed';
    wv.state.parts[1].drillDeployed = true; wv.state.parts[1].drillDeploy = 1;
    for (const p of wv.state.parts) if (p.maxResources.electricCharge) p.resources.electricCharge = 0;
    const tank = wv.state.parts[4]; tank.resources.liquidFuel = 1.2; tank.resources.oxidizer = 2.2;
    const smallSteps = cloneVessel(wv.state), concentration = w.localConcentration(wv);
    for (let i = 0; i < 10000; i++) advanceISRU(smallSteps, concentration, 0.02);
    w.advanceRailsTo(200);
    amounts(wv.state).forEach((n, i) => expect(n).toBeCloseTo(amounts(smallSteps)[i], 7));
    expect(wv.state.parts[1].processTemperature).toBeCloseTo(smallSteps.parts[1].processTemperature!, 7);
    // Empty batteries must still support generation-limited mining. Fuel-cell mixture is conserved.
    const generated = source === 'generator-isotope' ? 160 : 300;
    expect(totalResource(wv.state, 'regolith')).toBeCloseTo(generated / 2 * 0.3 * concentration, 7);
    expect(totalResource(wv.state, 'electricCharge')).toBeCloseTo(0, 8);
    expect(tank.resources.liquidFuel).toBeCloseTo(source === 'fuelcell-1' ? 0 : 1.2, 8);
    expect(tank.resources.oxidizer).toBeCloseTo(source === 'fuelcell-1' ? 0 : 2.2, 8);
  });
  it('preserves fuel-cell crossfeed isolation and stops fuel use at full batteries', () => {
    const design = craft();
    design.parts.push({ uid: 9, partId: 'fuelcell-1', parent: 1, attachNode: 'srf', position: v3(), rotation: qIdentity() });
    const isolated = buildVessel(design, PART_CATALOG);
    isolated.parts[4].resources.liquidFuel = 10; isolated.parts[4].resources.oxidizer = 20;
    for (const p of isolated.parts) if (p.maxResources.electricCharge) p.resources.electricCharge = 0;
    advanceISRU(isolated, 0.5, 10000);
    expect(totalResource(isolated, 'electricCharge')).toBe(0);
    expect(totalResource(isolated, 'liquidFuel')).toBe(10);
    design.parts[8].parent = 5;
    const connected = buildVessel(design, PART_CATALOG);
    connected.parts[4].resources.liquidFuel = 10; connected.parts[4].resources.oxidizer = 20;
    const before = amounts(connected);
    advanceISRU(connected, 0.5, 10000);
    expect(amounts(connected)).toEqual(before);
    // Refill exactly 30 EC; do not burn ten thousand seconds of propellant.
    connected.parts[3].resources.electricCharge! -= 30;
    advanceISRU(connected, 0.5, 10000);
    expect(totalResource(connected, 'liquidFuel')).toBeCloseTo(9.88, 10);
    expect(totalResource(connected, 'oxidizer')).toBeCloseTo(19.78, 10);
    expect(totalResource(connected, 'electricCharge')).toBe(before[Object.keys(RESOURCES).indexOf('electricCharge')]);
  });
  it('reads the current location after leaving a packed surface position', () => {
    const w = new World(u, PART_CATALOG, 0), wv = w.launch(craft());
    const b = u.body(wv.body), bs = u.ephem.getBodyState(b.id, 0);
    // Unpacking may retain the old fixed transform for subsequent contact handling.
    wv.mode = 'physics';
    const direction = v3(0, 0, 1);
    wv.state.position = add(bs.position, qRotate(u.ephem.bodyRotation(b.id, 0), scale(direction, b.radius)));
    expect(w.localConcentration(wv)).toBeCloseTo(concentrationAt(b, direction), 8);
  });
  it('persists deployment, operation, recipe, core heat and surveys, migrates older saves', () => {
    const w = new World(u, PART_CATALOG, 0); const wv = w.launch(craft());
    wv.state.parts[1].drillDeployed = true; wv.state.parts[2].converterRunning = true;
    wv.state.parts[2].converterRecipe = 'monopropellant'; advanceISRU(wv.state, 0.4, 1);
    w.surveyedBodies.push('moon');
    const saved = JSON.parse(JSON.stringify(serializeWorld(w)));
    const loaded = deserializeWorld(saved, PART_CATALOG);
    expect(serializeWorld(loaded)).toEqual(saved);
    delete saved.surveyedBodies; expect(deserializeWorld(saved, PART_CATALOG).surveyedBodies).toEqual([]);
    const copy = cloneVessel(wv.state); copy.parts[2].converterRunning = false;
    expect(wv.state.parts[2].converterRunning).toBe(true);
  });
  it('requires a bound polar orbit and scanner to survey', () => {
    const w = new World(u, PART_CATALOG, 0); const wv = w.launch(craft());
    expect(w.surveyBody()).toBe(false);
    const b = u.body('moon'), r = b.radius * 1.5, bs = u.ephem.getBodyState(b.id, 0), q = u.ephem.bodyRotation(b.id, 0);
    wv.body = b.id; wv.mode = 'physics'; wv.state.situation = 'flying';
    wv.state.position = add(bs.position, qRotate(q, v3(r, 0, 0)));
    wv.state.velocity = add(bs.velocity, qRotate(q, v3(0, Math.sqrt(b.gm / r), 0)));
    expect(w.surveyBody()).toBe(false);
    wv.state.velocity = add(bs.velocity, qRotate(q, v3(0, 0, Math.sqrt(b.gm / r))));
    expect(w.surveyBody()).toBe(true); expect(w.surveyBody()).toBe(true);
    expect(w.surveyedBodies).toEqual(['moon']);
    wv.state.velocity = add(bs.velocity, scale(qRotate(q, v3(0, 0, Math.sqrt(b.gm / r))), 2));
    expect(w.surveyBody()).toBe(false);
    wv.state.parts = wv.state.parts.filter(p => p.partId !== 'scanner-meridian'); expect(w.surveyBody()).toBe(false);
  });
  it('assigns every original resource part to exactly one technology', () => {
    for (const p of ISRU_PARTS) expect(TECH_NODES.filter(n => n.parts.includes(p.id))).toHaveLength(1);
  });
});
