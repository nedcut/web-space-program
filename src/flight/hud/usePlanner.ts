import { useCallback, useEffect, useRef, useState } from 'react';
import type { World } from '../../game/world';
import { planningSnapshot, requestPlan } from '../../game/planning/client';
import type { PlanningOperation, PlanningOperations, PlanningProgress } from '../../game/planning/protocol';

export function usePlanner(world: World) {
  const active = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<PlanningProgress | null>(null);
  const cancel = useCallback(() => { active.current?.abort(); active.current = null; setProgress(null); }, []);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [world]);
  const run = useCallback(async <K extends PlanningOperation>(operation: K, args: PlanningOperations[K]['args'], onProgress?: (event: PlanningProgress) => void) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const snapshot = planningSnapshot(world);
    setProgress({ phase: 'Planning…', fraction: 0 });
    try {
      const task = requestPlan(operation, snapshot, args, { signal: controller.signal, onProgress: event => {
        if (active.current !== controller) return;
        setProgress(event); onProgress?.(event);
      } });
      const result = await task.result;
      if (controller.signal.aborted) throw Object.assign(new Error('Planning cancelled'), { name: 'AbortError' });
      return { snapshot, result };
    } finally {
      if (active.current === controller) { active.current = null; setProgress(null); }
    }
  }, [world]);
  return { run, cancel, progress };
}
