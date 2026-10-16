import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { RAILS_WARP } from '../src/game/timewarp';
import { WarpDriver } from '../src/flight/controller/warp';
import { assistFrame, createAssist } from '../src/flight/assist';
import { neutralInput } from '../src/sim/vessel';

function parked() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const vessel = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  placeInCircularOrbit(world, vessel, 'earth', 82000);
  return { world, vessel };
}

describe('low parking-orbit waits', () => {
  it('warps seven days to a node in seconds and stops at its preparation lead', () => {
    const { world, vessel } = parked();
    const start = world.ut, dt = 1 / 60;
    world.addNode(start + 7 * 86400 + 30);
    const driver = new WarpDriver();
    expect(driver.start(world, 'node')).toBeNull();
    let frames = 0, peak = 0;
    while (driver.target && frames < 1800) {
      driver.drive(world, dt);
      world.tick(driver.rampDt(world, dt), neutralInput());
      peak = Math.max(peak, RAILS_WARP[world.warp.index]);
      frames++;
    }
    console.log(`82 km seven-day warp: ${frames} frames = ${(frames * dt).toFixed(2)} s at 60 Hz, peak ${peak}×`);
    expect(driver.target).toBeNull();
    expect(peak).toBe(1_000_000);
    expect(world.ut - start).toBeGreaterThan(7 * 86400 - 1);
    expect(world.ut - start).toBeLessThanOrEqual(7 * 86400);
    expect(world.orbitSummary(vessel).pe).toBeCloseTo(82000, 1);
    expect(world.warp.index).toBe(0);
  });

  it('lets Execute next node coast at full rails warp from the same orbit', () => {
    const { world } = parked();
    const start = world.ut, dt = 1 / 60;
    const node = world.addNode(start + 7 * 86400);
    node.prograde = 20;
    const assist = createAssist('node', world), state = { warped: false };
    let frames = 0, peak = 0;
    while (world.ut < node.time - 60 && frames < 3600) {
      const frame = assistFrame(world, assist, neutralInput(), dt, state);
      world.tick(dt, frame.input);
      peak = Math.max(peak, RAILS_WARP[world.warp.index]);
      frames++;
      if (frame.ended) break;
    }
    expect(assist.error).toBeUndefined();
    expect(peak).toBe(1_000_000);
    expect(world.ut).toBeGreaterThanOrEqual(node.time - 60);
    expect(world.ut).toBeLessThan(node.time);
  });

  it('keeps the altitude cap for unproven or precise-gravity paths', () => {
    const { world } = parked();
    expect(world.warpContext().orbitClear).toBe(false);
    world.warp = { mode: 'rails', index: 3 };
    world.tick(0.01, neutralInput());
    expect(world.warpContext().orbitClear).toBe(true);
    world.preciseGravity = true;
    expect(world.warpContext().orbitClear).toBe(false);
  });
});
