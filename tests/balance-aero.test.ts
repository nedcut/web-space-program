import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS, buildMoonLander, buildSoundingRocket } from '../src/editor/stockCrafts';
import { preflightChecks } from '../src/editor/checks';
import { computeStageStats } from '../src/editor/ui/dv';
import { aeroControlMargin } from '../src/editor/aeroStability';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { ascentGuidance, localFrame, noseDirection, runAutopilot } from '../src/game/autopilot';
import { dot, length, normalize } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

describe('launch stability advisory', () => {
  it('flies Selene through the normal atmospheric ascent with bounded AoA', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    requireIntactFlight(w); w.launch(buildMoonLander());
    let maxAoA = 0, samples = 0;
    expect(runAutopilot(w, ascentGuidance(w, { targetApoapsis: 90000, minStage: 4 }), {
      maxTime: 900, onTick: () => {
        const v = w.active!, velocity = localFrame(w, v).surfVel;
        if (v.state.telemetry.dynamicPressure < 1000 || length(velocity) < 30) return;
        samples++;
        maxAoA = Math.max(maxAoA, Math.acos(Math.max(-1, Math.min(1, dot(noseDirection(v.state), normalize(velocity))))) * 180 / Math.PI);
      },
    })).toBe(true);
    expect(samples).toBeGreaterThan(1000);
    expect(maxAoA).toBeLessThan(12);
    console.log(`Selene loaded-air max AoA: ${maxAoA.toFixed(2)}°`);
  }, 120000);
  it('distinguishes controlled/stable rockets from top fins and a heavy tail without control', () => {
    expect(aeroControlMargin(buildMoonLander(), PART_CATALOG)).toBeGreaterThan(0);
    expect(aeroControlMargin(buildSoundingRocket(), PART_CATALOG)).toBeGreaterThan(0);
    const top = buildSoundingRocket();
    for (const p of top.parts) {
      if (p.partId === 'fin-keel') p.position.y = 4;
      if (p.partId.startsWith('eng-')) p.tweaks = { gimbalLock: true };
    }
    expect(preflightChecks(top, PART_CATALOG).some(c => c.id === 'aero')).toBe(true);
    const tail = buildMoonLander();
    tail.parts = tail.parts.filter(p => !p.partId.startsWith('fin-'));
    for (const p of tail.parts) if (p.partId.startsWith('eng-')) p.tweaks = { gimbalLock: true };
    expect(preflightChecks(tail, PART_CATALOG).some(c => c.id === 'aero')).toBe(true);
  });
  it('audits every stock craft with editor stage readouts; remaining advisories identify missing parachutes or low Earth TWR', () => {
    const withoutChutes = ['stock-swift', 'stock-hearthlight', 'stock-longreach', 'stock-daybreak', 'stock-alembic', 'stock-skipjack', 'stock-sandpiper'];
    // Rovers drive on their wheels: no engine at all.
    const wheelsOnly = ['stock-sandpiper', 'stock-trekker'];
    for (const stock of STOCK_CRAFTS) {
      const c = stock.build();
      const first = computeStageStats(c, PART_CATALOG, new Universe(stock.scale).body('earth')).get(0);
      const expected = [...(wheelsOnly.includes(stock.id) ? ['first-engine'] : []), ...(c.type === 'VAB' && first && first.twrAsl < 1 ? ['twr'] : []), ...(withoutChutes.includes(stock.id) ? ['chute'] : [])];
      expect(preflightChecks(c, PART_CATALOG, first).map(c => c.id), stock.id).toEqual(expected);
      if (expected.includes('twr')) expect(first!.twrAsl).toBeLessThan(1);
      if (withoutChutes.includes(stock.id)) expect(c.parts.some(p => PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'parachute'))).toBe(false);
    }
  });
});
