import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildCricket, buildFizzwick, buildPackmule, buildSaltstreak, buildSkipjack, buildTrekker } from '../src/editor/stock/fun';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { neutralInput, type ControlInput } from '../src/sim/vessel';
import type { CraftDef } from '../src/sim/vessel/types';
import { qRotate } from '../src/util/quat';
import { cross, dot, length, normalize, v3 } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

const DEG = 180 / Math.PI;
const clamp = (x: number) => Math.max(-1, Math.min(1, x));

/** Earth flight from the craft's default site (pad or runway), with attitude readouts relative to local up. */
function fly(craft: CraftDef) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const wv = world.launch(craft);
  const ground = () => world.universe.surfaceInfo('earth', wv.state.position, world.ut).heightAboveTerrain;
  const up = () => normalize(world.relativeState(wv).position);
  const att = () => {
    const nose = qRotate(wv.state.orientation, v3(0, 1, 0)), right = qRotate(wv.state.orientation, v3(1, 0, 0));
    return { nose, right, pitch: Math.asin(dot(nose, up())) * DEG, bank: Math.asin(dot(right, up())) * DEG };
  };
  const tick = (input: Partial<ControlInput>, n = 1) => { for (let i = 0; i < n; i++) world.tick(0.02, neutralInput(input)); };
  return { world, wv, ground, up, att, tick, speed: () => length(world.surfaceVelocity(wv)) };
}

