import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildHazewalker } from '../src/editor/stockCrafts';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { DEFAULT_START_UT } from '../src/game/store';
import { sampleAtmosphere } from '../src/sim/atmosphere';
import { neutralInput } from '../src/sim/vessel';
import { peakTemperature, suttonGravesK, SUTTON_GRAVES_K_EARTH } from '../src/sim/vessel/heating';
import { qFromTo } from '../src/util/quat';
import { add, length, normalize, scale, v3 } from '../src/util/vec3';

describe('Hazewalker Titan expedition', () => {
  it('preserves dense nitrogen air and low surface gravity across scale presets', () => {
    for (const preset of ['standard', 'challenging', 'real'] as const) {
      const titan = new Universe(preset).body('titan');
      const air = sampleAtmosphere(titan.atmosphere, 0, titan.surfaceGravity);
      expect(air.density).toBeCloseTo(5.26, 1);
      expect(titan.surfaceGravity).toBeCloseTo(1.354, 2);
      expect(suttonGravesK(air) / SUTTON_GRAVES_K_EARTH).toBeCloseTo(0.99, 2);
      const higher = sampleAtmosphere(titan.atmosphere, 20000 * titan.atmosphere!.verticalScale!, titan.surfaceGravity);
      expect(higher.density).toBeLessThan(air.density);
      expect(higher.density).toBeGreaterThan(0);
    }
  });

  it('aerobrakes shield-first, deploys heavy chutes and lands below 5 m/s without thrust', () => {
    const universe = new Universe('standard');
    const world = new World(universe, PART_CATALOG, DEFAULT_START_UT);
    const titan = universe.body('titan');
    // Body-fixed northward entry avoids a long full transfer while retaining real World air/contact.
    const up = normalize(v3(0.7, 0.2, 0.68));
    const rel = scale(up, titan.radius + 60000);
    const body = universe.ephem.getBodyState('titan', world.ut);
    const env = universe.createEnvironment(() => 'titan');
    const position = add(body.position, rel);
    const vessel = world.spawnVessel(buildHazewalker(), {
      position,
      velocity: add(env.air(position, world.ut).windVelocity, scale(up, -1200)),
      orientation: qFromTo(v3(0, 1, 0), up),
    });
    world.switchTo(vessel.state.id);
    expect(vessel.body).toBe('titan');
    const originalCount = vessel.state.parts.length;
    let armed = false, full = false, semi = false, peakQ = 0, hottestShield = 0;
    let touchdownSpeed = Infinity, previousSpeed = 1200, minimumPreChuteSpeed = 1200;
    for (let i = 0; i < 16000 && vessel.state.situation !== 'landed'; i++) {
      const altitude = universe.surfaceInfo('titan', vessel.state.position, world.ut).heightAboveTerrain;
      const speed = length(world.surfaceVelocity(vessel));
      // First stage ignites descent thrusters at zero throttle, second arms chutes once safe.
      const stage = !armed && altitude < 12000 && vessel.state.telemetry.dynamicPressure < 20000;
      if (stage) armed = true;
      if (!armed) minimumPreChuteSpeed = Math.min(minimumPreChuteSpeed, speed);
      world.tick(0.25, neutralInput({ stage, gear: true, sas: 'retrograde', sasReference: 'surface' }));
      // Arm the chute stage after the dormant propulsion stage.
      if (stage) world.tick(0.02, neutralInput({ stage: true, gear: true, sas: 'retrograde', sasReference: 'surface' }));
      peakQ = Math.max(peakQ, vessel.state.telemetry.dynamicPressure);
      for (const p of vessel.state.parts) {
        if (p.chute?.phase === 'semi') semi = true;
        if (p.chute?.phase === 'full') full = true;
        expect(p.chute?.phase).not.toBe('cut');
        if (p.partId === 'shield-2') hottestShield = Math.max(hottestShield, peakTemperature(p));
      }
      if (String(vessel.state.situation) === 'landed') touchdownSpeed = previousSpeed;
      previousSpeed = length(world.surfaceVelocity(vessel));
      expect(vessel.state.destroyed).toBe(false);
      expect(vessel.state.parts.length).toBe(originalCount);
      expect(vessel.state.telemetry.thrust).toBe(0);
    }
    expect(minimumPreChuteSpeed).toBeLessThan(100);
    expect(peakQ).toBeGreaterThan(1000);
    expect(hottestShield).toBeGreaterThan(293);
    expect(hottestShield).toBeLessThan(PART_CATALOG.get('shield-2')!.maxTemp);
    expect(armed && semi && full).toBe(true);
    expect(vessel.state.situation).toBe('landed');
    expect(touchdownSpeed).toBeLessThan(5);
    expect(length(world.surfaceVelocity(vessel))).toBeLessThan(5);
  }, 120000);
});
