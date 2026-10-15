import * as THREE from 'three';
import type { Body } from '../../sim/bodies/types';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { TrajectoryPatch } from '../../sim/orbit/api';
import type { Vec3 } from '../../util/vec3';
import type { MapUpdate, MapPoint } from './mapTypes';
import { patchDrawnNow } from './framing';

/** Shared floating-origin projection and encounter-frame rules for lines, markers and picking. */
export class MapFrame {
  private readonly projected = new THREE.Vector3();
  constructor(private bodies: Map<string, Body>, private ephem: Ephemeris, private camera: THREE.PerspectiveCamera) {}

  scenePosition(p: Vec3, body: string, u: MapUpdate, out = new THREE.Vector3(), time = u.t) {
    const b = this.framedBodyPosition(body, u, time);
    return out.set(b.x + p.x - u.focus.x, b.y + p.y - u.focus.y, b.z + p.z - u.focus.z);
  }

  /** Screen position (CSS px) of a scene-space point; NaN when behind the camera. */
  toScreen(v: THREE.Vector3, u: MapUpdate, out: MapPoint): MapPoint {
    const p = this.projected.copy(v).project(this.camera);
    if (!(p.z < 1 && p.z > -1)) { out.x = out.y = NaN; return out; }
    out.x = (p.x * .5 + .5) * u.viewport.width; out.y = (-p.y * .5 + .5) * u.viewport.height;
    return out;
  }

  private readonly parentOf = (id: string) => this.bodies.get(id)?.parent;

  /**
   * Time at which a patch's central body is placed (see patchDrawnNow). A patch inside an encountered body (a moon,
   * a destination planet, or a later return to the body being left) is drawn around where that body will be at the
   * encounter, so the arc continues from the encounter point instead of jumping to today's position.
   */
  patchFrameTime(u: MapUpdate, patch: TrajectoryPatch | undefined): number {
    const patches = u.vessel?.patches;
    if (!patch || !patches?.length) return u.t;
    const k = patches.indexOf(patch);
    if (k >= 0) return patchDrawnNow(patches, k, u.focusId, this.parentOf) ? u.t : Math.max(u.t, patch.startTime);
    // A patch from an earlier prediction (a drag in progress): present frame if its body is a reference ancestor.
    if (patch.orbit.body === u.focusId) return u.t;
    for (let id: string | undefined = patches[0].orbit.body; id; id = this.parentOf(id)) if (id === patch.orbit.body) return u.t;
    return Math.max(u.t, patch.startTime);
  }

  /**
   * Heliocentric draw position of `body` at `time` in the vessel's frame: the body keeps its offset from the
   * nearest reference ancestor (one of the vessel's current body's parents, or that body itself for a moon of it)
   * at that time, while the ancestor itself stays where it is now. A moon at encounter is drawn where it will be
   * relative to its planet; a later return to the current body, where that body will be relative to its parent.
   */
  framedBodyPosition(body: string, u: MapUpdate, time: number): Vec3 {
    const now = this.ephem.getBodyState(body, u.t).position;
    if (time === u.t) return now;
    const first = u.vessel?.patches[0]?.orbit.body;
    let anchor: string | undefined;
    for (let id: string | undefined = this.parentOf(body); id && !anchor; id = this.bodies.get(id)?.parent)
      for (let ref: string | undefined = first; ref; ref = this.bodies.get(ref)?.parent) if (ref === id) { anchor = id; break; }
    if (!anchor) return now;
    const then = this.ephem.getBodyState(body, time).position, a0 = this.ephem.getBodyState(anchor, time).position, a1 = this.ephem.getBodyState(anchor, u.t).position;
    return { x: a1.x + then.x - a0.x, y: a1.y + then.y - a0.y, z: a1.z + then.z - a0.z };
  }

}
