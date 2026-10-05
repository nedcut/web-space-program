import { useLayoutEffect } from 'react';
import { frameProfiler as prof } from '../../util/frameProfiler';

/**
 * Attributes a component's render + commit time (from its render body to its layout effects,
 * so children are included) to the profiler's `hud` section.
 */
export function useRenderProfile(): void {
  const start = prof.now();
  useLayoutEffect(() => { if (start) prof.add('hud', start); });
}
