import { expect, it } from 'vitest';
import { World, quatFromBasis } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { landingPrediction, type LandingRequest } from '../src/game/planning/landing';
import { neutralInput } from '../src/sim/vessel';
import { add, cross, length, normalize, scale, sub, v3 } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';

function reentry() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const craft = buildOrbiter(); craft.parts = craft.parts.slice(0, 3);
  const vessel = world.launch(craft), u = world.universe, b = u.body('earth');
  const rotation = u.ephem.bodyRotation('earth', world.ut);
  const up = qRotate(rotation, normalize(v3(1, -1, .2)));
  const east = normalize(cross(qRotate(rotation, v3(0, 0, 1)), up));
  const radius = b.radius + 120000, velocity = add(scale(east, Math.sqrt(b.gm / radius) * .78), scale(up, -160));
  const ref = u.ephem.getBodyState('earth', world.ut);
  vessel.mode = 'physics'; vessel.fixed = undefined; vessel.state.situation = 'flying';
  vessel.state.position = add(ref.position, scale(up, radius)); vessel.state.velocity = add(ref.velocity, velocity);
  const backwards = normalize(scale(velocity, -1)), side = normalize(cross(backwards, up));
  vessel.state.orientation = quatFromBasis(side, backwards, cross(side, backwards));
  vessel.state.angularVelocity = v3();
  vessel.state.parts.find(p => p.chute)!.chute!.phase = 'armed';
  return { world, vessel };
}

it('predicts a seeded 120 km reentry splashdown within 5 km of the actual drag-integrated flight', () => {
  const { world, vessel } = reentry();
  const { cache, ...snapshot } = vessel.state; void cache;
  const request: LandingRequest = { vessel: snapshot, body: 'earth', bottom: world.bottomOffset(vessel.state), attitude: 'retrograde', preciseGravity: false, horizon: 1800 };
  const prediction = landingPrediction(world.universe, world.ut, request);
  const before = structuredClone(snapshot);
  let next = prediction.next(), yields = 0;
  while (!next.done) { yields++; next = prediction.next(); }
  const result = next.value;
  expect(snapshot).toEqual(before);
  expect(result.outcome).toBe('impact');
  expect(result.impact).not.toBeNull();
  expect(yields).toBeGreaterThan(5);
  expect(result.points.length).toBeLessThan(440);
  const mappedSite = world.universe.ephem.toBodyFixed('earth', result.points[result.points.length - 1], result.start);
  expect(length(sub(mappedSite, result.impact!.fixedPosition))).toBeLessThan(1e-6);
  // Future body rotation would move the geographic marker by kilometres; the surface track must undo it.
  expect(length(sub(result.points[result.points.length - 1], result.impact!.position))).toBeGreaterThan(5000);
  const input = neutralInput({ sas: 'retrograde', sasReference: 'surface' });
  let steps = 0;
  while (vessel.state.situation === 'flying' && !vessel.state.destroyed && steps++ < 90000) world.tick(.02, input);
  const site = world.universe.surfaceInfo('earth', vessel.state.position, world.ut);
  const miss = length(sub(normalize(result.impact!.fixedPosition), site.fixedDir)) * world.universe.body('earth').radius;
  console.log(`WP4 reentry: ${miss.toFixed(1)} m miss, predicted T+${(result.impact!.time - result.start).toFixed(1)} s, actual T+${(world.ut - result.start).toFixed(1)} s, ${vessel.state.situation}, ${result.steps} worker steps`);
  expect(vessel.state.situation).toBe('splashed');
  expect(miss).toBeLessThan(5000);
}, 60000);

it('returns no landing on an intact safe orbit and supports bounded horizons', () => {
  const { world, vessel } = reentry();
  const { cache, ...snapshot } = vessel.state; void cache;
  const g = landingPrediction(world.universe, world.ut, { vessel: snapshot, body: 'earth', bottom: 1, attitude: 'hold', preciseGravity: false, horizon: 1 });
  let step = g.next(); while (!step.done) step = g.next();
  expect(step.value.impact).toBeNull();
  expect(step.value.outcome).toBe('horizon');
  expect(step.value.steps).toBe(0); // analytic coast covers this short horizon
});
