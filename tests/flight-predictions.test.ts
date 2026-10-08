import { expect, it, vi } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { spawnRelative } from '../src/scenarios/catalog';
import { flightPredictions } from '../src/game/flightData';
import { v3 } from '../src/util/vec3';

function fixture(speedFraction: number) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const moon = world.universe.body('moon'), r = moon.radius + 50000;
  const vessel = spawnRelative(world, buildOrbiter(), 'moon', v3(r, 0, 0), v3(0, Math.sqrt(moon.gm / r) * speedFraction, 0));
  return { world, vessel };
}

it('does not predict a multi-body path for a safe orbit or outbound flyby without an impact', () => {
  for (const fraction of [1, 1.6]) {
    const { world, vessel } = fixture(fraction);
    const trajectory = vi.spyOn(world, 'trajectory');
    expect(flightPredictions(world, vessel).impact).toBeNull();
    expect(trajectory).not.toHaveBeenCalled();
  }
});

it('keeps the SOI bound and terrain impact prediction for a suborbital flight', () => {
  const { world, vessel } = fixture(0.6);
  const trajectory = vi.spyOn(world, 'trajectory');
  const result = flightPredictions(world, vessel);
  expect(trajectory).toHaveBeenCalledOnce();
  expect(result.impact).not.toBeNull();
  expect(result.impact!.time).toBeGreaterThan(world.ut);
  expect(result.impact!.speed).toBeGreaterThan(0);
});
