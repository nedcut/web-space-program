import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { landingController, localFrame, planLandingStage, runAutopilot, type Autopilot } from '../src/game/autopilot';
import { assistFrame, createAssist } from '../src/flight/assist';
import { SCENARIOS, setupScenario } from '../src/scenarios/catalog';
import { neutralInput } from '../src/sim/vessel';
import { add, dot, scale } from '../src/util/vec3';

/** `?flight=stock-selene&scenario=moon`: the whole unstaged Selene (Chinook booster next) in a 20 km lunar orbit. */
function fullSeleneAtMoon() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  placeInCircularOrbit(world, wv, 'moon', 20000);
  world.tick(0.1, neutralInput());
  return { world, wv };
}

/** The flight scene's assist loop at 60 fps, hands off. Counts real (frame) seconds per status head. */
function drive(world: World, assist: Autopilot, maxFrames: number, onFrame?: (warp: number) => void) {
  const state = { warped: false };
  for (let i = 0; i < maxFrames; i++) {
    const frame = assistFrame(world, assist, neutralInput({ sas: 'stabilityAssist' }), 1 / 60, state);
    world.tick(1 / 60, frame.input);
    onFrame?.(world.warp.index);
    if (frame.ended) return frame.ended;
  }
  return undefined;
}

describe('Land assist', () => {
  it('picks the lander stage when the booster cannot throttle low enough to hover', () => {
    const { world, wv } = fullSeleneAtMoon();
    const plan = planLandingStage(world, wv);
    expect(plan.error).toBeUndefined();
    // Chinook (6, 55% minimum ≈ 6× lunar weight) and Zephyr (4, minimum ≈ its weight) cannot sink at minimum throttle.
    expect(plan.stage).toBe(2);
    const refused = planLandingStage(world, wv, 6);
    expect(refused.error).toMatch(/cannot throttle low enough/);
  });

  it('lands the full Selene stack from a 20 km lunar orbit: stages down in orbit, warps the coast, counts down', () => {
    const { world, wv } = fullSeleneAtMoon();
    const assist = createAssist('land', world);
    const statuses = new Set<string>();
    let coastAt1x = 0, coastWarped = 0, partsAfterStaging = -1;
    let frames = 0;
    const ended = drive(world, assist, 60 * 600, warp => {
      frames++;
      const head = assist.status.split(' · ')[0];
      statuses.add(head);
      if (head === 'coast') { if (warp > 0) coastWarped++; else coastAt1x++; }
      if (head !== 'staging to the landing stage' && partsAfterStaging < 0 && wv.state.nextStage < 2) partsAfterStaging = wv.state.parts.length;
      if (head === 'coast' && /braking burn in \d/.test(assist.status)) statuses.add('countdown');
    });
    console.log(`land: ${[...statuses].join(' → ')}; ${(frames / 60).toFixed(0)} real s, coast ${(coastAt1x / 60).toFixed(1)} s at 1× + ${coastWarped} warped frames; touchdown ${assist.status}`);
    expect(ended?.reason, assist.error).toBe('done');
    expect(ended?.message).toMatch(/^Land: landed · touchdown \d/);
    expect(Number(/touchdown ([\d.]+)/.exec(assist.status)![1])).toBeLessThan(3);
    expect(statuses).toContain('staging to the landing stage');
    expect(statuses).toContain('countdown');
    expect(wv.state.nextStage).toBeLessThan(2);
    expect(wv.state.situation).toBe('landed');
    expect(wv.state.parts.length).toBe(partsAfterStaging);
    // The coast warps; only the last ~15 s before the braking burn run at 1×.
    expect(coastWarped).toBeGreaterThan(0);
    expect(coastAt1x / 60).toBeLessThan(30);
    expect(frames / 60).toBeLessThan(240);
  }, 120_000);

  it('refuses up front, without burning, when no allowed stage can hover', () => {
    const { world, wv } = fullSeleneAtMoon();
    const land = landingController(world, { minStage: 6 });
    const stage0 = wv.state.nextStage;
    runAutopilot(world, land, { maxTime: 30 });
    expect(land.error).toMatch(/cannot throttle low enough/);
    expect(land.done).toBe(false);
    expect(wv.state.nextStage).toBe(stage0);
  });

  it('reports a crash as a crash, not "landed"', () => {
    const { world } = setupScenario(SCENARIOS.find(s => s.id === 'suicide-burn')!);
    const wv = world.active!;
    // Far too fast and too low to stop: the touchdown destroys parts.
    world.tick(0.02, neutralInput({ sas: 'stabilityAssist' }));
    const f = localFrame(world, wv);
    const ground = world.universe.surfaceInfo(wv.body, wv.state.position, world.ut).heightAboveTerrain;
    wv.state.position = add(wv.state.position, scale(f.up, 120 - ground));
    wv.state.velocity = add(wv.state.velocity, scale(f.up, -90 - dot(f.surfVel, f.up)));
    const assist = createAssist('land', world);
    const ended = drive(world, assist, 60 * 60);
    console.log('crash:', JSON.stringify(ended), assist.status);
    expect(ended?.reason).toBe('error');
    expect(ended?.message).toMatch(/crashed/);
    expect(assist.status).not.toMatch(/landed/);
  }, 60_000);
});
