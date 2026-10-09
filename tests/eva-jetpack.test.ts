import { describe, it, expect } from 'vitest';
import { EVA_PART } from '../src/data/eva';
import { buildVessel, neutralInput } from '../src/sim/vessel';
import { stepEva, EVA_HEIGHT, EVA_EXHAUST_SPEED, EVA_THRUST, EVA_RUN_SPEED, EVA_WALK_SPEED, EVA_JUMP_SPEED } from '../src/sim/vessel/eva';
import { flatEarthEnv, vacuumEnv, NOSE_UP } from '../src/sim/vessel/testing';
import type { Environment } from '../src/sim/vessel/env';
import type { ControlInput, VesselState } from '../src/sim/vessel/runtime';
import { qRotate, qNormalize, type Quat } from '../src/util/quat';
import { v3, cross, dot, length, normalize, sub, type Vec3 } from '../src/util/vec3';

const DT = 0.02;
const MOON_G = 1.62;

function astronaut(): VesselState {
  const v = buildVessel({ name: 'EVA', version: 1, type: 'VAB', parts: [{ uid: 1, partId: EVA_PART.id, position: v3(), rotation: { x: 0, y: 0, z: 0, w: 1 } }] }, new Map([[EVA_PART.id, EVA_PART]]));
  v.eva = { astronautId: 'test', walkPhase: 0, walking: false, jetting: false };
  return v;
}
/** Standing upright on the z = 0 plane of a flat world (+Z up). */
function standing(): VesselState {
  const v = astronaut();
  v.position = v3(0, 0, EVA_HEIGHT);
  v.orientation = NOSE_UP;
  v.situation = 'landed';
  return v;
}
/** Camera attitude looking along `forward` with `up` as its screen up (three.js camera: -Z forward, +Y up). */
function look(forward: Vec3, up: Vec3): Quat {
  const z = normalize(v3(-forward.x, -forward.y, -forward.z));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const t = x.x + y.y + z.z;
  let q: Quat;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = { w: s / 4, x: (y.z - z.y) / s, y: (z.x - x.z) / s, z: (x.y - y.x) / s }; }
  else if (x.x > y.y && x.x > z.z) { const s = Math.sqrt(1 + x.x - y.y - z.z) * 2; q = { w: (y.z - z.y) / s, x: s / 4, y: (y.x + x.y) / s, z: (z.x + x.z) / s }; }
  else if (y.y > z.z) { const s = Math.sqrt(1 + y.y - x.x - z.z) * 2; q = { w: (z.x - x.z) / s, x: (y.x + x.y) / s, y: s / 4, z: (z.y + y.z) / s }; }
  else { const s = Math.sqrt(1 + z.z - x.x - y.y) * 2; q = { w: (x.y - y.x) / s, x: (z.x + x.z) / s, y: (z.y + y.z) / s, z: s / 4 }; }
  return qNormalize(q);
}
const forwardOf = (q: Quat) => qRotate(q, v3(0, 0, -1));
const fuel = (v: VesselState) => v.parts[0].resources.monopropellant ?? 0;
function run(v: VesselState, env: Environment, seconds: number, input: Partial<ControlInput>, each?: (i: number) => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { stepEva(v, neutralInput(input), env, i * DT, DT); each?.(i); }
}
const moon = () => flatEarthEnv({ g: MOON_G, rho0: 0, p0: 0 });

