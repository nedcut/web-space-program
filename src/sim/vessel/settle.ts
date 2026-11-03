import type { Situation, VesselState } from './runtime';

/**
 * Settled situation (DECISIONS "Touchdowns settle before they count as landed").
 *
 * `VesselState.situation` is the raw contact of the last physics step. It chatters: landing legs at rest blip to
 * `flying` for one step every second or two, and a touchdown bounces and rocks for seconds. Physics reads the raw
 * value; game state (flight log, packing, progression, warp, autopilot completion) reads `settledSituation`,
 * which only changes once the raw contact has held:
 * - flying -> landed/splashed after {@link SETTLE_CONTACT_S} of contact, counted across short hops;
 * - landed/splashed -> flying after {@link SETTLE_AIRBORNE_S} without any contact (the 3 s PR #22 used for
 *   career test flights).
 * While grounded, landed <-> splashed follows the raw value at once (driving into water is not a new landing).
 */
export const SETTLE_CONTACT_S = 1;
export const SETTLE_AIRBORNE_S = 3;
const EPS = 1e-9;

export const isGrounded = (s: Situation) => s !== 'flying';

/** `t + dt`, snapped to `limit` once within rounding of it (50 steps of 0.02 s are exactly 1 s). */
const toward = (t: number, dt: number, limit: number) => (t + dt >= limit - EPS ? limit : t + dt);

/** Advance the settled situation by one physics step from the raw `situation` it just produced. Allocation-free. */
export function settleSituation(v: VesselState, dt: number): void {
  if (v.situation === 'flying') {
    v.airborneTime = toward(v.airborneTime, dt, SETTLE_AIRBORNE_S);
    if (v.airborneTime === SETTLE_AIRBORNE_S) {
      v.contactTime = 0;
      v.settledSituation = 'flying';
    }
    return;
  }
  v.airborneTime = 0;
  v.contactTime = toward(v.contactTime, dt, SETTLE_CONTACT_S);
  if (v.settledSituation !== 'flying' || v.contactTime === SETTLE_CONTACT_S) v.settledSituation = v.situation;
}

/**
 * Whether packing puts the vessel on a conic rather than fixing it to the surface. Either kind of contact keeps it
 * on the ground: a resting lander's one-step chatter (settled landed) and a touchdown still settling (raw landed)
 * would otherwise get a ground-crossing conic and be lost.
 */
export const packsOnOrbit = (v: VesselState) => v.situation === 'flying' && v.settledSituation === 'flying';

/** Make `s` the settled situation now (a vessel held by clamps, or a fill-in for a state saved without one). */
export function resetSettled(v: VesselState, s: Situation): void {
  v.settledSituation = s;
  v.airborneTime = isGrounded(s) ? 0 : SETTLE_AIRBORNE_S;
  v.contactTime = isGrounded(s) ? SETTLE_CONTACT_S : 0;
}

/** Place a vessel in situation `s` (spawn, teleport): raw and settled agree, with no settling to wait for. */
export function setSituation(v: VesselState, s: Situation): void {
  v.situation = s;
  resetSettled(v, s);
}
