import { requireIntactFlight } from './helpers/structural';
import { stableOrbit } from '../src/tutorial/lessons';
import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { flyToOrbit } from './helpers/ascent';

describe('stock orbiter reaches orbit', () => {
  it('gravity turn to a ~85 km orbit', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    requireIntactFlight(world);
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
