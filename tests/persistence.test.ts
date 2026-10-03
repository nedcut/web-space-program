import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { DEFAULT_START_UT } from '../src/game/store';

describe('world persistence', () => {
  it('round-trips a flying vessel and continues identically', () => {
    const u = new Universe('standard');
    const w1 = new World(u, PART_CATALOG, DEFAULT_START_UT);
    w1.launch(buildOrbiter());
    w1.tick(0.02, neutralInput({ throttle: 1, stage: true, sas: 'stabilityAssist' }));
    for (let i = 0; i < 200; i++) w1.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
    const json = JSON.parse(JSON.stringify(serializeWorld(w1)));
    const w2 = deserializeWorld(json, PART_CATALOG, u);
    for (let i = 0; i < 100; i++) {
      w1.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
      w2.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
    }
    const a = w1.active!.state, b = w2.active!.state;
    expect(b.parts.length).toBe(a.parts.length);
    expect(Math.abs(a.position.x - b.position.x)).toBeLessThan(1e-3);
    expect(Math.abs(a.mass - b.mass)).toBeLessThan(1e-6);
  }, 60000);
});
