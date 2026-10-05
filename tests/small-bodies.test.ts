import * as THREE from 'three';
import { CometEffects } from '../src/render/planet/CometEffects';
import { predictTrajectory } from '../src/sim/orbit/patched';
import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { buildUniverse, SCALE_PRESETS } from '../src/sim/bodies/scale';
import { SMALL_BODY_DEFS } from '../src/data/smallBodies';
import { BODY_DEFS } from '../src/data/bodies';
import { generateAsteroidField } from '../src/sim/bodies/asteroidField';
import { biomeAt } from '../src/sim/science/biomes';
import { cometActivity } from '../src/sim/orbit/comet';
import { dot, length, sub, v3, add } from '../src/util/vec3';
import { setupSmallBodyApproach } from '../src/scenarios/smallBodies';
import { neutralInput } from '../src/sim/vessel';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { EVA_PART } from '../src/data/eva';
import { EVA_EXHAUST_SPEED, EVA_THRUST } from '../src/sim/vessel/eva';
import { PART_CATALOG } from '../src/data/parts';
import { instruments } from '../src/game/science';

describe('small bodies', () => {
  it('has real periods, positive GM and a Surface biome', () => {
    const u = new Universe('real');
    for (const [id, years, tolerance] of [['vesta', 3.63, .02], ['halley', 75.3, 1], ['bennu', 1.2, .02]] as const)
      expect(Math.abs(u.body(id).orbitalPeriod! / (365.25 * 86400) - years)).toBeLessThan(tolerance);
    for (const d of SMALL_BODY_DEFS) {
      const b = u.body(d.id);
      expect(b.gm).toBeGreaterThan(0);
      expect(b.soi).toBeGreaterThanOrEqual(2 * b.radius);
      expect(biomeAt(b, u.terrain(b.id), v3(1, 0, 0))).toBe('Surface');
    }
  });
  it('preserves energy and repeats Halley across perihelion over centuries', () => {
    const u = new Universe('real'), b = u.body('halley');
    const mu = u.body('sun').gm + b.gm;
    for (let k = -100; k <= 100; k++) {
      const t = b.orbit!.epoch + k * b.orbitalPeriod! / 10;
      const state = u.ephem.getBodyState(b.id, t);
      const energy = dot(state.velocity, state.velocity) / 2 - mu / length(state.position);
      expect(energy / (-mu / (2 * b.orbit!.a))).toBeCloseTo(1, 9);
      const next = u.ephem.getBodyState(b.id, t + b.orbitalPeriod!);
      expect(length(sub(next.position, state.position)) / b.orbit!.a).toBeLessThan(1e-10);
    }
  });
  it('clamps a sub-surface Laplace SOI and preserves shape under scaling', () => {
    const def = { ...SMALL_BODY_DEFS.find(b => b.id === 'bennu')!, gm: 1e-15 };
    const b = buildUniverse([BODY_DEFS.find(b => b.id === 'sun')!, def], SCALE_PRESETS.standard).get('bennu')!;
    expect(b.soi).toBe(b.radius * 2);
    const real = new Universe('real'), standard = new Universe('standard');
    for (const d of SMALL_BODY_DEFS) for (let i = 0; i < 60; i++) {
      const z = 1 - (i + .5) / 30, a = i * 2.399963, r = Math.sqrt(1 - z * z);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const tr = real.terrain(d.id), ts = standard.terrain(d.id), h = ts.heightAt(x, y, z);
      expect(h).toBeGreaterThanOrEqual(ts.minHeight); expect(h).toBeLessThanOrEqual(ts.maxHeight);
      expect(h / .1).toBeCloseTo(tr.heightAt(x, y, z), 6);
    }
  });
  it('keeps comet tails anti-sunward and fades activity at aphelion', () => {
    const sun = v3(3, -8, 11), p = v3(10, 20, 30);
    const c = cometActivity(p, sun, 100);
    expect(dot(c.direction, sub(p, sun))).toBeCloseTo(length(sub(p, sun)), 12);
    expect(cometActivity(v3(600, 0, 0), v3(), 100).brightness).toBe(0);
    expect(c.jets).toBeGreaterThan(0);
  });
  it('renders both tails anti-sunward in flight and map coordinates', () => {
    const fx = new CometEffects();
    for (const map of [false, true]) {
      fx.update(v3(100, 20, 30), v3(), v3(95, 20, 30), 1, 100, 0, map);
      expect(fx.root.position.x).toBe(5);
      for (const tail of fx.root.children.slice(1, 3)) {
        const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(tail.quaternion);
        expect(direction.dot(new THREE.Vector3(100, 20, 30).normalize())).toBeCloseTo(1, 12);
      }
    }
    fx.dispose();
  });
  it('patches low-speed escape from a tiny GM without NaNs', () => {
    const u = new Universe('standard'), b = u.body('bennu');
    const patches = predictTrajectory({ ephem: u.ephem, bodies: u.bodies, initialBody: b.id,
      state: { position: v3(b.soi * .95, 0, 0), velocity: v3(.1, .01, 0) }, t0: 0, horizon: 10000, maxPatches: 2 });
    expect(patches[0].endReason).toBe('soiExit');
    expect(patches[0].nextBody).toBe('sun');
    expect(patches[1].orbit.body).toBe('sun');
    expect(patches.every(p => Number.isFinite(p.endTime))).toBe(true);
  });
  it('lazily activates deterministic field objects and restores them from saves', () => {
    expect(generateAsteroidField()).toEqual(generateAsteroidField());
    expect(generateAsteroidField()).toHaveLength(208);
    const { world } = setupSmallBodyApproach();
    const u = world.universe, id = u.asteroidField[0].id;
    expect(u.bodies.has(id)).toBe(false);
    expect(world.setTarget(id)).toBe(true);
    expect(u.bodies.has(id)).toBe(true);
    expect(u.ephem.getBodyState(id, 0).position.x).toBeCloseTo(u.asteroidState(id, 0).position.x, 2);
    const id2 = u.asteroidField[1].id, p = u.asteroidState(id2, 0).position;
    u.dominantBody(add(p, v3(999999, 0, 0)), 0);
    expect(u.bodies.has(id2)).toBe(true);
    const restored = deserializeWorld(serializeWorld(world), PART_CATALOG);
    expect(restored.universe.bodies.has(id)).toBe(true);
    expect(restored.targetId).toBe(id);
  });
  it('lands Pebblecatcher on standard Bennu without bouncing to escape', () => {
    const { world, vessel } = setupSmallBodyApproach();
    const u = world.universe, b = u.body('bennu');
    const escape = Math.sqrt(2 * b.gm / b.radius);
    expect(escape).toBeLessThan(.1);
    let landed = 0, maxSpeed = 0;
    for (let i = 0; i < 30000; i++) {
      world.tick(.02, neutralInput());
      if (i > 25000) {
        if (vessel.state.situation === 'landed') landed++;
        const rel = sub(vessel.state.position, u.ephem.getBodyState('bennu', world.ut).position);
        const groundVelocity = add(u.ephem.getBodyState('bennu', world.ut).velocity, u.ephem.surfaceVelocity('bennu', rel, world.ut));
        maxSpeed = Math.max(maxSpeed, length(sub(vessel.state.velocity, groundVelocity)));
      }
    }
    expect(vessel.state.destroyed).toBe(false);
    expect(landed).toBeGreaterThan(4500);
    expect(maxSpeed).toBeLessThan(escape * .1);
    const sample = instruments(world, vessel).find(x => x.experiment === 'surfaceSample');
    expect(sample?.available).toBe(true);
    expect(world.runExperiment(sample!.uid, 'surfaceSample')).toBeTruthy();
    expect(EVA_EXHAUST_SPEED * Math.log((EVA_PART.dryMass + 5) / EVA_PART.dryMass)).toBeGreaterThan(escape * 100);
    expect(EVA_THRUST / (EVA_PART.dryMass + 5)).toBeGreaterThan(b.surfaceGravity);
  }, 60000);
});
