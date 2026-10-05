/** Worker module logic is also executable in-process for Node and protocol tests. */
import { Universe } from '../universe';
import { planTransferToBody } from './transfers';
import { planInterplanetaryTransfer, planCourseCorrectionToBody, porkchopRows } from '../interplanetary';
import type { PlanningWorld } from './context';
import type { PlannerEvent, PlannerMessage, PlanningSnapshot } from './protocol';

export function restorePlanningWorld(snapshot: PlanningSnapshot): PlanningWorld {
  const nodes = snapshot.nodes.map(n => ({ ...n }));
  let id = Math.max(0, ...nodes.map(n => n.id)) + 1;
  return {
    universe: new Universe(snapshot.preset), ut: snapshot.ut,
    active: snapshot.vessel ?? undefined,
    orbitOf: () => { if (!snapshot.vessel) throw new Error('An active vessel is required'); return snapshot.vessel.orbit; },
    relativeState: () => { if (!snapshot.vessel) throw new Error('An active vessel is required'); return snapshot.vessel.state; },
    addNode: time => {
      const node = { id: id++, time, prograde: 0, normal: 0, radial: 0 };
      nodes.push(node); return node;
    },
  };
}

export function createPlannerHandler(send: (event: PlannerEvent) => void, yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))) {
  const active = new Map<number, { cancelled: boolean }>();
  return async (message: PlannerMessage): Promise<void> => {
    if (message.type === 'cancel') {
      const job = active.get(message.id);
      if (job) job.cancelled = true;
      return;
    }
    const { id, snapshot } = message;
    const job = { cancelled: false };
    active.set(id, job);
    const report = (phase: string, fraction: number) => {
      if (!job.cancelled) send({ type: 'progress', id, progress: { phase, fraction } });
    };
    try {
      report('Planning…', 0);
      // Allows an immediate cancellation before even the fallback begins CPU work.
      await yieldTask();
      if (job.cancelled) return;
      const world = restorePlanningWorld(snapshot);
      let result: Extract<PlannerEvent, { type: 'result' }>['result'];
      switch (message.operation) {
        case 'transfer': result = planTransferToBody(world, message.args.target, message.args.options, report); break;
        case 'interplanetary': result = planInterplanetaryTransfer(world, message.args.target, message.args.options, report); break;
        case 'correction': result = planCourseCorrectionToBody(world, message.args.target, message.args.options, report); break;
        case 'porkchop': {
          result = [];
          let index = 0;
          const { from, target, departures, flights } = message.args;
          for (const cells of porkchopRows(world, from, target, departures, flights)) {
            if (job.cancelled) return;
            result.push(...cells);
            send({ type: 'progress', id, progress: { phase: 'Calculating transfer windows', fraction: (index + 1) / (departures.samples ?? 25), row: { index: index++, cells } } });
            await yieldTask();
            if (job.cancelled) return;
          }
          break;
        }
      }
      if (!job.cancelled) { report('Complete', 1); send({ type: 'result', id, result }); }
    } catch (error) {
      if (!job.cancelled) send({ type: 'error', id, name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      active.delete(id);
      if (job.cancelled) send({ type: 'cancelled', id });
    }
  };
}
