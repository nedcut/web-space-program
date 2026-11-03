import type { Orbit } from '../../sim/orbit/api';
import type { Quat } from '../../util/quat';
import type { Vec3 } from '../../util/vec3';
import type { WorldVessel } from '../world';

/** Landed/prelaunch: position + attitude fixed in the body's rotating frame. */
export type FixedPose = { pos: Vec3; orient: Quat };

/**
 * Pad hold-down clamps (prelaunch only). The vessel is simulated (engines burn propellant and make thrust) but
 * pinned to `fixed`.
 * - `launch: false` — a static fire: an engine was lit from the pad (part action or action group). The clamps hold
 *   for as long as an engine burns and never let go on their own; staging turns it into a launch hold.
 * - `launch: true` — the launch stage fired: the clamps let go at liftoff thrust, when thrust settles below
 *   weight, or after HOLD_DOWN_MAX seconds (see World.stepHoldDown).
 * `time` is seconds since the launch hold began, `thrust` the thrust at the previous step and `com` the
 * build-frame centre of mass at the last pin. Saved with the vessel.
 */
export interface HoldDown { launch: boolean; time: number; thrust: number; com: Vec3 }

/** Every legal combination of a vessel's mode and its mode-specific fields. */
export type VesselModeState =
  | { mode: 'physics' }
  | { mode: 'rails'; orbit: Orbit }
  | { mode: 'landedRails'; fixed: FixedPose }
  | { mode: 'prelaunch'; fixed: FixedPose; holdDown?: HoldDown };

/**
 * The one place a vessel changes mode. Clears the fields the new mode does not use, so `orbit` is present iff
 * rails, `fixed` iff landedRails/prelaunch, and `holdDown` only in prelaunch.
 */
export function setVesselMode(wv: WorldVessel, next: VesselModeState): void {
  wv.mode = next.mode;
  wv.orbit = next.mode === 'rails' ? next.orbit : undefined;
  wv.fixed = next.mode === 'landedRails' || next.mode === 'prelaunch' ? next.fixed : undefined;
  wv.holdDown = next.mode === 'prelaunch' ? next.holdDown : undefined;
  if (next.mode !== 'rails') { wv.railsEvent = undefined; wv.precise = undefined; }
}

/** Broken mode invariants of a vessel (empty when consistent). For tests and the fuzzer, not per frame. */
export function vesselModeProblems(wv: WorldVessel): string[] {
  const out: string[] = [];
  const rails = wv.mode === 'rails', pinned = wv.mode === 'landedRails' || wv.mode === 'prelaunch';
  if (rails !== !!wv.orbit) out.push(`orbit ${wv.orbit ? 'set' : 'missing'} in ${wv.mode}`);
  if (pinned !== !!wv.fixed) out.push(`fixed ${wv.fixed ? 'set' : 'missing'} in ${wv.mode}`);
  if (wv.holdDown && wv.mode !== 'prelaunch') out.push(`holdDown set in ${wv.mode}`);
  if (!rails && (wv.railsEvent || wv.precise)) out.push(`rails data set in ${wv.mode}`);
  // A lit engine on the pad is always simulated under the clamps (static fire or launch), never frozen.
  if (wv.mode === 'prelaunch' && !wv.holdDown && !wv.state.destroyed && wv.state.parts.some(p => p.engine?.ignited)) out.push('lit engine on the pad without hold-down');
  return out;
}
