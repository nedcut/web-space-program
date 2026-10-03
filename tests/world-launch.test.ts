import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { length, sub } from '../src/util/vec3';
import { DEFAULT_START_UT } from '../src/game/store';

describe('world launch integration', () => {
  it('sits on the pad, then lifts off and climbs', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const wv = world.launch(buildOrbiter());
    const earth = world.universe.body('earth');
    const alt = () => length(world.relativeState(wv).position) - earth.radius;
    const alt0 = alt();
    // 2 s on the pad, throttle up but not staged: stays put.
    for (let i = 0; i < 100; i++) world.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
    expect(Math.abs(alt() - alt0)).toBeLessThan(0.5);
    world.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist', stage: true }));
    const log: string[] = [];
    for (let i = 0; i < 50 * 40; i++) {
      world.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
      if (i % 250 === 0) log.push(`t=${(i / 50).toFixed(0)} alt=${alt().toFixed(0)} vs=${world.verticalSpeed(wv).toFixed(1)} thrust=${wv.state.telemetry.thrust.toFixed(0)} m=${wv.state.mass.toFixed(0)} sit=${wv.state.situation}`);
    }
    console.log(log.join('\n'));
    expect(Number.isFinite(alt())).toBe(true);
    expect(alt()).toBeGreaterThan(alt0 + 1000);
  }, 60000);
});