describe('EVA jetpack', () => {
  it('stays off until switched on: translation in space neither thrusts nor uses gas', () => {
    const v = astronaut();
    run(v, vacuumEnv(), 1, { translateZ: -1, translateY: 1 });
    expect(length(v.velocity)).toBe(0);
    expect(fuel(v)).toBe(5);
    expect(v.eva!.jetting).toBe(false);
  });

  it('thrusts along the camera frame in space and turns the astronaut to face the view', () => {
    const v = astronaut();
    const heading = look(v3(1, 0, 0), v3(0, 1, 0));
    const m0 = v.mass;
    run(v, vacuumEnv(), 1, { rcs: true, translateZ: -1, evaHeading: heading });
    const dv = EVA_EXHAUST_SPEED * Math.log(m0 / v.mass);
    expect(dv).toBeCloseTo(EVA_THRUST / m0, 1);
    expect(v.velocity.x).toBeCloseTo(dv, 9);
    expect(Math.hypot(v.velocity.y, v.velocity.z)).toBeLessThan(1e-9);
    expect(fuel(v)).toBeCloseTo(5 - EVA_THRUST / EVA_EXHAUST_SPEED, 6);
    expect(v.eva!.jetting).toBe(true);
    expect(v.telemetry.thrust).toBeCloseTo(EVA_THRUST, 6);
    expect(dot(forwardOf(v.orientation), v3(1, 0, 0))).toBeGreaterThan(0.99);
    // Up/down keys translate along the camera's up; diagonal input is not faster than a single axis.
    const w = astronaut();
    run(w, vacuumEnv(), 1, { rcs: true, translateY: 1, translateX: 1, evaHeading: heading });
    expect(length(w.velocity)).toBeCloseTo(dv, 6);
    expect(w.velocity.y).toBeCloseTo(w.velocity.z, 9);
  });

  it('carries about 113 m/s of delta-v and stops exactly when the gas runs out', () => {
    const v = astronaut();
    run(v, vacuumEnv(), 40, { rcs: true, translateX: 1 });
    expect(fuel(v)).toBe(0);
    expect(length(v.velocity)).toBeCloseTo(EVA_EXHAUST_SPEED * Math.log(100 / 95), 6);
    expect(length(v.velocity)).toBeGreaterThan(110);
    const before = { ...v.velocity };
    run(v, vacuumEnv(), 1, { rcs: true, translateX: 1 });
    expect(v.velocity).toEqual(before);
    expect(v.eva!.jetting).toBe(false);
  });

  it('lifts off and flies under lunar gravity, then lands again', () => {
    const v = standing();
    const env = moon();
    expect(EVA_THRUST / v.mass).toBeGreaterThan(MOON_G * 1.5);
    run(v, env, 3, { rcs: true, translateY: 1, evaRun: true });
    expect(v.situation).toBe('flying');
    // Net ≈ 3.0 − 1.62 m/s² for three seconds: about 6 m up and still climbing.
    expect(v.position.z - EVA_HEIGHT).toBeGreaterThan(5);
    expect(v.velocity.z).toBeGreaterThan(3.5);
    expect(fuel(v)).toBeLessThan(5);
    let landedAt = -1;
    run(v, env, 30, { rcs: true }, i => { if (landedAt < 0 && v.situation === 'landed') landedAt = i; });
    expect(landedAt).toBeGreaterThan(0);
    expect(v.destroyed).toBe(false);
    expect(v.position.z).toBeCloseTo(EVA_HEIGHT, 6);
  });

  it('cannot lift off under Earth gravity: Shift runs instead and no gas is spent', () => {
    const v = standing();
    run(v, flatEarthEnv(), 2, { rcs: true, translateY: 1, translateZ: -1, evaRun: true, evaHeading: look(v3(1, 0, 0), v3(0, 0, 1)) });
    expect(v.situation).toBe('landed');
    expect(fuel(v)).toBe(5);
    expect(v.velocity.x).toBeCloseTo(EVA_RUN_SPEED, 6);
  });

  it('runs with Shift when the jetpack is off, even where it could fly', () => {
    const v = standing();
    run(v, moon(), 1, { translateY: 1, translateZ: -1, evaRun: true, evaHeading: look(v3(0, 1, 0), v3(0, 0, 1)) });
    expect(v.situation).toBe('landed');
    expect(v.velocity.y).toBeCloseTo(EVA_RUN_SPEED, 6);
    expect(fuel(v)).toBe(5);
  });

  it('keeps surface flight level: forward thrust is horizontal even with the camera pitched down', () => {
    const v = standing();
    v.position = v3(0, 0, 20);
    v.situation = 'flying';
    const pitchedDown = look(normalize(v3(1, 0, -1)), v3(0, 0, 1));
    run(v, moon(), 0.5, { rcs: true, translateZ: -1, evaHeading: pitchedDown });
    expect(v.velocity.x).toBeGreaterThan(0.5 * EVA_THRUST / v.mass * 0.99);
    expect(Math.abs(v.velocity.y)).toBeLessThan(1e-9);
    expect(v.velocity.z).toBeCloseTo(-MOON_G * 0.5, 9);
    // The astronaut stays upright while facing the flight direction.
    expect(dot(qRotate(v.orientation, v3(0, 1, 0)), v3(0, 0, 1))).toBeGreaterThan(0.999);
  });
});

