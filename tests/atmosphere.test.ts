import { describe, expect, it } from 'vitest';
import { ATM, dynamicPressure, machNumber, sampleAtmosphere } from '../src/sim/atmosphere';
import { createUniverse } from '../src/sim/bodies';
import type { AtmosphereDef } from '../src/sim/bodies';

const earth = createUniverse('real').get('earth')!;
const atmo = earth.atmosphere!;

describe('hydrostatic atmosphere', () => {
  it('matches US Standard Atmosphere surface and tropopause values', () => {
    const sea = sampleAtmosphere(atmo, 0);
    expect(sea.pressure).toBe(ATM);
    expect(sea.temperature).toBe(288.15);
    expect(sea.density).toBeCloseTo(1.225, 3);
    expect(sea.speedOfSound).toBeCloseTo(340.3, 1);
    const tropopause = sampleAtmosphere(atmo, 11000);
    expect(tropopause.temperature).toBeCloseTo(216.65, 8);
    expect(Math.abs(tropopause.pressure - 22632)).toBeLessThan(2);
    const stratosphere = sampleAtmosphere(atmo, 20000);
    expect(stratosphere.temperature).toBeCloseTo(216.65, 8);
    expect(Math.abs(stratosphere.pressure - 5474.9)).toBeLessThan(2);
  });
  it('remains continuous at layer boundaries and decreases pressure throughout', () => {
    for (const layer of atmo.layers!.slice(1)) {
      const below = sampleAtmosphere(atmo, layer.altitude - 0.001);
      const above = sampleAtmosphere(atmo, layer.altitude + 0.001);
      expect(Math.abs(above.pressure / below.pressure - 1)).toBeLessThan(1e-6);
      expect(Math.abs(above.temperature - below.temperature)).toBeLessThan(1e-4);
    }
    let previous = Infinity;
    for (let h = 0; h <= atmo.height; h += 1000) {
      const sample = sampleAtmosphere(atmo, h);
      expect(sample.pressure).toBeLessThan(previous);
      expect(sample.density).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(sample.speedOfSound)).toBe(true);
      previous = sample.pressure;
    }
  });
  it('uses local gravity for Titan and for the isothermal scale height', () => {
    const titan = createUniverse('real').get('titan')!;
    const sea = sampleAtmosphere(titan.atmosphere, 0, titan.surfaceGravity);
    expect(Math.abs(sea.density - 5.3)).toBeLessThan(0.1);
    const model: AtmosphereDef = { surfacePressure: ATM, surfaceTemperature: 300,
      molarMass: 0.028, gamma: 1.4, height: 100000 };
    const scaleHeight = 8.31446261815324 * 300 / (0.028 * 2);
    expect(sampleAtmosphere(model, scaleHeight, 2).pressure).toBeCloseTo(ATM / Math.E, 7);
    expect(sampleAtmosphere(model, scaleHeight, 4).pressure).toBeLessThan(sampleAtmosphere(model, scaleHeight, 2).pressure);
  });
  it('uses scaled layer altitudes and lapse rates without rescaling them again', () => {
    const scaled = createUniverse().get('earth')!;
    const height = 11000 * Math.sqrt(0.1);
    const sample = sampleAtmosphere(scaled.atmosphere, height, scaled.surfaceGravity);
    expect(sample.temperature).toBeCloseTo(216.65, 8);
    expect(sample.pressure).toBeGreaterThan(60000);
    expect(sample.pressure).toBeLessThan(65000);
    expect(sampleAtmosphere(scaled.atmosphere, 0).density).toBeCloseTo(1.225, 3);
  });
  it('returns vacuum and smoothly tapers every output across the top five percent', () => {
    const top = atmo.height;
    const nearTop = sampleAtmosphere(atmo, top - 0.001);
    for (const value of [nearTop.pressure, nearTop.density, nearTop.temperature]) expect(value).toBeLessThan(1e-8);
    expect(nearTop.speedOfSound).toBeLessThan(0.001);
    const tail = sampleAtmosphere(atmo, top * 0.975);
    expect(tail.density).toBeCloseTo(tail.pressure * atmo.molarMass / (8.31446261815324 * tail.temperature), 12);
    expect(tail.speedOfSound).toBeCloseTo(Math.sqrt(atmo.gamma * 8.31446261815324 * tail.temperature / atmo.molarMass), 10);
    expect(sampleAtmosphere(undefined, 0)).toEqual({ pressure: 0, density: 0, temperature: 0, speedOfSound: 0 });
    expect(sampleAtmosphere(atmo, top)).toEqual(sampleAtmosphere(undefined, 0));
    expect(sampleAtmosphere(atmo, Infinity)).toEqual(sampleAtmosphere(undefined, 0));
    expect(sampleAtmosphere(atmo, -100)).toEqual(sampleAtmosphere(atmo, 0));
    const before = sampleAtmosphere(atmo, top * 0.95 - 0.001);
    const after = sampleAtmosphere(atmo, top * 0.95 + 0.001);
    expect(after.pressure).toBeCloseTo(before.pressure, 6);
    expect(after.temperature).toBeCloseTo(before.temperature, 6);
  });
  it('computes Mach number and dynamic pressure, including zero-speed vacuum', () => {
    expect(machNumber(-680.6, 340.3)).toBe(2);
    expect(machNumber(0, 0)).toBe(0);
    expect(machNumber(1, 0)).toBe(Infinity);
    expect(dynamicPressure(1.225, 100)).toBeCloseTo(6125, 8);
    expect(dynamicPressure(0, 100)).toBe(0);
  });
});
