import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { PART_CATALOG } from '../src/data/parts';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import { computeStageStats } from '../src/editor/ui/dv';
import { neutralInput } from '../src/sim/vessel';
import { localFrame } from '../src/game/autopilot';
import { length } from '../src/util/vec3';

describe('Kestrel beginner recipe', () => {
  for (const rate of [1, 4]) it(`returns under its chute after the taught 10 km cutoff at ${rate}× physics`, () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const craft = buildSoundingRocket();
    const first = computeStageStats(craft, PART_CATALOG, w.universe.body('earth')).get(0)!;
    expect(first.twrAsl).toBeGreaterThan(1.3);
    expect(first.twrEndVac).toBeLessThan(4);
    w.launch(craft);
    let apex = 0, peakG = 0, lit = false, cut = false, separated = false, fullChute = false;
    for (let k = 0; k < 30000 && w.active && !w.active.state.destroyed; k++) {
      const f = localFrame(w, w.active);
      apex = Math.max(apex, f.altitude);
      if (lit && k > 500 && w.active.state.situation !== 'flying') break;
      if (f.altitude >= 10000) cut = true;
      // The lesson teaches booster separation and then chute arming after the highest point.
      if (!separated && cut && w.verticalSpeed(w.active) < -1) {
        w.stageActive();
        w.stageActive();
        separated = true;
      }
      w.warp = rate === 1 ? { mode: 'rails', index: 0 } : { mode: 'physics', index: 3 };
      w.tick(0.02, neutralInput({ throttle: cut ? 0 : 1, stage: !lit, sas: separated ? 'off' : 'stabilityAssist' }));
      lit = true;
      peakG = Math.max(peakG, w.active?.state.telemetry.gForce ?? 0);
      fullChute ||= !!w.active?.state.parts.some(p => p.chute?.phase === 'full');
    }
    expect(cut).toBe(true);
    expect(apex).toBeGreaterThan(10000);
    expect(apex).toBeLessThan(25000);
    expect(peakG).toBeLessThan(6);
    expect(fullChute).toBe(true);
    expect(w.active?.state.destroyed).toBe(false);
    expect(w.active?.state.situation).toMatch(/^(landed|splashed)$/);
    expect(w.active?.state.parts.some(p => !!p.crew?.length)).toBe(true);
    expect(length(w.surfaceVelocity(w.active!))).toBeLessThan(10);
    expect(w.recoverActive()).toBe(true);
  }, 120000);
});
