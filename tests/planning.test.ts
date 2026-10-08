import { requireIntactFlight } from './helpers/structural';
import { afterEach, expect, it, vi } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildRingrunner } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { planTransferToBody } from '../src/game/autopilot';
import { planInterplanetaryTransfer, planCourseCorrectionToBody, porkchopGrid } from '../src/game/interplanetary';
import { planningSnapshot, requestPlan } from '../src/game/planning/client';
import { createPlannerHandler, restorePlanningWorld } from '../src/game/planning/handler';
import { applyPlanningResult } from '../src/game/planning/apply';
import type { PlannerEvent, PlannerMessage, PlanningRequest } from '../src/game/planning/protocol';
import { stateToElements, propagate } from '../src/sim/orbit';
import { add, v3 } from '../src/util/vec3';

function parked() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const vessel = world.launch(buildRingrunner()), b = world.universe.body('earth');
  const r = b.radius + 120000, bs = world.universe.ephem.getBodyState('earth', world.ut);
  const pos = v3(r, 0, 0), vel = v3(0, Math.sqrt(b.gm / r) * Math.cos(0.5), Math.sqrt(b.gm / r) * Math.sin(0.5));
  vessel.state.position = add(bs.position, pos); vessel.state.velocity = add(bs.velocity, vel);
  vessel.state.situation = 'flying'; vessel.mode = 'rails'; vessel.fixed = undefined;
  vessel.orbit = stateToElements(b.gm, b.id, pos, vel, world.ut);
  return world;
}
const ranges = { departures: { min: DEFAULT_START_UT + 1000, max: DEFAULT_START_UT + 1e6, samples: 5 }, flights: { min: 4e7, max: 7e7, samples: 4 } };
afterEach(() => vi.unstubAllGlobals());

it.each(['moon', 'saturn'])('round-trips %s through structured-cloned worker messages without changing the synchronous result', async target => {
  const world = parked();
  world.addNode(world.ut + 60).prograde = 12;
  const snapshot = planningSnapshot(world), before = structuredClone(snapshot);
  const events: PlannerEvent[] = [];
  const handle = createPlannerHandler(event => events.push(structuredClone(event)));
  const request: PlanningRequest = target === 'moon'
    ? { type: 'plan', id: 42, operation: 'transfer', snapshot, args: { target } }
    : { type: 'plan', id: 42, operation: 'interplanetary', snapshot, args: { target, options: { periapsisAltitude: 1200000 } } };
  await handle(structuredClone(request));
  const event = events.find(e => e.type === 'result');
  expect(event?.type).toBe('result');
  if (event?.type !== 'result' || !event.result || Array.isArray(event.result) || !('node' in event.result)) throw new Error('Expected a transfer');
  const synchronous = target === 'moon' ? planTransferToBody(world, target) : planInterplanetaryTransfer(world, target, { periapsisAltitude: 1200000 });
  expect(synchronous).not.toBeNull();
  // IDs belong to the receiving World; every physical result is bit-identical.
  expect({ ...event.result, node: { ...event.result.node, id: 0 } }).toEqual({ ...synchronous, node: { ...synchronous!.node, id: 0 } });
  expect(events.every(e => e.id === 42)).toBe(true);
  expect(events.filter(e => e.type === 'progress').length).toBeGreaterThan(2);
  expect(snapshot).toEqual(before);
}, 60000);

it('streams all porkchop rows in order, with data identical to the synchronous grid', async () => {
  const world = parked(), rows: number[] = [], cells: unknown[] = [];
  const task = requestPlan('porkchop', planningSnapshot(world), { from: 'earth', target: 'saturn', ...ranges }, { onProgress: event => {
    if (event.row) { rows.push(event.row.index); cells.push(...event.row.cells); }
  } });
  const result = await task.result;
  expect(rows).toEqual([0, 1, 2, 3, 4]);
  expect(result).toEqual(cells);
  expect(result).toEqual(porkchopGrid(world, 'earth', 'saturn', ranges.departures, ranges.flights));
  expect(world.nodes).toEqual([]);
});

it('cancels in-process work between rows without emitting a result or more rows', async () => {
  const events: PlannerEvent[] = [];
  const handle = createPlannerHandler(event => {
    events.push(event);
    if (event.type === 'progress' && event.progress.row) void handle({ type: 'cancel', id: event.id });
  });
  await handle({ type: 'plan', id: 4, operation: 'porkchop', snapshot: planningSnapshot(parked()), args: { from: 'earth', target: 'saturn', ...ranges } });
  expect(events.filter(e => e.type === 'progress' && e.progress.row)).toHaveLength(1);
  expect(events.at(-1)).toEqual({ type: 'cancelled', id: 4 });
  expect(events.some(e => e.type === 'result')).toBe(false);
});

it('supports immediate cancellation and already-aborted signals in the Node fallback', async () => {
  const snapshot = planningSnapshot(parked()), progress = vi.fn();
  const task = requestPlan('transfer', snapshot, { target: 'moon' }, { onProgress: progress });
  task.cancel(); task.cancel();
  await expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
  expect(progress).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort();
  await expect(requestPlan('transfer', snapshot, { target: 'moon' }, { signal: controller.signal }).result).rejects.toMatchObject({ name: 'AbortError' });
});

