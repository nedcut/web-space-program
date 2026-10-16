import { PHYSICS_DT } from '../../game/world';
import { remainingManeuverDv } from '../../sim/orbit';
import { qRotate } from '../../util/quat';
import { cross, length, negate, normalize, sub, v3, type Vec3 } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { NavballFrame, NavballMarker } from '../hud/navball';
import type { FlightControllerInternals } from './internals';

type NavballController = Pick<FlightController, 'world' | 'speedMode' | 'mapMode' | 'network'>;
type NavballInternals = Pick<FlightControllerInternals, 'maneuverDirection'>;

/** Navball frame for the active vessel (called by the HUD every animation frame). */
export function navball(this: NavballController, internals: NavballInternals): { frame: NavballFrame; markers: NavballMarker[] } | null {
  const w = this.world;
  const wv = w.active;
  if (!wv) return null;
  const position = wv.state.position;
  if (this.network || this.mapMode) return navballFrame.call(this, internals, position);
  // Same interpolated attitude as the 3D view, so the ball turns smoothly between physics steps.
  const { restore } = w.renderHistory.apply(w.ut, PHYSICS_DT, w.renderAlpha, [wv], w.universe.ephem);
  try {
    return navballFrame.call(this, internals, position);
  } finally {
    restore();
  }
}

function navballFrame(this: NavballController, internals: NavballInternals, position: Vec3): { frame: NavballFrame; markers: NavballMarker[] } | null {
  const wv = this.world.active;
  if (!wv) return null;
  const rs = this.world.relativeState(wv);
  const up = normalize(rs.position);
  const pole = qRotate(this.world.universe.ephem.bodyRotation(wv.body, this.world.ut), v3(0, 0, 1));
  let east = cross(pole, up);
  if (length(east) < 1e-9) east = cross(v3(1, 0, 0), up);
  east = normalize(east);
  const north = cross(up, east);
  const q = wv.state.orientation;
  const forward = qRotate(q, v3(0, 1, 0));
  const top = qRotate(q, v3(0, 0, 1));
  const ts = this.world.targetState();
  const targetMode = this.speedMode === 'target' && !!ts;
  const vel = this.speedMode === 'surface' ? this.world.surfaceVelocity(wv) : targetMode ? sub(wv.state.velocity, ts!.velocity) : rs.velocity;
  const markers: NavballMarker[] = [];
  if (ts) {
    // Both positions must come from the same physics instant. Only our attitude/local horizon is interpolated:
    // subtracting an interpolated own position from a current target can add hundreds of metres of orbital travel.
    const toT = sub(ts.position, position);
    if (length(toT) > 1e-6) {
      const d = normalize(toT);
      markers.push({ kind: 'target', dir: d }, { kind: 'antiTarget', dir: negate(d) });
    }
  }
  if (length(vel) > (targetMode ? 0.005 : 0.5)) {
    const pro = normalize(vel);
    markers.push({ kind: 'prograde', dir: pro }, { kind: 'retrograde', dir: negate(pro) });
    const frame = orbitMarkerFrame(rs.position, rs.velocity);
    if (frame) {
      markers.push({ kind: 'normal', dir: frame.normal }, { kind: 'antinormal', dir: negate(frame.normal) });
      markers.push({ kind: 'radialOut', dir: frame.radialOut }, { kind: 'radialIn', dir: negate(frame.radialOut) });
    }
  }
  const md = internals.maneuverDirection();
  if (md) markers.push({ kind: 'maneuver', dir: md });
  return { frame: { east, north, up, forward, top }, markers };
}


export function maneuverDirection(this: FlightController, _internals: FlightControllerInternals): Vec3 | null {
  const wv = this.world.active;
  const node = this.world.nodes[0];
  if (!wv || !node) return null;
  // The Δv still to burn, in the inertial frame of the node's own point: constant between the plan and the burn, and
  // it turns toward what is left (not the whole node) as the burn progresses.
  try {
    const dv = remainingManeuverDv(this.world.orbitOf(wv), node);
    return length(dv) > 0 ? normalize(dv) : null;
  } catch {
    return null;
  }
}


/** Orbit normal and radial-out marker directions; matches the SAS normal / radial-out targets. */
export function orbitMarkerFrame(r: Vec3, v: Vec3): { normal: Vec3; radialOut: Vec3 } | null {
  const h = cross(r, v);
  if (!(length(h) > 0)) return null;
  const normal = normalize(h);
  // v × h points away from the body (same construction as SAS 'radialOut').
  return { normal, radialOut: normalize(cross(normalize(v), normal)) };
}
