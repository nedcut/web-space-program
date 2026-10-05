import { requireIntactFlight } from './helpers/structural';
import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildMoonRover, buildRoverLander, buildSSTO } from '../src/editor/stockCrafts';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { DEFAULT_START_UT } from '../src/game/store';
import { neutralInput, activateStage, bodyToWorld, wheelContactPoint } from '../src/sim/vessel';
import { qFromTo, qRotate } from '../src/util/quat';
import { add, dot, length, normalize, scale, v3 } from '../src/util/vec3';

describe('showcase fleet operations', () => {
  it('Moonmoth settles on its powered wheels and drives on lunar terrain', () => {
    const universe = new Universe('standard');
    const world = new World(universe, PART_CATALOG, DEFAULT_START_UT);
    requireIntactFlight(world);
    const moon = universe.body('moon');
    const up = normalize(v3(1, 0, 0));
    const position = add(universe.ephem.getBodyState('moon', world.ut).position, scale(up, moon.radius));
    const env = universe.createEnvironment(() => 'moon');
    const ground = env.ground(position, world.ut)!;
    const wv = world.spawnVessel(buildMoonRover(), {
      position: ground.surfacePoint, velocity: ground.surfaceVelocity,
      orientation: qFromTo(v3(0, 0, 1), ground.normal),
    });
    let minimum = Infinity;
    for (const p of wv.state.parts) if (p.wheel) {
      const c = wheelContactPoint(wv.state, p);
      minimum = Math.min(minimum, dot(add(bodyToWorld(wv.state, c.center), scale(ground.surfacePoint, -1)), ground.normal) - c.module.radius);
    }
    wv.state.position = add(wv.state.position, scale(ground.normal, 0.02 - minimum));
    world.switchTo(wv.state.id);
    for (let i = 0; i < 150; i++) world.tick(0.02, neutralInput({ brakes: true }));
    expect(wv.state.situation).toBe('landed');
    const start = universe.surfaceInfo('moon', wv.state.position, world.ut).fixedDir;
    for (let i = 0; i < 250; i++) world.tick(0.02, neutralInput({ wheelThrottle: 1 }));
    const end = universe.surfaceInfo('moon', wv.state.position, world.ut).fixedDir;
    expect(length(add(end, scale(start, -1))) * moon.radius).toBeGreaterThan(1);
    expect(length(world.surfaceVelocity(wv))).toBeGreaterThan(0.3);
    expect(wv.state.destroyed).toBe(false);
    expect(wv.state.parts.filter(p => p.wheel?.inContact).length).toBeGreaterThan(0);
  });

  it('delivery staging retains a controllable rover and separates a controllable lander', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    requireIntactFlight(world);
    const wv = world.launch(buildRoverLander());
    activateStage(wv.state, 2);
    const split = activateStage(wv.state, 1);
    expect(wv.state.parts.filter(p => p.wheel).length).toBe(4);
    expect(split).toHaveLength(1);
    expect(split[0].parts.some(p => p.def.modules.some(m => m.type === 'command'))).toBe(true);
    expect(wv.state.parts.some(p => p.def.modules.some(m => m.type === 'command'))).toBe(true);
  });

  it('Daybreak takes off from the runway on jets with its rocket still dormant', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    requireIntactFlight(world);
    const wv = world.launch(buildSSTO(), 'runway');
    const alt0 = world.universe.surfaceInfo('earth', wv.state.position, world.ut).heightAboveTerrain;
    world.tick(0.02, neutralInput({ stage: true }));
    let maximumAltitude = 0;
    for (let i = 0; i < 7500 && maximumAltitude < 150; i++) {
      const up = normalize(world.relativeState(wv).position);
      const nose = qRotate(wv.state.orientation, v3(0, 1, 0));
      const right = qRotate(wv.state.orientation, v3(1, 0, 0));
      const speed = length(world.surfaceVelocity(wv));
      const pitch = Math.asin(dot(nose, up)) * 180 / Math.PI;
      const bank = Math.asin(dot(right, up)) * 180 / Math.PI;
      world.tick(0.02, neutralInput({ throttle: 1,
        pitch: Math.max(-1, Math.min(1, 0.12 * ((speed > 80 ? 10 : 0) - pitch) - 1.5 * wv.state.angularVelocity.x)),
        roll: Math.max(-1, Math.min(1, 0.08 * bank - wv.state.angularVelocity.y)),
      }));
      maximumAltitude = world.universe.surfaceInfo('earth', wv.state.position, world.ut).heightAboveTerrain - alt0;
      expect(wv.state.destroyed).toBe(false);
      expect(wv.state.parts.find(p => p.partId === 'eng-needle')!.engine!.ignited).toBe(false);
    }
    expect(maximumAltitude).toBeGreaterThan(150);
    expect(wv.state.situation).toBe('flying');
  }, 120000);
});