it('terminates only the cancelled worker, ignores late/wrong-ID replies and cleans up successful workers', async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: PlannerEvent }) => void;
    request?: PlannerMessage;
    terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage(message: PlannerMessage) { this.request = structuredClone(message); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const snapshot = planningSnapshot(parked());
  const first = requestPlan('transfer', snapshot, { target: 'moon' });
  const second = requestPlan('transfer', snapshot, { target: 'moon' });
  expect(first.id).not.toBe(second.id);
  first.cancel();
  await expect(first.result).rejects.toMatchObject({ name: 'AbortError' });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(workers[1].terminate).not.toHaveBeenCalled();
  workers[0].onmessage?.({ data: { type: 'result', id: first.id, result: null } });
  workers[1].onmessage?.({ data: { type: 'error', id: first.id, name: 'Error', message: 'wrong request' } });
  workers[1].onmessage?.({ data: { type: 'result', id: second.id, result: null } });
  await expect(second.result).resolves.toBeNull();
  expect(workers[1].terminate).toHaveBeenCalledOnce();
});

it('preserves planner errors through the protocol', async () => {
  await expect(requestPlan('interplanetary', planningSnapshot(parked()), { target: 'moon' }).result).rejects.toMatchObject({ name: 'RangeError', message: expect.stringMatching(/planets/) });
});

it('runs heliocentric course correction through the same async interface', async () => {
  const snapshot = planningSnapshot(parked());
  const universe = new Universe(snapshot.preset);
  const state = universe.ephem.getRelativeState('earth', snapshot.ut);
  snapshot.vessel = { id: 'cruise', body: 'sun', state, orbit: stateToElements(universe.body('sun').gm, 'sun', state.position, state.velocity, snapshot.ut) };
  const args = { target: 'saturn', options: { arrivalTime: snapshot.ut + 6e7, maxDv: 1 } };
  const sync = planCourseCorrectionToBody(restorePlanningWorld(snapshot), args.target, args.options);
  expect(await requestPlan('correction', snapshot, args).result).toEqual(sync);
});

it('installs nodes with live IDs and rejects a changed flight or edited node list', () => {
  const world = parked(), snapshot = planningSnapshot(world);
  const plan = { node: { id: 900, time: world.ut + 1000, prograde: 10, normal: 2, radial: 1 }, patches: [], encounterTime: 0, periapsisAltitude: 0, dv: 10 };
  applyPlanningResult(world, snapshot, plan);
  expect(world.nodes[0]).toMatchObject({ prograde: 10, normal: 2, radial: 1 });
  expect(world.nodes[0].id).not.toBe(900);
  expect(() => applyPlanningResult(world, snapshot, plan)).toThrow(/changed/);
  const updated = planningSnapshot(world);
  world.active!.body = 'moon';
  expect(() => applyPlanningResult(world, updated, plan)).toThrow(/changed/);
  world.active!.body = 'earth';
  world.active!.state.velocity.x += 1;
  expect(() => applyPlanningResult(world, updated, plan)).toThrow(/trajectory changed/);
});

it('allows ordinary orbital coasting while a plan is computed', () => {
  const world = parked(), snapshot = planningSnapshot(world);
  world.ut += 10;
  const state = propagate(snapshot.vessel!.orbit, world.ut), body = world.universe.ephem.getBodyState('earth', world.ut);
  world.active!.state.position = add(body.position, state.position);
  world.active!.state.velocity = add(body.velocity, state.velocity);
  expect(() => applyPlanningResult(world, snapshot, { node: { id: 900, time: world.ut + 1000, prograde: 10, normal: 0, radial: 0 }, patches: [], encounterTime: 0, periapsisAltitude: 0, dv: 10 })).not.toThrow();
});

it('cancels the async fallback from a streamed row and leaves the live nodes intact', async () => {
  const world = parked(); world.addNode(world.ut + 60).prograde = 20;
  const snapshot = planningSnapshot(world), controller = new AbortController(), rows: number[] = [];
  const task = requestPlan('porkchop', snapshot, { from: 'earth', target: 'saturn', ...ranges }, { signal: controller.signal, onProgress: event => {
    if (event.row) { rows.push(event.row.index); controller.abort(); }
  } });
  await expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
  expect(rows).toEqual([0]);
  expect(world.nodes).toEqual(snapshot.nodes);
});

it('hands the Earth grid to workers as a shared Blob, not a 16 MiB clone', async () => {
  const { earthDataMessage } = await import('../src/game/earthLoader');
  const { earthData } = await import('../src/sim/terrain/earthData');
  const first = earthDataMessage(), second = earthDataMessage();
  if (earthData().buffer instanceof ArrayBuffer) {
    expect(first.blob).toBeInstanceOf(Blob);
    expect(first.blob!.size).toBe(earthData().buffer.byteLength);
    expect(second.blob).toBe(first.blob);
  } else expect(first.buffer).toBe(earthData().buffer);
});
