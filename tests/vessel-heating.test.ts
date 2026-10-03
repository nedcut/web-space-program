import { describe, expect, it } from 'vitest';
import {
  SUTTON_GRAVES_K_EARTH, buildVessel, peakTemperature, neutralInput, recoveryTemperature, stagnationHeatFlux, stepThermal, stepVessel, suttonGravesK,
} from '../src/sim/vessel';
import { TEST_CATALOG, stackCraft, vacuumEnv, NOSE_UP } from '../src/sim/vessel/testing';

const AU = 1.495978707e11;
const earthAir = (rho: number) => ({ pressure: rho * 287.05 * 250, density: rho, temperature: 250, speedOfSound: Math.sqrt(1.4 * 287.05 * 250) });

describe('heating', () => {
  it('Sutton–Graves stagnation flux and per-atmosphere constant', () => {
    expect(stagnationHeatFlux(1e-3, 7000, 1)).toBeCloseTo(SUTTON_GRAVES_K_EARTH * Math.sqrt(1e-3) * 7000 ** 3, 6);
    expect(suttonGravesK(earthAir(1e-3)) / SUTTON_GRAVES_K_EARTH).toBeCloseTo(1, 2);
    // CO2 (M = 0.044): literature ~1.9e-4
    const co2 = { pressure: 600, density: 600 * 0.044 / (8.314 * 210), temperature: 210, speedOfSound: 230 };
    expect(suttonGravesK(co2)).toBeGreaterThan(1.8e-4);
    expect(suttonGravesK(co2)).toBeLessThan(2.1e-4);
    // Recovery temperature ~ T + v^2/(2cp)
    expect(recoveryTemperature(earthAir(1e-3), 1000)).toBeCloseTo(250 + (0.9 * 1e6) / (2 * 1004.7), -1);
  });

  it('heat shield ablates and protects the capsule; an unshielded tank burns up', () => {
    const v = buildVessel(stackCraft(['capsule', 'heatshield']), TEST_CATALOG);
    const shield = v.parts[1];
    const capsule = v.parts[0];
    const ctx = { air: earthAir(1e-3), airVelocityBody: { x: 0, y: -7500, z: 0 }, sunDirBody: { x: 1, y: 0, z: 0 }, sunDistance: AU };
    let destroyed: number[] = [];
    for (let i = 0; i < 50 * 120; i++) destroyed = destroyed.concat(stepThermal(v, ctx, 0.02));
    expect(destroyed).toEqual([]);
    expect(shield.resources.ablator!).toBeLessThan(150);
    expect(shield.skinTemperature[3]).toBeGreaterThan(1000); // flow-facing (-Y) skin is hot
    expect(peakTemperature(shield)).toBeLessThan(shield.maxTemp);
    expect(peakTemperature(capsule)).toBeLessThan(500); // protected
    expect(shield.skinTemperature[2]).toBeLessThan(shield.skinTemperature[3]);

    const tank = buildVessel(stackCraft(['tank']), TEST_CATALOG);
    tank.parts[0].resources = { liquidFuel: 0, oxidizer: 0 };
    let burnt = false;
    for (let i = 0; i < 50 * 300 && !burnt; i++) burnt = stepThermal(tank, ctx, 0.02).length > 0;
    expect(burnt).toBe(true);
  });

  it('radiative equilibrium in sunlight at 1 AU reaches radiative equilibrium (absorbed = emitted)', () => {
    const v = buildVessel(stackCraft(['ballast']), TEST_CATALOG);
    const ctx = { air: { pressure: 0, density: 0, temperature: 3, speedOfSound: 0 }, airVelocityBody: { x: 0, y: 0, z: 0 }, sunDirBody: { x: 1, y: 0, z: 0 }, sunDistance: AU };
    for (let i = 0; i < 200_000; i++) stepThermal(v, ctx, 1);
    // Steady state: sunlight absorbed on the sun-facing projected area (+X side, h*2r = 1 m^2) equals the
    // total emission of all skins.
    const p = v.parts[0];
    const absorbed = 0.4 * 1361 * 1.0;
    const q = Math.PI * 1.0 * 1.0 / 4; // lateral area quadrant per side face
    const areas = [q, q, Math.PI * 0.25, Math.PI * 0.25, q, q];
    const emitted = areas.reduce((s, a, f) => s + 0.8 * 5.670374419e-8 * a * (p.skinTemperature[f] ** 4 - 3 ** 4), 0);
    expect(Math.abs(emitted - absorbed) / absorbed).toBeLessThan(1e-3);
    expect(p.skinTemperature[0]).toBeGreaterThan(p.skinTemperature[1]); // sunlit side warmer
    expect(p.temperature).toBeGreaterThan(200);
    expect(p.temperature).toBeLessThan(260);
  });

  it('overheated parts are destroyed during stepVessel', () => {
    const v = buildVessel(stackCraft(['capsule', 'tank']), TEST_CATALOG, { orientation: NOSE_UP });
    v.parts[1].temperature = 5000;
    const r = stepVessel(v, neutralInput(), vacuumEnv(), 0);
    expect(r.events.some((e) => e.type === 'partDestroyed' && e.reason === 'overheat')).toBe(true);
    expect(v.parts).toHaveLength(1);
  });
});
