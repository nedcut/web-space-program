import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT } from '../src/game/store';
import { buildCinderbloom } from '../src/editor/stock/space';
import { executeNode, planTransferToBody, runAutopilot } from '../src/game/autopilot';
import { toOrbit } from '../scripts/career/flights';

/** Career past the Moon: interplanetary legs flown through the real World and the flight-assist programs. */
describe('interplanetary departures', () => {
  it('flies a Venus departure with a plane change to the end (escape guidance stays well-conditioned)', () => {
    // Day 30, Standard: the planner's best Venus option is "now", 1.4 km/s with a large normal component. The
    // guidance aimed 174° around the escape hyperbola and its Lambert plane flipped: the burn stopped after 359 m/s.
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 30 * 86400, 'sandbox');
    w.launch(buildCinderbloom());
    expect(toOrbit(w, new Set(), 85000, 1)).toBeNull();
    const plan = planTransferToBody(w, 'venus');
    expect(plan).not.toBeNull();
    expect(Math.abs(plan!.node.normal)).toBeGreaterThan(200);
    const burn = executeNode(w, plan!.node, { minStage: 0 });
    expect(runAutopilot(w, burn, { maxTime: plan!.node.time - w.ut + 1e4 }), burn.error).toBe(true);
    expect(burn.dvUsed()).toBeGreaterThan(plan!.dv * 0.95);
    expect(burn.residual()).toBeLessThan(5);
    expect(w.orbitOf(w.active!).e).toBeGreaterThan(1);
  }, 240_000);
});
