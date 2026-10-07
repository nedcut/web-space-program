import { requireIntactFlight } from './helpers/structural';
import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { length, sub } from '../src/util/vec3';
import { DEFAULT_START_UT } from '../src/game/store';

const mk = () => {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(w);
  w.launch(buildOrbiter());
  return w;
};

describe('world regressions (review findings)', () => {
  it('a stage press in a frame with no physics step is not lost', () => {
    const w = mk();
    w.tick(0.005, neutralInput({ stage: true, throttle: 1 }));
    for (let i = 0; i < 5; i++) w.tick(0.02, neutralInput({ throttle: 1 }));
    // The stage fired (engines lit); the hold-down clamps may still be holding while they spool up.
    expect(w.active!.state.parts.some(p => p.engine?.ignited)).toBe(true);
    expect(w.active!.mode === 'physics' || !!w.active!.holdDown).toBe(true);
  });

  it('decoupled stages spawn next to the parent, not a step behind', () => {
    const w = mk();
    w.tick(0.02, neutralInput({ stage: true, throttle: 1, sas: 'stabilityAssist' }));
    // Burn the first stage dry, then stage to drop it.
    let maxGap = 0;
    for (let i = 0; i < 50 * 200 && w.vessels.size === 1; i++) {
      const stage = w.active!.state.telemetry.thrust < 1 && i > 50;
      w.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist', stage }));
    }
    for (const v of w.vessels.values()) if (v !== w.active) maxGap = Math.max(maxGap, length(sub(v.state.position, w.active!.state.position)));
    expect(w.vessels.size).toBeGreaterThan(1);
    expect(maxGap).toBeLessThan(30);
  }, 60000);

  it('relaunching clears a vessel left on the pad', () => {
    const w = mk();
    w.launch(buildOrbiter());
    expect(w.vessels.size).toBe(1);
  });
});
