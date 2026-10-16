import { useEffect, useState } from 'react';
import type { CraftDef } from '../../sim/vessel/types';
import { enqueueIdle } from '../../util/idleQueue';
import { preflightChecks, type PreflightCheck } from '../checks';
import { CATALOG } from '../session';
import type { StageStats } from './dv';
import type { HomeAir } from '../descent';

/** Advisories sample fuel travel/Mach in a worker; superseded craft results never appear. */
export function usePreflightChecks(craft: CraftDef, first?: StageStats, home?: HomeAir) {
  const [result, setResult] = useState<{ craft: CraftDef; first?: StageStats; checks: PreflightCheck[] } | null>(null);
  useEffect(() => {
    let active = true, worker: Worker | undefined;
    let cancelFallback = () => {};
    const finish = (checks: PreflightCheck[]) => { if (active) setResult({ craft, first, checks }); };
    const fallback = () => {
      worker?.terminate();
      cancelFallback = enqueueIdle(() => {
        try { finish(preflightChecks(craft, CATALOG, first, home)); }
        catch { finish([{ id: 'unavailable', text: 'Pre-flight checks unavailable.', uids: [] }]); }
      });
    };
    if (!craft.parts.length) finish([]);
    else {
      try {
        worker = new Worker(new URL('../preflight.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<PreflightCheck[]>) => { worker?.terminate(); finish(event.data); };
        worker.onerror = event => { event.preventDefault(); fallback(); };
        worker.postMessage({ craft, first, home });
      } catch { fallback(); }
    }
    return () => { active = false; worker?.terminate(); cancelFallback(); };
  }, [craft, first, home]);
  const busy = result?.craft !== craft || result?.first !== first;
  return { busy, checks: busy ? [] : result.checks };
}
