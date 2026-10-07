import { requireIntactFlight } from './helpers/structural';
import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildSwift } from '../src/editor/stockCrafts';
import { neutralInput, type ControlInput } from '../src/sim/vessel';
import { cross, dot, length, normalize, v3 } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { DEFAULT_START_UT } from '../src/game/store';

const DEG = 180 / Math.PI;

function setup() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const wv = world.launch(buildSwift());
  const earth = world.universe.body('earth');
  const up = () => normalize(world.relativeState(wv).position);
  const alt = () => length(world.relativeState(wv).position) - earth.radius;
  const att = () => {
    const q = wv.state.orientation;
    const u = up();
    const nose = qRotate(q, v3(0, 1, 0));
    const right = qRotate(q, v3(1, 0, 0));
    return { pitch: Math.asin(dot(nose, u)) * DEG, bank: Math.asin(dot(right, u)) * DEG, nose };
  };
  return { world, wv, up, alt, att };
}

describe('runway & aircraft', () => {
  it('SPH crafts spawn level on their wheels at the runway threshold and sit still', () => {
    const { world, wv, alt, att } = setup();
    expect(wv.mode).toBe('physics');
    const a0 = att();
    // Spawned at the static rest pose on compressed gear: within ~1° of level, and it does not move from there.
    expect(Math.abs(a0.pitch)).toBeLessThan(2);
    expect(Math.abs(a0.bank)).toBeLessThan(0.5);
    const alt0 = alt();
    for (let i = 0; i < 150; i++) world.tick(0.02, neutralInput({ brakes: true }));
    expect(Math.abs(att().pitch - a0.pitch)).toBeLessThan(0.5);
    expect(Math.abs(alt() - alt0)).toBeLessThan(0.01);
    expect(wv.state.situation).toBe('landed');
    expect(length(world.surfaceVelocity(wv))).toBeLessThan(0.05);
    expect(Math.abs(alt() - alt0)).toBeLessThan(0.3);
    for (const p of wv.state.parts) if (p.wheel) expect(p.wheel.inContact).toBe(true);
    // Fuselage clear of the runway: only the wheels touch.
    expect(wv.state.telemetry.altitudeAGL).toBeGreaterThan(1);
    expect(wv.state.destroyed).toBe(false);
  });

  it('Swift takes off at full throttle, rotates and climbs to 1 km', () => {
    const { world, wv, alt, att, up } = setup();
    const alt0 = alt();
    const right0 = normalize(cross(att().nose, up()));
    world.tick(0.02, neutralInput({ stage: true }));
    const log: string[] = [];
    let liftoffSpeed = NaN, liftoffDist = NaN, t = 0;
    let groundRun = 0; // distance rolled along the runway (surface-relative)
    let gearUp = false, wasLanded = false;
    for (let i = 0; i < 50 * 150 && alt() - alt0 < 1000; i++, t += 0.02) {
      const a = att();
      const w = wv.state.angularVelocity;
      const speed = length(world.surfaceVelocity(wv));
      const onGround = wv.state.situation === 'landed';
      if (onGround) groundRun += speed * 0.02;
      if (onGround) wasLanded = true;
      if (!onGround && wasLanded && Number.isNaN(liftoffSpeed)) {
        liftoffSpeed = speed;
        liftoffDist = groundRun;
      }
      // Simple pilot: hold the runway heading on the ground, rotate at 65 m/s to 10 deg pitch, wings level.
      const targetPitch = speed > 65 ? 10 : 0;
      const pitch = Math.max(-1, Math.min(1, 0.12 * (targetPitch - a.pitch) - 1.5 * w.x));
      const roll = Math.max(-1, Math.min(1, 0.08 * a.bank - 1.0 * w.y));
      const yaw = onGround ? Math.max(-1, Math.min(1, -4 * dot(a.nose, right0))) : 0;
      const input: Partial<ControlInput> = { throttle: 1, pitch, roll, yaw };
      if (!gearUp && alt() - alt0 > 60) { input.gear = false; gearUp = true; }
      world.tick(0.02, neutralInput(input));
      if (i % 250 === 0) log.push(`t=${t.toFixed(0)} alt=${(alt() - alt0).toFixed(0)} v=${speed.toFixed(1)} pitch=${a.pitch.toFixed(1)} bank=${a.bank.toFixed(1)} thrust=${wv.state.telemetry.thrust.toFixed(0)} sit=${wv.state.situation}`);
      expect(wv.state.destroyed).toBe(false);
    }
    console.log(log.join('\n'), `\nliftoff ${liftoffSpeed.toFixed(1)} m/s after ${liftoffDist.toFixed(0)} m`);
    expect(alt() - alt0).toBeGreaterThan(1000);
    expect(liftoffSpeed).toBeGreaterThan(50);
    expect(liftoffSpeed).toBeLessThan(95);
    // Lifted off well within the 2.5 km runway.
    expect(liftoffDist).toBeLessThan(1500);
    expect(Math.abs(att().bank)).toBeLessThan(10);
    expect(wv.state.parts.length).toBe(buildSwift().parts.length);
  }, 120000);
});
