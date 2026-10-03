import { describe, expect, it } from 'vitest';
import { qIdentity } from '../src/util/quat';
import {
  activateNextStage, buildVessel, computeAeroForces, liftingCoefficients, machDragMultiplier, neutralInput, stepVessel,
} from '../src/sim/vessel';
import type { CraftDef } from '../src/sim/vessel';
import { TEST_CATALOG, flatEarthEnv, stackCraft, NOSE_UP } from '../src/sim/vessel/testing';

describe('drag model', () => {
  it('Mach drag rise: 1x subsonic, ~2.5x at Mach 1.1, decays toward 1.6x', () => {
    expect(machDragMultiplier(0.5)).toBe(1);
    expect(machDragMultiplier(1.1)).toBeCloseTo(2.5, 9);
    expect(machDragMultiplier(1.0)).toBeGreaterThan(2);
    expect(machDragMultiplier(6)).toBeCloseTo(1.6, 2);
    expect(machDragMultiplier(2)).toBeLessThan(2.5);
  });

  it('occlusion: stacked parts shield each other axially', () => {
    const v = buildVessel(stackCraft(['tank', 'tank', 'tank-small']), TEST_CATALOG);
    const [a, b, c] = v.parts;
    const A = Math.PI * 0.625 ** 2;
    const ex = (uid: number) => v.cache.exposed.get(uid)!;
    expect(ex(a.uid)[2]).toBeCloseTo(A, 9); // top of top tank exposed
    expect(ex(a.uid)[3]).toBe(0); // bottom shielded by same-size tank
    expect(ex(b.uid)[2]).toBe(0);
    // small tank below: lower tank's bottom face partly exposed (annulus); small tank's top fully shielded
    expect(ex(b.uid)[3]).toBeCloseTo(A - Math.PI * 0.3125 ** 2, 9);
    expect(ex(c.uid)[2]).toBe(0);
    // side faces never shielded by stack nodes
    expect(ex(b.uid)[0]).toBeCloseTo(2 * 2 * 0.625, 9);
  });

  it('stacked tanks have less drag than the same tanks separately', () => {
    const v = buildVessel(stackCraft(['tank', 'tank']), TEST_CATALOG);
    const single = buildVessel(stackCraft(['tank']), TEST_CATALOG);
    const air = { pressure: 101325, density: 1.225, temperature: 288, speedOfSound: 340 };
    const ctx = { air, airVelocityBody: { x: 0, y: 100, z: 0 }, control: { x: 0, y: 0, z: 0 } };
    const fStack = computeAeroForces(v, ctx).forceBody.y;
    const fSingle = computeAeroForces(single, ctx).forceBody.y;
    expect(fStack).toBeLessThan(0);
    expect(Math.abs(fStack)).toBeLessThan(2 * Math.abs(fSingle) * 0.7);
  });

  it('terminal velocity of a falling body matches sqrt(2mg/(rho Cd A))', () => {
    const env = flatEarthEnv({ scaleHeight: Infinity, surface: 'none' });
    const v = buildVessel(stackCraft(['ballast']), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 50_000 } });
    let t = 0;
    for (let i = 0; i < 4000; i++, t += 0.02) stepVessel(v, neutralInput(), env, t);
    const expected = Math.sqrt((2 * 100 * 9.80665) / (1.225 * 0.8 * Math.PI * 0.25));
    expect(Math.abs(-v.velocity.z - expected) / expected).toBeLessThan(0.01);
  });
});

describe('lifting surfaces', () => {
  it('lift slope, stall and induced drag', () => {
    const a = 2 * Math.PI;
    const small = liftingCoefficients(0.05, a);
    expect(small.cl).toBeCloseTo(a * 0.05, 9);
    expect(small.cd).toBeGreaterThan(0.008);
    const preStall = liftingCoefficients(0.28, a).cl;
    const postStall = liftingCoefficients(0.6, a).cl;
    expect(postStall).toBeLessThan(preStall * 0.6);
    expect(liftingCoefficients(-0.05, a).cl).toBeCloseTo(-small.cl, 9);
  });

  it('a wing at positive AoA generates lift along its normal (+X) and induced drag', () => {
    const craft: CraftDef = { name: 'w', type: 'SPH', version: 1, parts: [{ uid: 1, partId: 'wing', position: { x: 0, y: 0, z: 0 }, rotation: qIdentity() }] };
    const v = buildVessel(craft, TEST_CATALOG);
    const air = { pressure: 101325, density: 1.225, temperature: 288, speedOfSound: 340 };
    const alpha = 0.08;
    // Moving along +Y (chord), slightly toward -X => air hits the -X face => AoA +alpha
    const vel = { x: -100 * Math.sin(alpha), y: 100 * Math.cos(alpha), z: 0 };
    const f = computeAeroForces(v, { air, airVelocityBody: vel, control: { x: 0, y: 0, z: 0 } }).forceBody;
    const q = 0.5 * 1.225 * 100 * 100;
    const expectedLift = q * 4.5 * 2 * Math.PI * 0.85 * alpha * (1 / Math.sqrt(1 - (100 / 340) ** 2));
    const liftDir = { x: Math.cos(alpha), y: Math.sin(alpha), z: 0 };
    const lift = f.x * liftDir.x + f.y * liftDir.y;
    expect(lift / expectedLift).toBeGreaterThan(0.97);
    expect(lift / expectedLift).toBeLessThan(1.05);
  });
});

describe('parachutes', () => {
  it('capsule under a full chute descends at 5–8 m/s and lands intact', () => {
    const env = flatEarthEnv();
    const craft = stackCraft([{ partId: 'chute', stage: 0 }, 'capsule']);
    const v = buildVessel(craft, TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 3000 }, velocity: { x: 0, y: 0, z: -120 } });
    activateNextStage(v);
    const chute = v.parts.find((p) => p.chute)!;
    expect(chute.chute!.phase).toBe('armed');
    let t = 0;
    let vAt30 = NaN;
    const phases = new Set<string>();
    for (let i = 0; i < 50 * 600 && v.situation !== 'landed'; i++, t += 0.02) {
      stepVessel(v, neutralInput(), env, t);
      phases.add(chute.chute!.phase);
      if (Number.isNaN(vAt30) && v.position.z < 30) vAt30 = -v.velocity.z;
    }
    expect(phases.has('semi')).toBe(true);
    expect(phases.has('full')).toBe(true);
    expect(vAt30).toBeGreaterThan(5);
    expect(vAt30).toBeLessThan(8);
    expect(v.situation).toBe('landed');
    expect(v.parts).toHaveLength(2);
  });

  it('does not deploy while dynamic pressure is above 1.5x the rated maximum; cuts if overloaded', () => {
    const env = flatEarthEnv({ scaleHeight: Infinity, surface: 'none' });
    const v = buildVessel(stackCraft([{ partId: 'chute', stage: 0 }, 'capsule']), TEST_CATALOG, {
      orientation: NOSE_UP, position: { x: 0, y: 0, z: 5000 }, velocity: { x: 0, y: 0, z: -300 },
    });
    activateNextStage(v);
    stepVessel(v, neutralInput(), env, 0);
    expect(v.parts[0].chute!.phase).toBe('armed');
    // force a deployed chute into an overload
    v.parts[0].chute!.phase = 'full';
    v.parts[0].chute!.progress = 1;
    stepVessel(v, neutralInput(), env, 0.02);
    expect(v.parts[0].chute!.phase).toBe('cut');
  });
});
