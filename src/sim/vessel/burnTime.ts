import type { StageDeltaV } from './staging';
import { burnTimeEstimate } from '../orbit';

/** Executor allowance per activation for separation/ignition/spool-up, seconds. */
export const NODE_STAGE_PAUSE = 1;

/**
 * Full-throttle rocket-equation time across remaining stages, highest number first. Stage readouts supply
 * each stage's own remaining wet mass, thrust and effective Isp after the preceding separation.
 * `pause` also counts unpowered separator stages; an already lit stage has no activation delay.
 * No array copies/sorts: this is also used by the HUD's cached stage readout.
 */
export function stageBurnTime(stages: readonly StageDeltaV[], burning: number, dv: number, pause = 0, lit = true): number {
  if (dv <= 0) return 0;
  if (!Number.isFinite(dv)) return Infinity;
  let left = dv, time = 0, limit = burning;
  while (left > 1e-6) {
    let next: StageDeltaV | undefined;
    for (const s of stages) if (s.stage <= limit && (!next || s.stage > next.stage)) next = s;
    if (!next) break;
    limit = next.stage - 1;
    if (!lit || next.stage < burning) time += pause;
    if (!(next.dv > 0) || !(next.thrust > 0) || !(next.isp > 0) || !(next.startMass > 0)) continue;
    const use = Math.min(left, next.dv);
    time += burnTimeEstimate(use, next.thrust, next.startMass, next.isp);
    left -= use;
  }
  return left > 1e-3 ? Infinity : time;
}
