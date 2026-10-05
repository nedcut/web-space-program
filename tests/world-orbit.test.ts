import { stableOrbit } from '../src/tutorial/lessons';
import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { add, cross, length, normalize, scale } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { DEFAULT_START_UT } from '../src/game/store';

/** Simple gravity-turn autopilot driving SAS 'maneuver' mode with a computed direction. */
export function flyToOrbit(world: World, targetAp: number, log: string[]) {
  const wv = world.active!;
  const earth = world.universe.body('earth');
  const atmo = earth.atmosphere!.height;
  let phase: 'ascent' | 'coast' | 'circ' | 'done' = 'ascent';
  let stageCooldown = 0;
  let starved = 0;
  world.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist', stage: true }));
  for (let i = 0; i < 50 * 900 && phase !== 'done'; i++) {
    const rs = world.relativeState(wv);
    const up = normalize(rs.position);
    const pole = qRotate(world.universe.ephem.bodyRotation('earth', world.ut), { x: 0, y: 0, z: 1 });
    const east = normalize(cross(pole, up));
    const alt = length(rs.position) - earth.radius;
    const orb = world.orbitSummary(wv);
    let throttle = 1;
    let dir = up;
    if (phase === 'ascent') {
      const f = Math.min(1, Math.max(0, (alt - 500) / (atmo * 0.85)));
      const pitch = (Math.PI / 2) * Math.pow(f, 0.55); // from vertical toward east
      dir = normalize(add(scale(up, Math.cos(pitch)), scale(east, Math.sin(pitch))));
      if (orb.ap > targetAp) phase = 'coast';
    }
    if (phase === 'coast') {
      throttle = 0;
      dir = normalize(rs.velocity);
      if (alt > atmo && orb.timeToAp < 25) phase = 'circ';
    }
    if (phase === 'circ') {
      dir = normalize(rs.velocity);
      throttle = 1;
      if (orb.pe > atmo + 2000) phase = 'done';
    }
    // Stage when no thrust while throttle commanded.
    let stage = false;
    stageCooldown -= 0.02;
    starved = throttle > 0 && wv.state.telemetry.thrust < 1 ? starved + 0.02 : 0;
    if (starved > 0.6 && stageCooldown <= 0 && wv.state.nextStage >= 0) {
      stage = true;
      stageCooldown = 1;
    }
    world.tick(0.02, neutralInput({ throttle, sas: 'maneuver', maneuverDirection: dir, stage }));
    if (i % 1500 === 0) log.push(`t=${(i / 50).toFixed(0)} ${phase} alt=${(alt / 1000).toFixed(1)}km ap=${(orb.ap / 1000).toFixed(1)} pe=${(orb.pe / 1000).toFixed(1)} v=${length(rs.velocity).toFixed(0)} q=${(wv.state.telemetry.dynamicPressure / 1000).toFixed(1)}kPa m=${wv.state.mass.toFixed(0)} stg=${wv.state.nextStage}`);
    if (wv.state.destroyed || !world.vessels.has(wv.state.id)) { log.push('DESTROYED'); break; }
  }
  return phase;
}

describe('stock orbiter reaches orbit', () => {
  it('gravity turn to a ~85 km orbit', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter());
    const log: string[] = [];
    const phase = flyToOrbit(world, 85000, log);
    const wv = world.active!;
    const orb = world.orbitSummary(wv);
    log.push(`final phase=${phase} ap=${(orb.ap / 1000).toFixed(1)} pe=${(orb.pe / 1000).toFixed(1)} fuel-stage=${wv.state.nextStage}`);
    console.log(log.join('\n'));
    expect(phase).toBe('done');
    world.recordFlight(wv, world.ut, true);
    const record = world.flightlog.records.find(r => r.vesselId === wv.state.id)!;
    expect(record.events.map(e => e.kind)).toEqual(expect.arrayContaining(['launch', 'stage', 'orbit']));
    expect(record.stats.dvSpent).toBeGreaterThan(1000);
    expect(record.samples.length).toBeLessThanOrEqual(1024);
    expect(world.achievementProfile.unlocked.orbit).toBeDefined();
    expect(stableOrbit({ world })).toBe(true);
    expect(orb.pe).toBeGreaterThan(world.universe.body('earth').atmosphere!.height);
  }, 120000);
});
