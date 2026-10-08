import { useLayoutEffect } from 'react';
import { frameProfiler as prof } from '../../util/frameProfiler';

/** Start of the outermost profiled render in progress (0 when none), so nested profiled components count once. */
let outer = 0;

/**
 * Attributes a component's render + commit time (from its render body to its layout effects,
 * so children are included) to the profiler's `hud` section. A profiled component rendered inside
 * another's pass is already included in that pass and is not added again.
 */
export function useRenderProfile(): void {
  const t = prof.now();
  // A pass that never committed (discarded render) must not suppress measurement indefinitely.
  const nested = outer !== 0 && t - outer < 100;
  const start = nested ? 0 : t;
  if (start) outer = start;
  useLayoutEffect(() => { if (start) { prof.add('hud', start); if (outer === start) outer = 0; } });
}
