import '../earth-data/register';
/** Main-thread event-loop proxy using the actual production Web Worker bundle in worker_threads.
 * Run npm run build first, then npx tsx scripts/bench/planning-node.ts.
 * Browser benchmark (Long Tasks API) lives beside this in planning.ts.
 */
import { Worker as NodeWorker } from 'node:worker_threads';
import { readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Universe } from '../../src/game/universe';
import { stateToElements } from '../../src/sim/orbit';
import { v3 } from '../../src/util/vec3';
import { restorePlanningWorld } from '../../src/game/planning/handler';
import { planTransferToBody } from '../../src/game/planning/transfers';
import { porkchopGrid } from '../../src/game/interplanetary';
import { requestPlan } from '../../src/game/planning/client';
import type { PlanningSnapshot, PlannerEvent, PlannerMessage } from '../../src/game/planning/protocol';
import type { ScalePresetId } from '../../src/sim/bodies';

const assets = new URL('../../dist/assets/', import.meta.url);
const bundle = (await readdir(assets)).find(name => name.startsWith('planner.worker-'))!;
if (!bundle) throw new Error('Run npm run build first');
const source = `import { parentPort, workerData } from 'node:worker_threads';
  globalThis.self = { postMessage: data => parentPort.postMessage(data) };
  await import(workerData);
  parentPort.on('message', data => self.onmessage({ data }));`;
class WorkerBridge {
  onmessage?: (event: { data: PlannerEvent }) => void;
  onerror?: (event: { message: string }) => void;
  private worker = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(source)), { workerData: new URL(bundle, assets).href });
  constructor() {
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(message: PlannerMessage) { this.worker.postMessage(message); }
  terminate() { void this.worker.terminate(); }
}
Object.defineProperty(globalThis, 'Worker', { value: WorkerBridge, configurable: true });
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function measure(preset: ScalePresetId, operation: 'moon' | 'saturn', worker: boolean) {
  const universe = new Universe(preset), b = universe.body('earth');
  const ut = (Date.UTC(2030, 6, 20, 12) - Date.UTC(2000, 0, 1, 12)) / 1000;
  const r = b.radius + (preset === 'real' ? 220000 : 120000), position = v3(r, 0, 0);
  const velocity = v3(0, Math.sqrt(b.gm / r) * Math.cos(0.5), Math.sqrt(b.gm / r) * Math.sin(0.5));
  const snapshot: PlanningSnapshot = { preset, ut, nodes: [], vessel: { id: 'bench', body: 'earth', state: { position, velocity }, orbit: stateToElements(b.gm, 'earth', position, velocity, ut) } };
  const target = universe.body('saturn'), mu = universe.body('sun').gm;
  const tof = Math.PI * Math.sqrt(((b.orbit!.a + target.orbit!.a) / 2) ** 3 / mu);
  const span = 2 * Math.PI / Math.abs(Math.sqrt(mu / b.orbit!.a ** 3) - Math.sqrt(mu / target.orbit!.a ** 3));
  const args = { from: 'earth', target: 'saturn', departures: { min: ut + 600, max: ut + 600 + span, samples: 36 }, flights: { min: tof * 0.65, max: tof * 1.35, samples: 36 } };
  const world = restorePlanningWorld(snapshot);
  let last = performance.now(), maxTimerGapMs = 0, heartbeats = 0, rows = 0;
  const timer = setInterval(() => { const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - last); last = now; heartbeats++; }, 4);
  await pause(20); last = performance.now(); maxTimerGapMs = 0; heartbeats = 0;
  const start = performance.now();
  let dispatchMs: number, success: boolean;
  if (worker) {
    const options = { onProgress: (event: { row?: unknown }) => { if (event.row) rows++; } };
    const task = operation === 'moon' ? requestPlan('transfer', snapshot, { target: 'moon' }, options) : requestPlan('porkchop', snapshot, args, options);
    dispatchMs = performance.now() - start; success = !!(await task.result);
  } else {
    success = !!(operation === 'moon' ? planTransferToBody(world, 'moon') : porkchopGrid(world, 'earth', 'saturn', args.departures, args.flights));
    dispatchMs = performance.now() - start;
  }
  const elapsedMs = performance.now() - start, duringWork = heartbeats;
  await pause(20); clearInterval(timer);
  return { preset, operation, worker, dispatchMs, elapsedMs, maxTimerGapMs, heartbeatsDuringWork: duringWork, rows, success };
}
const results = [];
for (const preset of ['standard', 'real'] as const) for (const operation of ['moon', 'saturn'] as const) {
  // One warm-up before three alternating before/after measurements.
  await measure(preset, operation, false);
  for (let trial = 1; trial <= 3; trial++) for (const worker of [false, true]) {
    const result = { trial, ...await measure(preset, operation, worker) };
    results.push(result); console.log(JSON.stringify(result));
  }
}
await writeFile(new URL('../../docs/performance/planning.json', import.meta.url), JSON.stringify({ node: process.version, bundle, results }, null, 2) + '\n');
