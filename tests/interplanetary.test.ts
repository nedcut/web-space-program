import { requireIntactFlight } from './helpers/structural';
import { expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { PART_CATALOG } from '../src/data/parts';
import { buildRingrunner } from '../src/editor/stockCrafts';
import { porkchopGrid, planInterplanetaryTransfer } from '../src/game/interplanetary';
import { add, v3 } from '../src/util/vec3';
import { executeNode, runAutopilot, planTransferToBody } from '../src/game/autopilot';
import { stateToElements } from '../src/sim/orbit';

function parked() {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(w);
  const v = w.launch(buildRingrunner()), b = w.universe.body('earth');
  const r = b.radius + 120000, bs = w.universe.ephem.getBodyState('earth', w.ut);
  const pos = v3(r, 0, 0), vel = v3(0, Math.sqrt(b.gm / r) * Math.cos(0.5), Math.sqrt(b.gm / r) * Math.sin(0.5));
  v.state.position = add(bs.position, pos); v.state.velocity = add(bs.velocity, vel);
  v.state.situation = 'flying'; v.mode = 'rails'; v.fixed = undefined;
  v.orbit = stateToElements(b.gm, b.id, pos, vel, w.ut);
  return w;
}
it('searches and targets Saturn from an inclined Earth parking orbit', () => {
  const w = parked();
  const p = planInterplanetaryTransfer(w, 'saturn', { periapsisAltitude: 1200000 });
  expect(p).not.toBeNull();
  expect(p!.patches.map(p => p.orbit.body)).toEqual(expect.arrayContaining(['earth', 'sun', 'saturn']));
  expect(p!.periapsisAltitude).toBeCloseTo(1200000, -3);
  expect(p!.dv).toBeLessThan(5000);
  expect(w.nodes).toHaveLength(1);
}, 60000);
it('exports deterministic grid data without adding nodes and rejects moon departures', () => {
  const w = parked(), dep = { min: w.ut + 1000, max: w.ut + 1e6, samples: 3 }, tof = { min: 4e7, max: 7e7, samples: 3 };
  const grid = porkchopGrid(w, 'earth', 'saturn', dep, tof);
  expect(grid).toHaveLength(9);
  expect(grid.every(p => p && Number.isFinite(p.totalDv) && p.arrivalTime > p.departureTime)).toBe(true);
  expect(w.nodes).toHaveLength(0);
  expect(porkchopGrid(w, 'earth', 'saturn', dep, tof)).toEqual(grid);
  w.active!.body = 'moon';
  expect(() => planInterplanetaryTransfer(w, 'saturn')).toThrow(/planets/);
  expect(w.nodes).toHaveLength(0);
});

it.each(['mars', 'jupiter'])('routes sibling transfer to %s through the public autopilot API', target => {
  const w = parked();
  const p = planTransferToBody(w, target);
  expect(p).not.toBeNull();
  expect(p!.patches.some(p => p.orbit.body === target)).toBe(true);
  expect(p!.periapsisAltitude).toBeGreaterThan(w.universe.body(target).atmosphere!.height);
}, 60000);
it('reports an exhausted allowed stage instead of burning until the mission timeout', () => {
  const w = parked();
  w.active!.state.nextStage = -1;
  const n = w.addNode(w.ut + 1); n.prograde = 100;
  const ap = executeNode(w, n);
  expect(runAutopilot(w, ap, { maxTime: 20 })).toBe(false);
  expect(ap.error).toMatch(/no propulsion/);
});
