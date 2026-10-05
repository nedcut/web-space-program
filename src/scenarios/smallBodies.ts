import { World } from '../game/world';
import { Universe } from '../game/universe';
import { PART_CATALOG } from '../data/parts';
import { buildPebblecatcher } from '../editor/stockCrafts';
import { add, scale, v3 } from '../util/vec3';
import { qFromTo } from '../util/quat';
import type { ScalePresetId } from '../sim/bodies/scale';

/** Scenario-ready close approach, nose outward and moving gently toward the rotating surface. */
export function setupSmallBodyApproach(body = 'bennu', preset: ScalePresetId = 'standard', ut = 0) {
  const world = new World(new Universe(preset), PART_CATALOG, ut);
  world.commsSettings.enabled = false;
  world.universe.activateAsteroid(body);
  const b = world.universe.body(body), ephem = world.universe.ephem;
  const craft = buildPebblecatcher();
  const fixed = v3(0, 0, 1);
  const up = ephem.fromBodyFixed(body, fixed, ut);
  const radius = b.radius + world.universe.terrain(body).heightAt(0, 0, 1) + 8;
  const rel = scale(up, radius), state = ephem.getBodyState(body, ut);
  const vessel = world.spawnVessel(craft, { position: add(state.position, rel),
    velocity: add(state.velocity, add(ephem.surfaceVelocity(body, rel, ut), scale(up, -0.01))),
    orientation: qFromTo(v3(0, 1, 0), up) });
  vessel.body = body;
  for (const p of vessel.state.parts) if (p.leg) p.leg.deployed = true;
  world.switchTo(vessel.state.id);
  return { world, craft, vessel };
}
