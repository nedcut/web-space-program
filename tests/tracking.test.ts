import { expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { add, v3, length, sub } from '../src/util/vec3';

it('advances an empty tracking world and preserves time through serialization', () => {
  const w = new World(new Universe('standard'), PART_CATALOG, 1000);
  w.advanceRailsTo(1e6);
  expect(w.ut).toBe(1e6);
  expect(deserializeWorld(serializeWorld(w), PART_CATALOG).ut).toBe(1e6);
  w.advanceRailsTo(0);
  expect(w.ut).toBe(1e6);
});

it('packs and propagates unattended orbiters while keeping surface vessels body-fixed', () => {
  const u = new Universe('standard');
  const w = new World(u, PART_CATALOG, 1000);
  const vessel = w.launch(buildOrbiter());
  const fixed = structuredClone(vessel.fixed);
  w.activeId = null;
  w.advanceRailsTo(2000);
  expect(vessel.fixed).toEqual(fixed);
  const earth = u.body('earth');
  const r = earth.radius * 4;
  const bs = u.ephem.getBodyState('earth', w.ut);
  vessel.mode = 'physics';
  vessel.state.situation = 'flying';
  vessel.state.position = add(bs.position, v3(r, 0, 0));
  vessel.state.velocity = add(bs.velocity, v3(0, Math.sqrt(earth.gm / r), 0));
  vessel.fixed = undefined;
  w.advanceRailsTo(2100);
  expect(vessel.mode).toBe('rails');
  expect(w.ut).toBe(2100);
  expect(Math.abs(length(sub(vessel.state.position, u.ephem.getBodyState('earth', w.ut).position)) - r)).toBeLessThan(0.01);
});
