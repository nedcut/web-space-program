import { loadEarthData } from '../../src/game/earthLoader';
/** Browser-only benchmark. Serve with Vite; import /scripts/bench/planning.ts in a blank same-origin page. */
import { Universe } from '../../src/game/universe';
import { stateToElements } from '../../src/sim/orbit';
import { v3 } from '../../src/util/vec3';
import { restorePlanningWorld } from '../../src/game/planning/handler';
import { planTransferToBody } from '../../src/game/planning/transfers';
import { porkchopGrid } from '../../src/game/interplanetary';
import { requestPlan } from '../../src/game/planning/client';
import type { PlanningSnapshot } from '../../src/game/planning/protocol';
import type { ScalePresetId } from '../../src/sim/bodies';

const pause = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function benchmarkPlanning(preset: ScalePresetId, operation: 'moon' | 'saturn', worker: boolean) {
  await loadEarthData();
  const universe = new Universe(preset), b = universe.body('earth');
  const ut = (Date.UTC(2030, 6, 20, 12) - Date.UTC(2000, 0, 1, 12)) / 1000;
  const radius = b.radius + (preset === 'real' ? 220000 : 120000);
  const position = v3(radius, 0, 0), velocity = v3(0, Math.sqrt(b.gm / radius) * Math.cos(0.5), Math.sqrt(b.gm / radius) * Math.sin(0.5));
  const snapshot: PlanningSnapshot = { preset, ut, nodes: [], vessel: { id: 'benchmark', body: 'earth',
    orbit: stateToElements(b.gm, 'earth', position, velocity, ut), state: { position, velocity } } };
  const a = universe.body('earth'), target = universe.body('saturn'), mu = universe.body('sun').gm;
  const tof = Math.PI * Math.sqrt(((a.orbit!.a + target.orbit!.a) / 2) ** 3 / mu);
  const span = 2 * Math.PI / Math.abs(Math.sqrt(mu / a.orbit!.a ** 3) - Math.sqrt(mu / target.orbit!.a ** 3));
  const args = { from: 'earth', target: 'saturn', departures: { min: ut + 600, max: ut + 600 + span, samples: 36 }, flights: { min: tof * 0.65, max: tof * 1.35, samples: 36 } };
  const world = restorePlanningWorld(snapshot);
  let last = performance.now(), maxTimerGapMs = 0, heartbeats = 0, rows = 0;
  const timer = setInterval(() => { const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - last); last = now; heartbeats++; }, 4);
  const longTasks: number[] = [];
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration); });
  observer.observe({ type: 'longtask' });
  await pause(20);
  maxTimerGapMs = 0; heartbeats = 0; last = performance.now();
  const start = performance.now();
  let dispatchMs: number, success: boolean;
  if (worker) {
    const options = { onProgress: (event: { row?: unknown }) => { if (event.row) rows++; } };
    const task = operation === 'moon' ? requestPlan('transfer', snapshot, { target: 'moon' }, options) : requestPlan('porkchop', snapshot, args, options);
    dispatchMs = performance.now() - start;
    success = !!(await task.result);
  } else {
    success = !!(operation === 'moon' ? planTransferToBody(world, 'moon') : porkchopGrid(world, 'earth', 'saturn', args.departures, args.flights));
    dispatchMs = performance.now() - start;
  }
  const elapsedMs = performance.now() - start;
  await pause(20);
  clearInterval(timer); observer.disconnect();
  return { preset, operation, worker, dispatchMs, elapsedMs, maxTimerGapMs, maxLongTaskMs: Math.max(0, ...longTasks), heartbeats, rows, success };
}
