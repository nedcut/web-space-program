import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { SCALE_PRESETS, careerScaleMultiplier } from '../src/sim/bodies/scale';
import { sampleAtmosphere } from '../src/sim/atmosphere';
import { LAUNCH_SITE, RUNWAY, siteLocalToUnit } from '../src/sim/terrain/presets/earth';
import { situationAt } from '../src/sim/science/biomes';
import { maxRailsIndexAt } from '../src/game/timewarp';
import { buildChunk } from '../src/render/planet/chunkBuilder';
import { VesselView } from '../src/render/vessel/VesselView';
import { buildRealOrbiter } from '../src/editor/stockCrafts';
import { computeStageStats } from '../src/editor/ui/dv';
import { buildVessel, computeStageDeltaV } from '../src/sim/vessel';
import { GROUND_STATIONS } from '../src/game/comms';
import { linkRange } from '../src/sim/comms/network';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';

it.each(['standard', 'challenging', 'real'] as const)('%s physical scale invariants', preset => {
  const universe = new Universe(preset), earth = universe.body('earth'), cfg = SCALE_PRESETS[preset];
  expect(earth.radius).toBeCloseTo(6371008.4 * cfg.s, 4);
  expect(earth.surfaceGravity).toBeCloseTo(9.82025, 3);
  const air = sampleAtmosphere(earth.atmosphere, 10000 * cfg.s ** cfg.atmosphereExponent, earth.surfaceGravity);
  const real = new Universe('real').body('earth');
  expect(air.pressure).toBeCloseTo(sampleAtmosphere(real.atmosphere, 10000, real.surfaceGravity).pressure, 6);
  const terrain = universe.terrain('earth');
  for (const [x, z] of [[0, 0], [-RUNWAY.length / 2, RUNWAY.z], [RUNWAY.length / 2, RUNWAY.z]]) {
    const d = siteLocalToUnit(x, z, earth.radius);
    expect(terrain.heightAt(d.x, d.y, d.z)).toBeCloseTo(LAUNCH_SITE.elevation, 5);
  }
  expect(situationAt(earth, earth.atmosphere!.height * 0.24, 'flying')).toBe('flyingLow');
  expect(situationAt(earth, earth.atmosphere!.height * 1.1, 'flying')).toBe('spaceLow');
  expect(maxRailsIndexAt(earth.atmosphere!.height - 1, earth.radius, earth.atmosphere!.height)).toBe(0);
  expect(maxRailsIndexAt(earth.atmosphere!.height + 80000, earth.radius, earth.atmosphere!.height)).toBeGreaterThanOrEqual(6);

  const world = new World(universe, PART_CATALOG, 0, 'career');
  const multiplier = careerScaleMultiplier(preset);
  expect(world.progression.funds).toBeCloseTo(60000 * multiplier);
  expect(world.progression.contracts[0].reward).toBeCloseTo(18000 * multiplier);
  const loaded = deserializeWorld(serializeWorld(world), PART_CATALOG);
  expect(loaded.progression).toEqual(world.progression);
  const craft = buildRealOrbiter();
  const sandbox = new World(universe, PART_CATALOG, 0);
  sandbox.launch(craft);
  const restored = deserializeWorld(serializeWorld(sandbox), PART_CATALOG);
  expect(restored.active!.state.cache.boundingRadius).toBeCloseTo(sandbox.active!.state.cache.boundingRadius, 6);
  const sim = computeStageDeltaV(buildVessel(craft, PART_CATALOG), earth.atmosphere!.surfacePressure, earth.surfaceGravity);
  const ui = [...computeStageStats(craft, PART_CATALOG, earth).values()];
  expect(ui[0].twrAsl).toBeCloseTo(sim[0].twrStart, 8);
});

it('real-size terrain chunks preserve adjoining near-surface vertices to sub-millimetres', () => {
  const universe = new Universe('real'), earth = universe.body('earth');
  const params = { face: 0, level: 16, ix: 32768, iy: 32768, res: 8, radius: earth.radius, ocean: false };
  const a = buildChunk(universe.terrain('earth'), params);
  const b = buildChunk(universe.terrain('earth'), { ...params, ix: params.ix + 1 });
  for (let row = 0; row <= 8; row++) for (let axis = 0; axis < 3; axis++) {
    const x = a.origin[axis] + a.positions[(row * 9 + 8) * 3 + axis];
    const y = b.origin[axis] + b.positions[row * 9 * 3 + axis];
    expect(Math.abs(x - y)).toBeLessThan(0.001);
  }
});

it('real Earth vessel rendering retains centimetre motion across floating-origin changes', () => {
  const world = new World(new Universe('real'), PART_CATALOG, 0);
  world.launch(buildRealOrbiter());
  const vessel = world.active!.state;
  const view = new VesselView(vessel);
  try {
    const start = { ...vessel.position };
    for (const shift of [0, 1000, -1000]) {
      const origin = { x: start.x + shift, y: start.y, z: start.z };
      vessel.position.x = start.x + 0.01;
      view.update(origin, 0, 101325, 0);
      view.root.updateMatrix();
      // This is the actual object matrix the renderer uploads as float32.
      const uploadedX = Math.fround(view.root.matrix.elements[12]);
      expect(Math.abs(uploadedX + shift - 0.01)).toBeLessThan(0.0001);
    }
  } finally {
    view.dispose();
  }
});

it('catalog communications cover the real Moon and Saturn with appropriately rated dishes', () => {
  const rating = (id: string) => PART_CATALOG.get(id)!.modules.find(m => m.type === 'antenna')!.range;
  const groundRange = GROUND_STATIONS[0].range;
  expect(linkRange(rating('antenna-thread'), groundRange)).toBeGreaterThan(384.4e6);
  expect(linkRange(rating('antenna-relay'), groundRange)).toBeGreaterThan(384.4e6);
  expect(linkRange(rating('antenna-horizon'), groundRange)).toBeGreaterThan(1.7e12);
});