describe('EVA on foot', () => {
  it('walks at full speed whatever the camera pitch and turns to face the walking direction', () => {
    const v = standing();
    const pitchedDown = look(normalize(v3(0, 1, -2)), v3(0, 0, 1));
    run(v, moon(), 1, { translateX: 1, evaHeading: pitchedDown });
    // D (right) with the camera looking along +Y, +Z up, walks along +X.
    expect(v.velocity.x).toBeCloseTo(EVA_WALK_SPEED, 6);
    expect(v.eva!.walking).toBe(true);
    expect(dot(forwardOf(v.orientation), v3(1, 0, 0))).toBeGreaterThan(0.99);
  });

  it('does not spin to follow the camera while standing still', () => {
    const v = standing();
    const before = forwardOf(v.orientation);
    run(v, moon(), 2, { evaHeading: look(v3(1, 0, 0), v3(0, 0, 1)) });
    expect(dot(forwardOf(v.orientation), before)).toBeGreaterThan(0.9999);
    expect(v.eva!.walking).toBe(false);
  });

  it('jumps only with feet on the ground', () => {
    const v = standing();
    run(v, moon(), DT, { evaJump: true });
    expect(v.situation).toBe('flying');
    expect(v.velocity.z).toBeCloseTo(EVA_JUMP_SPEED - MOON_G * DT, 9);
    const vz = v.velocity.z;
    run(v, moon(), DT, { evaJump: true });
    expect(v.velocity.z).toBeCloseTo(vz - MOON_G * DT, 9);
    let air = 0;
    run(v, moon(), 5, {}, () => { if (v.situation === 'flying') air++; });
    expect(v.situation).toBe('landed');
    // Ballistic flight time 2v/g ≈ 3.1 s.
    expect(air * DT).toBeGreaterThan(2.9);
    expect(air * DT).toBeLessThan(3.2);
  });

  it('keeps its feet on the ground running over a crest and down the far slope', () => {
    // Ridge along y: height = −0.35·|x| (about 19° slopes), crest at x = 0.
    const k = 0.35;
    const base = moon();
    const env: Environment = { ...base, ground: (p) => {
      const s = Math.sign(p.x) || 1;
      return { surfacePoint: v3(p.x, p.y, -k * Math.abs(p.x)), normal: normalize(v3(k * s, 0, 1)), surfaceVelocity: v3(), isWater: false };
    } };
    const v = standing();
    v.position = v3(-3, 0, -k * 3 + EVA_HEIGHT / Math.cos(Math.atan(k)));
    run(v, env, DT, {});
    let airborne = 0;
    run(v, env, 2.5, { translateZ: -1, evaRun: true, evaHeading: look(v3(1, 0, 0), v3(0, 0, 1)) }, () => { if (v.situation !== 'landed') airborne++; });
    expect(v.position.x).toBeGreaterThan(4);
    expect(airborne).toBe(0);
    const g = env.ground(v.position, 0)!;
    expect(dot(sub(v.position, g.surfacePoint), g.normal)).toBeCloseTo(EVA_HEIGHT, 3);
  });
});
