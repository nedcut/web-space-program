import type { VesselState } from '../sim/vessel/runtime';
import { computeStageDeltaV, type StageDeltaV } from '../sim/vessel/staging';

const cache = new WeakMap<VesselState, { topology: VesselState['cache']; key: string; value: StageDeltaV[] }>();
/** Exact readout cache. Definitions/resource densities are immutable; rebuildTopology replaces cache.
 * No rounding: burning, staging, crew transfer and pressure changes invalidate immediately.
 * EC is massless and only affects the burn simulation when an engine consumes it. */
export function cachedStageDeltaV(v: VesselState, pressure: number, gravity: number): StageDeltaV[] {
  const usesCharge = v.parts.some(p => p.def.modules.some(m => m.type === 'engine' && !!m.propellants.electricCharge));
  const key = JSON.stringify([pressure, gravity, v.nextStage, v.rootUid, v.mass, v.parts.map(p => [
    p.uid, p.partId, p.parent, p.attachNode, p.parentNode, p.stage, p.activated, p.crew, p.tweaks, p.actions?.stage,
    p.engine?.moduleIndex, p.engine?.ignited, p.engine?.ignitionsLeft,
    Object.entries(p.resources).filter(([id]) => usesCharge || id !== 'electricCharge'),
  ])]);
  const hit = cache.get(v);
  if (hit?.topology === v.cache && hit.key === key) return hit.value;
  const value = computeStageDeltaV(v, pressure, gravity);
  cache.set(v, { topology: v.cache, key, value });
  return value;
}