describe('fun stock craft do what their blurbs say', () => {
  it('Fizzwick climbs out of the atmosphere on its bundle and the capsule floats home', () => {
    const f = fly(buildFizzwick());
    f.tick({ stage: true, throttle: 1, sas: 'stabilityAssist' });
    let top = 0, burnout = NaN;
    for (let t = 0; t < 900 && (top < 1000 || f.ground() > top - 10); t += 0.02) {
      f.tick({ throttle: 1, sas: 'stabilityAssist' });
      top = Math.max(top, f.ground());
      if (Number.isNaN(burnout) && f.wv.state.telemetry.thrust === 0) burnout = f.ground();
      expect(f.wv.state.destroyed).toBe(false);
    }
    console.log(`Fizzwick burnout ${(burnout / 1000).toFixed(1)} km, apex ${(top / 1000).toFixed(1)} km`);
    expect(top).toBeGreaterThan(70000);
    // Separate the capsule, then the parachute stage; let it come down.
    f.tick({ stage: true }); f.tick({}, 50); f.tick({ stage: true });
    expect(f.wv.state.parts.some(p => p.partId === 'srb-sparkler')).toBe(false);
    for (let t = 0; t < 1500 && f.wv.state.situation === 'flying'; t += 0.1) f.tick({ sas: 'retrograde' }, 5);
    expect(f.wv.state.destroyed).toBe(false);
    expect(['landed', 'splashed']).toContain(f.wv.state.situation);
    expect(f.wv.state.parts.some(p => p.partId === 'pod-lantern-1')).toBe(true);
  }, 120000);

  it('Skipjack takes off within the runway and pulls a full loop', () => {
    const f = fly(buildSkipjack());
    const right0 = normalize(cross(f.att().nose, f.up()));
    f.tick({ stage: true });
    let liftoff = NaN, run = 0, wasLanded = false;
    for (let i = 0; i < 50 * 120 && f.ground() < 600; i++) {
      const a = f.att(), w = f.wv.state.angularVelocity, speed = f.speed(), onGround = f.wv.state.situation === 'landed';
      if (onGround) { run += speed * 0.02; wasLanded = true; } else if (wasLanded && Number.isNaN(liftoff)) liftoff = speed;
      f.tick({ throttle: 1, pitch: clamp(0.12 * ((speed > 55 ? 12 : 0) - a.pitch) - 1.5 * w.x), roll: clamp(0.08 * a.bank - w.y),
        yaw: onGround ? clamp(-4 * dot(a.nose, right0)) : 0, gear: f.ground() > 40 ? false : undefined });
      expect(f.wv.state.destroyed).toBe(false);
    }
    console.log(`Skipjack liftoff ${liftoff.toFixed(1)} m/s after ${run.toFixed(0)} m`);
    expect(f.ground()).toBeGreaterThan(600);
    expect(liftoff).toBeLessThan(80);
    expect(run).toBeLessThan(1200);
    // Level off at a sensible 150 m/s, then full throttle and full back stick: the nose passes vertical, goes over the
    // top and comes back round.
    for (let i = 0; i < 50 * 15; i++) {
      const a = f.att();
      f.tick({ throttle: Math.max(0, Math.min(1, 0.5 + 0.05 * (150 - f.speed()))), pitch: clamp(0.1 * (3 - a.pitch) - f.wv.state.angularVelocity.x), roll: clamp(0.08 * a.bank - f.wv.state.angularVelocity.y) });
    }
    const startAlt = f.ground(), startSpeed = f.speed(), forward0 = f.att().nose;
    let inverted = false, around = false;
    for (let i = 0; i < 50 * 30 && !around; i++) {
      const a = f.att();
      f.tick({ throttle: 1, pitch: 1, roll: clamp(-0.5 * f.wv.state.angularVelocity.y) });
      if (dot(a.nose, forward0) < -0.7 && a.pitch < 0) inverted = true; // heading back, nose down: over the top
      if (inverted && dot(a.nose, forward0) > 0.7) around = true;
      expect(f.wv.state.destroyed).toBe(false);
    }
    console.log(`loop entry ${startAlt.toFixed(0)} m at ${startSpeed.toFixed(0)} m/s, exit ${f.ground().toFixed(0)} m`);
    expect(startSpeed).toBeGreaterThan(140);
    expect(around).toBe(true);
    expect(f.ground()).toBeGreaterThan(100);
  }, 120000);

  it('Packmule takes off loaded and climbs away', () => {
    const f = fly(buildPackmule());
    const right0 = normalize(cross(f.att().nose, f.up()));
    f.tick({ stage: true });
    let liftoff = NaN, run = 0, wasLanded = false;
    for (let i = 0; i < 50 * 150 && f.ground() < 300; i++) {
      const a = f.att(), w = f.wv.state.angularVelocity, speed = f.speed(), onGround = f.wv.state.situation === 'landed';
      if (onGround) { run += speed * 0.02; wasLanded = true; } else if (wasLanded && Number.isNaN(liftoff) && f.ground() > 5) liftoff = speed;
      f.tick({ throttle: 1, pitch: clamp(0.12 * ((speed > 75 ? 10 : 0) - a.pitch) - 1.5 * w.x), roll: clamp(0.08 * a.bank - w.y),
        yaw: onGround ? clamp(-4 * dot(a.nose, right0)) : 0, gear: f.ground() > 40 ? false : undefined });
      expect(f.wv.state.destroyed).toBe(false);
    }
    console.log(`Packmule liftoff ${liftoff.toFixed(1)} m/s after ${run.toFixed(0)} m, pitch ${f.att().pitch.toFixed(1)}°`);
    expect(f.ground()).toBeGreaterThan(300);
    expect(run).toBeLessThan(2000);
    expect(f.wv.state.parts.length).toBe(buildPackmule().parts.length);
  }, 120000);

  it('Packmule opens its bay on 1, drops the rover, and the rover drives out from under it', () => {
    const f = fly(buildPackmule());
    f.tick({ brakes: true }, 100);
    const bay = f.wv.state.parts.find(p => p.partId === 'bay-cargo-2')!;
    f.tick({ brakes: true, commands: [{ kind: 'group', group: 'custom1' }] });
    f.tick({ brakes: true }, 100);
    expect(bay.bayOpen).toBe(true);
    // Stage 1 lights the jets (left idle); stage 0 releases the rover.
    f.tick({ brakes: true, stage: true }); f.tick({ brakes: true }, 10); f.tick({ brakes: true, stage: true });
    f.tick({ brakes: true }, 150);
    const rover = [...f.world.vessels.values()].find(v => v !== f.wv && v.state.parts.some(p => p.partId === 'probe-pebble'))!;
    expect(rover).toBeTruthy();
    expect(f.world.switchTo(rover.state.id)).toBe(true);
    for (let i = 0; i < 50 * 8; i++) f.world.tick(0.02, neutralInput({ wheelThrottle: 1 }));
    const gap = length(v3(...(['x', 'y', 'z'] as const).map(k => rover.state.position[k] - f.wv.state.position[k]) as [number, number, number]));
    const contact = rover.state.parts.filter(p => p.wheel?.inContact).length;
    console.log(`rover ${gap.toFixed(1)} m from the plane, ${contact} wheels down, ${rover.state.situation}`);
    expect(rover.state.destroyed).toBe(false);
    expect(contact).toBe(4);
    expect(gap).toBeGreaterThan(8);
  }, 60000);

  for (const [name, build, minSpeed] of [['Trekker', buildTrekker, 15]] as const) {
    it(`${name} drives off down the runway and turns, wheels on the ground`, () => {
      const f = fly(build());
      f.tick({ brakes: true }, 100);
      expect(f.wv.state.situation).toBe('landed');
      f.tick({ wheelThrottle: 1 }, 50 * 6);
      const speed = f.speed(), heading = normalize(f.world.surfaceVelocity(f.wv));
      // Ease off and steer: a sensible cornering speed, not full lock at top speed.
      let maxBank = 0;
      for (let i = 0; i < 50 * 8; i++) {
        f.tick({ wheelThrottle: f.speed() > 8 ? 0 : 0.5, brakes: f.speed() > 10, yaw: f.speed() < 10 ? 1 : 0 });
        maxBank = Math.max(maxBank, Math.abs(f.att().bank));
      }
      const turned = Math.acos(Math.max(-1, Math.min(1, dot(heading, normalize(f.world.surfaceVelocity(f.wv)))))) * DEG;
      console.log(`${name}: ${speed.toFixed(1)} m/s after 6 s, then turned ${turned.toFixed(0)}°, max bank ${maxBank.toFixed(1)}°`);
      expect(speed).toBeGreaterThan(minSpeed);
      expect(turned).toBeGreaterThan(20);
      expect(Math.abs(f.att().bank)).toBeLessThan(15);
      expect(f.wv.state.parts.filter(p => p.wheel?.inContact).length).toBeGreaterThanOrEqual(4);
      expect(f.wv.state.destroyed).toBe(false);
    });
  }

  it('Saltstreak sprints down the runway on its jet and brakes to a stop, upright', () => {
    const f = fly(buildSaltstreak());
    const right0 = normalize(cross(f.att().nose, f.up()));
    f.tick({ brakes: true }, 100);
    f.tick({ stage: true, throttle: 1, brakes: true });
    f.tick({ throttle: 1, brakes: true }, 100);
    let top = 0, run = 0, maxPitch = 0;
    const steer = () => clamp(-2 * dot(f.att().nose, right0) - 0.5 * f.wv.state.angularVelocity.z);
    for (let i = 0; i < 50 * 15; i++) {
      f.tick({ throttle: 1, wheelThrottle: 1, yaw: steer() });
      top = Math.max(top, f.speed()); run += f.speed() * 0.02; maxPitch = Math.max(maxPitch, Math.abs(f.att().pitch));
      expect(f.wv.state.destroyed).toBe(false);
    }
    for (let i = 0; i < 50 * 40 && f.speed() > 0.5; i++) {
      f.tick({ throttle: 0, brakes: true, yaw: steer() });
      run += f.speed() * 0.02; maxPitch = Math.max(maxPitch, Math.abs(f.att().pitch));
      expect(f.wv.state.destroyed).toBe(false);
    }
    console.log(`Saltstreak top ${top.toFixed(0)} m/s, stopped after ${run.toFixed(0)} m, max pitch ${maxPitch.toFixed(1)}°, bank ${f.att().bank.toFixed(1)}°`);
    expect(top).toBeGreaterThan(60);
    expect(f.speed()).toBeLessThan(0.5);
    expect(run).toBeLessThan(2400);
    expect(maxPitch).toBeLessThan(8);
    expect(Math.abs(f.att().bank)).toBeLessThan(5);
    expect(f.wv.state.parts.filter(p => p.wheel?.inContact).length).toBe(4);
  }, 60000);

  it('Cricket hovers, drifts sideways and lands back on its legs', () => {
    const f = fly(buildCricket());
    f.tick({ stage: true, throttle: 0 });
    const h0 = f.ground();
    const tilt = () => Math.acos(Math.min(1, dot(f.att().nose, f.up()))) * DEG;
    const fixed = () => f.world.universe.surfaceInfo('earth', f.wv.state.position, f.world.ut).fixedDir;
    /**
     * Hover pilot: throttle tracks a climb rate (towards `target` metres, or a gentle touchdown when `target` is null);
     * attitude keeps the nose `lean` radians from up.
     */
    const pilot = (target: number | null, seconds: number, lean = 0) => {
      for (let i = 0; i < seconds * 50; i++) {
        const up = f.up(), vUp = dot(f.world.surfaceVelocity(f.wv), up), h = f.ground() - h0;
        const wantUp = target === null ? -Math.max(1, Math.min(4, 0.3 * h)) : Math.max(-4, Math.min(4, 0.4 * (target - h)));
        const throttle = Math.max(0, Math.min(1, 0.45 + 0.25 * (wantUp - vUp)));
        const east = normalize(cross(v3(0, 0, 1), up));
        const want = normalize(v3(up.x + lean * east.x, up.y + lean * east.y, up.z + lean * east.z));
        const o = f.wv.state.orientation, axis = qRotate({ x: -o.x, y: -o.y, z: -o.z, w: o.w }, cross(f.att().nose, want));
        const w = f.wv.state.angularVelocity;
        f.tick({ throttle, pitch: clamp(3 * axis.x - w.x), yaw: clamp(w.z - 3 * axis.z), roll: clamp(-w.y) });
        expect(f.wv.state.destroyed).toBe(false);
      }
    };
    pilot(30, 15);
    expect(f.ground() - h0).toBeGreaterThan(25);
    expect(tilt()).toBeLessThan(3);
    const start = fixed();
    pilot(30, 3, 0.15);
    pilot(30, 4, -0.15);
    pilot(30, 6);
    const end = fixed();
    const moved = length(v3(end.x - start.x, end.y - start.y, end.z - start.z)) * f.world.universe.body('earth').radius;
    pilot(null, 40);
    f.tick({ throttle: 0 }, 150);
    console.log(`Cricket drifted ${moved.toFixed(1)} m, landed ${f.wv.state.situation}, tilt ${tilt().toFixed(1)}°`);
    expect(moved).toBeGreaterThan(5);
    expect(f.wv.state.situation).toBe('landed');
    expect(tilt()).toBeLessThan(10);
    expect(f.wv.state.parts.length).toBe(buildCricket().parts.length);
  }, 60000);
});
