import { afterEach, expect, it, vi } from 'vitest';
import { LandingPredictionDriver } from '../src/flight/map/LandingPredictionDriver';
import type { FlightController } from '../src/flight/controller';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { DEFAULT_START_UT } from '../src/game/store';
import { scale, sub, add } from '../src/util/vec3';
import type { PlannerEvent, PlanningRequest } from '../src/game/planning/protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: unknown[] = [];
  onmessage?: (e: { data: PlannerEvent }) => void;
  onerror?: () => void;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.instances = []; });

it('does no prediction work for a safe orbit; uses one worker/grid copy and rejects a stale burn result', () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const v = world.launch(buildOrbiter()); placeInCircularOrbit(world, v, 'earth', 120000);
  const c = { world, paused: false, network: null } as unknown as FlightController;
  const driver = new LandingPredictionDriver(c);
  vi.advanceTimersByTime(10000);
  expect(FakeWorker.instances).toHaveLength(0);
  const ref = world.universe.ephem.getBodyState('earth', world.ut);
  v.state.velocity = add(ref.velocity, scale(sub(v.state.velocity, ref.velocity), .75));
  vi.advanceTimersByTime(1000);
  const worker = FakeWorker.instances[0];
  expect(FakeWorker.instances).toHaveLength(1);
  expect(worker.messages).toHaveLength(2); // immutable Earth grid, then a craft request
  const request = worker.messages[1] as PlanningRequest;
  expect(request.operation).toBe('landing');
  vi.advanceTimersByTime(10000);
  expect(worker.messages).toHaveLength(2); // no duplicate request while it runs
  v.state.telemetry.thrust = 100;
  worker.onmessage!({ data: { type: 'result', id: request.id, result: {
    vesselId: v.state.id, body: v.body, start: world.ut, points: [], times: [], impact: null, outcome: 'horizon', attitude: 'hold', steps: 0, computeMs: 0, maxChunkMs: 0,
  } } });
  expect(driver.result).toBeNull();
  driver.dispose();
  expect(worker.terminated).toBe(true);
});
