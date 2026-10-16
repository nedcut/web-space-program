import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { runAutopilot } from '../src/game/autopilot';
import { createAssist } from '../src/flight/assist';
import { landHereTouchdown, landingLight, sunElevation } from '../src/game/landingLight';
import { neutralInput } from '../src/sim/vessel';
import { dot, normalize } from '../src/util/vec3';

/** Selene in a 20 km lunar orbit whose Land-here touchdown is on the night side (Sun ≈ −46° there). */
function seleneAtNight() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 3000);
  const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  placeInCircularOrbit(world, wv, 'moon', 20000);
  world.tick(0.1, neutralInput());
  return { world, wv };
}

describe('Land here: day or night at the touchdown', () => {
  it('predicts where the descent reaches the ground, and that it is night there', () => {
    const { world, wv } = seleneAtNight();
    const predicted = landHereTouchdown(world, wv)!;
    const light = landingLight(world, wv)!;
    expect(light.elevation).toBeLessThan(0);
    expect(light.daylightWait).toBeGreaterThan(0);
    const land = createAssist('land', world);
    expect(runAutopilot(world, land, { maxTime: 1e5 }), land.error).toBe(true);
    const site = world.relativeState(world.active!).position;
    const miss = Math.acos(Math.min(1, dot(normalize(site), normalize(predicted.position)))) * 180 / Math.PI;
    expect(miss).toBeLessThan(5);
    expect(sunElevation(world.universe, 'moon', site, world.ut)).toBeLessThan(0);
  }, 240_000);

  it('waits for daylight when asked, then lands in sunlight', () => {
    const { world, wv } = seleneAtNight();
    const { daylightWait } = landingLight(world, wv)!;
    const start = world.ut;
    const land = createAssist('land', world, { wait: daylightWait! });
    expect(runAutopilot(world, land, { maxTime: 1e5 }), land.error).toBe(true);
    expect(world.ut - start).toBeGreaterThan(daylightWait!);
    expect(world.active!.state.situation).toBe('landed');
    expect(sunElevation(world.universe, 'moon', world.relativeState(world.active!).position, world.ut)).toBeGreaterThan(0);
  }, 240_000);
});
