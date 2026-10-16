import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/util/vec3';
import { length } from '../src/util/vec3';
import type { Quat } from '../src/util/quat';
import { qFromAxisAngle, qIdentity } from '../src/util/quat';
import { bodyToWorld, buildVessel, neutralInput, stepVessel } from '../src/sim/vessel';
import type { CraftDef, LandingLegModule, PartInstance, VesselState } from '../src/sim/vessel';
import { TEST_CATALOG, flatEarthEnv, stackCraft, NOSE_UP } from '../src/sim/vessel/testing';

/** Lander: box core with four legs surface-attached on its +-X / +-Z sides (craft +Y = up). */
function landerCraft(): CraftDef {
  const legs: [Vec3, Quat][] = [
    [{ x: 0.85, y: 0, z: 0 }, qFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2)],
    [{ x: -0.85, y: 0, z: 0 }, qFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2)],
    [{ x: 0, y: 0, z: 0.85 }, qIdentity()],
    [{ x: 0, y: 0, z: -0.85 }, qFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI)],
  ];
  const parts: PartInstance[] = [{ uid: 1, partId: 'lander-core', position: { x: 0, y: 0, z: 0 }, rotation: qIdentity() }];
  legs.forEach(([p, r], i) => parts.push({ uid: i + 2, partId: 'leg', position: p, rotation: r, parent: 1, attachNode: 'srf', parentNode: 'srf' }));
  return { name: 'lander', type: 'VAB', version: 1, parts };
}

/** Place the vessel so its lowest foot is `clearance` m above z = 0. */
function placeFeet(v: VesselState, clearance: number) {
  const leg = TEST_CATALOG.get('leg')!.modules[0] as LandingLegModule;
  let minZ = Infinity;
  for (const p of v.parts) if (p.leg) {
    const footBody = { x: p.position.x, y: p.position.y + leg.footPosition.y, z: p.position.z };
    minZ = Math.min(minZ, bodyToWorld(v, footBody).z);
  }
  v.position.z += clearance - minZ;
}

describe('landing legs', () => {
  it('suspension settles to the static compression without jitter', () => {
    const env = flatEarthEnv();
    const v = buildVessel(landerCraft(), TEST_CATALOG, { orientation: NOSE_UP, legsDeployed: true });
    placeFeet(v, 0.3);
    let t = 0;
    for (let i = 0; i < 50 * 10; i++, t += 0.02) stepVessel(v, neutralInput(), env, t);
    let zMin = Infinity, zMax = -Infinity, vMax = 0, wMax = 0;
    for (let i = 0; i < 50 * 3; i++, t += 0.02) {
      stepVessel(v, neutralInput(), env, t);
      zMin = Math.min(zMin, v.position.z);
      zMax = Math.max(zMax, v.position.z);
      vMax = Math.max(vMax, length(v.velocity));
      wMax = Math.max(wMax, length(v.angularVelocity));
    }
    expect(v.situation).toBe('landed');
    expect(zMax - zMin).toBeLessThan(1e-4);
    expect(vMax).toBeLessThan(1e-3);
    expect(wMax).toBeLessThan(1e-3);
    const staticCompression = (v.mass * 9.80665) / (4 * 40_000);
    for (const p of v.parts) if (p.leg) expect(p.leg.compression).toBeCloseTo(staticCompression, 3);
    expect(v.parts).toHaveLength(5);
  });

  it('static friction holds the lander on a horizontal push below the friction limit, slides above it', () => {
    const env = flatEarthEnv();
    const v = buildVessel(landerCraft(), TEST_CATALOG, { orientation: NOSE_UP, legsDeployed: true });
    placeFeet(v, 0.05);
    let t = 0;
    for (let i = 0; i < 50 * 6; i++, t += 0.02) stepVessel(v, neutralInput(), env, t);
    const x0 = v.position.x;
    for (let i = 0; i < 50 * 4; i++, t += 0.02) stepVessel(v, neutralInput(), env, t);
    expect(Math.abs(v.position.x - x0)).toBeLessThan(1e-6);
    // Slide: give it a lateral velocity; dynamic friction (mu 0.6) must stop it in ~v/(0.6 g)
    v.velocity = { x: 3, y: 0, z: 0 };
    for (let i = 0; i < 50 * 3; i++, t += 0.02) stepVessel(v, neutralInput(), env, t);
    expect(Math.abs(v.velocity.x)).toBeLessThan(1e-3);
    const slid = v.position.x - x0;
    expect(slid).toBeGreaterThan(0.4);
    expect(slid).toBeLessThan(1.5);
  });

  it('a hard landing destroys the legs', () => {
    const env = flatEarthEnv();
    const v = buildVessel(landerCraft(), TEST_CATALOG, { orientation: NOSE_UP, legsDeployed: true, velocity: { x: 0, y: 0, z: -25 } });
    placeFeet(v, 0.5);
    const events: string[] = [];
    for (let i = 0; i < 50; i++) for (const e of stepVessel(v, neutralInput(), env, i * 0.02).events) events.push(e.type);
    expect(events).toContain('partDestroyed');
    expect(v.parts.some((p) => p.leg)).toBe(false);
  });
});

