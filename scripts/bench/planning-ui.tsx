/** Lightweight browser QA fixture for the actual HUD components, without a WebGL scene. */
import { createRoot } from 'react-dom/client';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { buildRingrunner } from '../../src/editor/stockCrafts';
import { stateToElements } from '../../src/sim/orbit';
import { add, v3 } from '../../src/util/vec3';
import { ManeuverPanel } from '../../src/flight/hud/ManeuverPanel';

export function mountPlanningUi() {
  const world = new World(new Universe('real'), PART_CATALOG, (Date.UTC(2030, 6, 20, 12) - Date.UTC(2000, 0, 1, 12)) / 1000);
  const vessel = world.launch(buildRingrunner()), b = world.universe.body('earth');
  const radius = b.radius + 220000, bs = world.universe.ephem.getBodyState('earth', world.ut);
  const position = v3(radius, 0, 0), velocity = v3(0, Math.sqrt(b.gm / radius) * Math.cos(0.5), Math.sqrt(b.gm / radius) * Math.sin(0.5));
  vessel.state.position = add(bs.position, position); vessel.state.velocity = add(bs.velocity, velocity);
  vessel.state.situation = 'flying'; vessel.mode = 'rails'; vessel.fixed = undefined;
  vessel.orbit = stateToElements(b.gm, 'earth', position, velocity, world.ut);
  const rootElement = document.createElement('div'); document.body.replaceChildren(rootElement);
  const root = createRoot(rootElement); root.render(<ManeuverPanel world={world} />);
  return { world, unmount: () => root.unmount() };
}
