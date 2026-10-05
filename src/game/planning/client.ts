import type { World } from '../world';
import type { PlannerEvent, PlanningOperation, PlanningOperations, PlanningProgress, PlanningRequest, PlanningSnapshot } from './protocol';

export interface PlanningTask<T> { id: number; result: Promise<T>; cancel(): void }
let nextId = 1;
export function planningSnapshot(world: World): PlanningSnapshot {
  const vessel = world.active;
  return structuredClone({ preset: world.universe.preset, activatedAsteroids: [...world.universe.activatedAsteroids], ut: world.ut, nodes: world.nodes,
    vessel: vessel ? { id: vessel.state.id, body: vessel.body, orbit: world.orbitOf(vessel), state: world.relativeState(vessel) } : null });
}

/** Each request owns a worker: terminate interrupts even a synchronous simplex search immediately.
 * No-Worker hosts use the identical protocol; their transfer refinement remains synchronous.
 */
export function requestPlan<K extends PlanningOperation>(operation: K, snapshot: PlanningSnapshot, args: PlanningOperations[K]['args'],
  options: { signal?: AbortSignal; onProgress?: (progress: PlanningProgress) => void } = {}): PlanningTask<PlanningOperations[K]['result']> {
  const id = nextId++;
  const request = { type: 'plan', id, operation, snapshot, args } as PlanningRequest;
  let worker: Worker | undefined;
  let fallback: Awaited<ReturnType<typeof import('./handler')['createPlannerHandler']>> | undefined;
  let settled = false;
  let rejectResult: (error: Error) => void;
  const cleanup = () => { worker?.terminate(); options.signal?.removeEventListener('abort', cancel); };
  const cancel = () => {
    if (settled) return;
    settled = true;
    if (fallback) void fallback({ type: 'cancel', id });
    cleanup();
    rejectResult(Object.assign(new Error('Planning cancelled'), { name: 'AbortError' }));
  };
  const result = new Promise<PlanningOperations[K]['result']>((resolve, reject) => {
    rejectResult = reject;
    const receive = (event: PlannerEvent) => {
      if (settled || event.id !== id) return;
      if (event.type === 'progress') { options.onProgress?.(event.progress); return; }
      if (event.type === 'cancelled') { cancel(); return; }
      settled = true; cleanup();
      if (event.type === 'error') reject(Object.assign(new Error(event.message), { name: event.name }));
      else resolve(event.result as PlanningOperations[K]['result']);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) { cancel(); return; }
    try {
      if (typeof Worker !== 'undefined') {
        worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<PlannerEvent>) => receive(event.data);
        worker.onerror = event => receive({ type: 'error', id, name: 'Error', message: event.message || 'Planning worker failed' });
        worker.onmessageerror = () => receive({ type: 'error', id, name: 'Error', message: 'Invalid planning worker response' });
        worker.postMessage(request);
      } else {
        // Isolate the fallback just like structured clone in postMessage.
        const copy = structuredClone(request);
        void import('./handler').then(({ createPlannerHandler }) => {
          if (settled) return;
          fallback = createPlannerHandler(receive);
          return fallback(copy);
        }).catch(error => receive({ type: 'error', id, name: 'Error', message: String(error) }));
      }
    } catch (error) { receive({ type: 'error', id, name: 'Error', message: String(error) }); }
  });
  return { id, result, cancel };
}