describe('crashes and water', () => {
  it('a capsule hitting the ground faster than its crash tolerance is destroyed', () => {
    const env = flatEarthEnv();
    const v = buildVessel(stackCraft(['capsule']), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 3 }, velocity: { x: 0, y: 0, z: -40 } });
    let destroyed = false;
    for (let i = 0; i < 50; i++) if (stepVessel(v, neutralInput(), env, i * 0.02).events.some((e) => e.type === 'vesselDestroyed')) destroyed = true;
    expect(destroyed).toBe(true);
    expect(v.destroyed).toBe(true);
  });

  it('a gentle touchdown rests on the ground without bouncing', () => {
    const env = flatEarthEnv();
    const v = buildVessel(stackCraft(['capsule']), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 1 }, velocity: { x: 0, y: 0, z: -6 } });
    let maxUp = 0;
    for (let i = 0; i < 50 * 5; i++) {
      stepVessel(v, neutralInput(), env, i * 0.02);
      maxUp = Math.max(maxUp, v.velocity.z);
    }
    expect(maxUp).toBeLessThan(0.1);
    expect(v.situation).toBe('landed');
    expect(v.position.z).toBeGreaterThan(0.4);
    expect(length(v.velocity)).toBeLessThan(1e-2);
  });

  it('a buoyant body splashing down floats at its equilibrium draft; a dense one sinks', () => {
    const env = flatEarthEnv({ surface: 'water' });
    // ballast: 100 kg in a 0.785 m^3 cylinder (density ~127 kg/m^3)
    const v = buildVessel(stackCraft(['ballast']), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 2 }, velocity: { x: 0, y: 0, z: -7 } });
    let t = 0;
    for (let i = 0; i < 50 * 40; i++, t += 0.02) stepVessel(v, neutralInput(), env, t);
    expect(v.parts).toHaveLength(1);
    expect(v.situation).toBe('splashed');
    expect(Math.abs(v.velocity.z)).toBeLessThan(0.02);
    // Equilibrium: submerged fraction f = m / (rho_w V) with f = 0.5 + depth/size (equivalent-sphere model).
    const V = Math.PI * 0.25;
    const size = 2 * Math.cbrt((3 * V) / (4 * Math.PI));
    const depth = (100 / (1000 * V) - 0.5) * size;
    expect(v.position.z).toBeCloseTo(-depth, 2);
    // capsule fixture: 820 kg in 0.70 m^3 -> denser than water -> sinks
    const c = buildVessel(stackCraft(['capsule']), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 1 } });
    for (let i = 0; i < 50 * 20; i++) stepVessel(c, neutralInput(), env, i * 0.02);
    expect(c.position.z).toBeLessThan(-5);
  });
});
