import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PART_CATALOG, PART_DEFS, findModule, getPart } from '../src/data/parts';
import { TECH_NODES } from '../src/data/technology';
import { validateCraft } from '../src/editor/core/stats';
import { buildPartMesh, setPartDeploy } from '../src/render/parts';
import { hasControl, seatCapacity } from '../src/sim/crew/crew';
import { buildVessel, cloneVessel, gearState, neutralInput, setGear, stepVessel } from '../src/sim/vessel';
import { stepPowerSources, totalResource } from '../src/sim/vessel/resources';
import { stackCraft, vacuumEnv } from '../src/sim/vessel/testing';

function powerVessel(source = 'fuelcell-1', separated = false) {
  const ids = ['battery-bank-2', 'tank-1-mid', ...(separated ? ['dec-1'] : []), source];
  const craft = stackCraft(ids, PART_CATALOG);
  // Fuel cells actually mount radially, not on the artificial testing stack.
  craft.parts.at(-1)!.attachNode = 'srf';
  const v = buildVessel(craft, PART_CATALOG);
  v.parts[0].resources.electricCharge = 0;
  return v;
}

describe('expedition electrical sources', () => {
  it('converts a balanced propellant mix to charge from a radial host tank', () => {
    const v = powerVessel();
    const tank = v.parts[1], lf = tank.resources.liquidFuel!, ox = tank.resources.oxidizer!;
    stepPowerSources(v, 10);
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(30, 10);
    expect(lf - tank.resources.liquidFuel!).toBeCloseTo(0.12, 10);
    expect(ox - tank.resources.oxidizer!).toBeCloseTo(0.22, 10);
  });
  it('limits burn to electrical storage headroom and stops with full batteries', () => {
    const v = powerVessel();
    v.parts[0].resources.electricCharge = 7999;
    const fuel = v.parts[1].resources.liquidFuel!;
    stepPowerSources(v, 10);
    expect(totalResource(v, 'electricCharge')).toBe(8000);
    expect(fuel-v.parts[1].resources.liquidFuel!).toBeCloseTo(0.004, 10);
    const left = v.parts[1].resources.liquidFuel;
    stepPowerSources(v, 10);
    expect(v.parts[1].resources.liquidFuel).toBe(left);
  });
  it('scales output and both reactants when one propellant runs out', () => {
    const v = powerVessel();
    v.parts[1].resources.oxidizer = 0.011;
    const fuel = v.parts[1].resources.liquidFuel!;
    stepPowerSources(v, 10);
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(1.5, 10);
    expect(v.parts[1].resources.oxidizer).toBe(0);
    expect(fuel-v.parts[1].resources.liquidFuel!).toBeCloseTo(0.006, 10);
    stepPowerSources(v, 10);
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(1.5, 10);
  });
  it('cannot bypass a decoupler even when radially mounted', () => {
    const v = powerVessel('fuelcell-1', true);
    stepPowerSources(v, 10);
    expect(totalResource(v, 'electricCharge')).toBe(0);
  });
  it('produces isotope power in darkness without consuming propellant', () => {
    const v = powerVessel('generator-isotope');
    const fuel = v.parts[1].resources.liquidFuel;
    stepPowerSources(v, 20);
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(16, 10);
    expect(v.parts[1].resources.liquidFuel).toBe(fuel);
    v.parts[0].resources.electricCharge = 7999;
    stepPowerSources(v, 20);
    expect(totalResource(v, 'electricCharge')).toBe(8000);
  });
  it.each(['fuelcell-1', 'generator-isotope'])('%s runs in the physics integrator', id => {
    const v = powerVessel(id);
    const env = { ...vacuumEnv(), sun: () => ({ dir: { x: 0, y: 0, z: 1 }, distance: Infinity }) };
    stepVessel(v, neutralInput(), env, 0);
    const rate = id === 'fuelcell-1' ? 3 : 0.8;
    expect(totalResource(v, 'electricCharge')).toBeCloseTo(rate * 0.02, 10);
  });
});

describe('passenger hardware and deployment', () => {
  it.each(['cabin-wayfarer', 'lab-crucible'])('%s carries crew without control', id => {
    const craft = stackCraft([id], PART_CATALOG);
    const v = buildVessel(craft, PART_CATALOG);
    v.parts[0].crew = Array.from({ length: seatCapacity(v.parts[0]) }, (_, i) => `passenger-${i}`);
    expect(seatCapacity(v.parts[0])).toBe(id === 'cabin-wayfarer' ? 4 : 2);
    expect(hasControl(v)).toBe(false);
    expect(validateCraft(craft, PART_CATALOG).some(w => w.code === 'no-command')).toBe(true);
    const controlled = buildVessel(stackCraft([id, 'probe-pebble'], PART_CATALOG), PART_CATALOG);
    expect(hasControl(controlled)).toBe(true);
  });
  it.each(['bay-cargo-1', 'bay-cargo-2', 'bay-service-1', 'bay-service-2'])('%s has hinged doors and persistent state', id => {
    const v = buildVessel(stackCraft([id], PART_CATALOG), PART_CATALOG);
    expect(gearState(v)).toBe(false);
    setGear(v, true);
    expect(cloneVessel(v).parts[0].bayOpen).toBe(true);
    expect(gearState(v)).toBe(true);
    setGear(v, false);
    expect(v.parts[0].bayOpen).toBe(false);
    const mesh = buildPartMesh(getPart(id));
    const door = mesh.getObjectByName('bayDoorA')!;
    const stowed = new THREE.Box3().setFromObject(mesh, true);
    expect(door.rotation.y).toBe(0);
    setPartDeploy(mesh, 1);
    expect(Math.abs(door.rotation.y)).toBeGreaterThan(1);
    expect(new THREE.Box3().setFromObject(mesh, true).getSize(new THREE.Vector3()).x).toBeGreaterThan(stowed.getSize(new THREE.Vector3()).x);
    setPartDeploy(mesh, 0);
    expect(door.rotation.y).toBe(0);
  });
  it('puts every catalogue part in exactly one research node and reserves advanced hardware', () => {
    for (const p of PART_DEFS) expect(TECH_NODES.filter(n => n.parts.includes(p.id))).toHaveLength(1);
    expect(TECH_NODES.find(n => n.id === 'propulsion-3')!.parts).toContain('eng-hearth');
    expect(TECH_NODES.find(n => n.id === 'energy-3')!.parts).toContain('generator-isotope');
    expect(TECH_NODES.find(n => n.id === 'structures-3')!.parts).toContain('fairing-4');
  });
  it('keeps aerospike pressure efficiency nearly flat and rover wheels powered', () => {
    const e = findModule(getPart('eng-needle'), 'engine')!;
    expect(e.ispAsl/e.ispVac).toBeGreaterThan(0.95);
    for (const id of ['rover-wheel-0', 'rover-wheel-1']) {
      const wheel = findModule(getPart(id), 'wheel')!;
      expect(wheel.motorTorque).toBeGreaterThan(0);
      expect(wheel.retractable).toBe(false);
      expect(wheel.steerAngle).toBeGreaterThan(0);
    }
  });
});
