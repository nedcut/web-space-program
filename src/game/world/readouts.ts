import { apoapsisRadius, periapsisRadius, stateToElements, timeToApoapsis, timeToPeriapsis } from '../../sim/orbit';
import type { Orbit, StateVector } from '../../sim/orbit/api';
import { dot, length, normalize, sub, type Vec3 } from '../../util/vec3';
import { type WarpContext } from '../timewarp';
import type { World, WorldVessel } from '../world';


export function relativeState(this: World, wv: WorldVessel, t = this.ut): StateVector {
  const bs = this.universe.ephem.getBodyState(wv.body, t);
  return { position: sub(wv.state.position, bs.position), velocity: sub(wv.state.velocity, bs.velocity) };
}


export function orbitOf(this: World, wv: WorldVessel): Orbit {
  if (wv.mode === 'rails' && wv.orbit) return wv.orbit;
  const rs = this.relativeState(wv);
  return stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
}


export function warpContext(this: World): WarpContext {
  const wv = this.active;
  if (!wv) return { thrusting: false, inAtmosphere: false, landed: true, altitude: 1e9, bodyRadius: 1, atmosphereHeight: 0 };
  const b = this.universe.body(wv.body);
  const alt = length(this.relativeState(wv).position) - b.radius;
  const thrusting = wv.state.telemetry.thrust > 0;
  return {
    thrusting,
    inAtmosphere: !!b.atmosphere && alt < b.atmosphere.height,
    landed: wv.state.situation !== 'flying' || wv.mode === 'prelaunch',
    altitude: alt,
    bodyRadius: b.radius,
    atmosphereHeight: b.atmosphere?.height ?? 0,
    // Read the existing packed orbit; never solve another orbit/prediction in the frame loop.
    orbitClear: !this.preciseGravity && wv.mode === 'rails' && !!wv.orbit && periapsisRadius(wv.orbit) > b.radius
      + Math.max(b.atmosphere?.height ?? 0, b.solidSurface ? this.universe.terrain(b.id).maxHeight : 0),
  };
}

/** Orbit summary for HUD. */
export function orbitSummary(this: World, wv: WorldVessel) {
  const b = this.universe.body(wv.body);
  const o = this.orbitOf(wv);
  return {
    orbit: o,
    ap: apoapsisRadius(o) - b.radius,
    pe: periapsisRadius(o) - b.radius,
    timeToAp: timeToApoapsis(o, this.ut),
    timeToPe: timeToPeriapsis(o, this.ut),
  };
}

/** Dot helper used by HUD (vertical speed). */
export function verticalSpeed(this: World, wv: WorldVessel): number {
  const rs = this.relativeState(wv);
  return dot(rs.velocity, normalize(rs.position));
}


export function surfaceVelocity(this: World, wv: WorldVessel): Vec3 {
  const rs = this.relativeState(wv);
  return sub(rs.velocity, this.universe.ephem.surfaceVelocity(wv.body, rs.position, this.ut));
}
