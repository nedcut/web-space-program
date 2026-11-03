import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { serializeWorld, deserializeWorld, savedPilotThrottle, type SavedWorld } from '../src/game/persistence';
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

  it('saves the pilot throttle so a quickload resumes the burn', () => {
    const u = new Universe('standard');
    const w = new World(u, PART_CATALOG, DEFAULT_START_UT);
    w.launch(buildOrbiter());
    w.pilotThrottle = 1;
    const saved = JSON.parse(JSON.stringify(serializeWorld(w))) as SavedWorld;
    expect(savedPilotThrottle(saved)).toBe(1);
    w.pilotThrottle = 0.35;
    expect(savedPilotThrottle(JSON.parse(JSON.stringify(serializeWorld(w))))).toBe(0.35);
    // Zero leaves the save unchanged, and older saves resume at zero.
    w.pilotThrottle = 0;
    const idle = serializeWorld(w);
    expect('pilotThrottle' in idle).toBe(false);
    expect(savedPilotThrottle(idle)).toBe(0);
  });

  it('drops the saved throttle when a world is re-saved by another scene, and clamps malformed values', () => {
    const u = new Universe('standard');
    const w = new World(u, PART_CATALOG, DEFAULT_START_UT);
    w.launch(buildOrbiter());
    w.pilotThrottle = 1;
    const saved = JSON.parse(JSON.stringify(serializeWorld(w))) as SavedWorld;
    // Tracking Station / Space Center load the world, time may pass, and they save again: no stale burn returns.
    expect(savedPilotThrottle(serializeWorld(deserializeWorld(saved, PART_CATALOG, u)))).toBe(0);
    for (const [value, expected] of [[2, 1], [-1, 0], [Number.NaN, 0], ['1', 0], [null, 0]] as const)
      expect(savedPilotThrottle({ ...saved, pilotThrottle: value as unknown as number })).toBe(expected);
  });
});
