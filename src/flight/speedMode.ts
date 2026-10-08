import type { World, WorldVessel } from '../game/world';

export type SpeedMode = 'surface' | 'orbit' | 'target';
export type SpeedSelection = SpeedMode | 'auto';

/** Airless reference altitude is 1% of radius; switch at five times that height. */
export function orbitSpeedAltitude(radius: number, atmosphereHeight: number): number {
  return atmosphereHeight > 0 ? atmosphereHeight : radius * 0.05;
}

/** Allocation-free policy, shared by SAS, navball markers and the numeric readout. */
export class SpeedModeTracker {
  mode: SpeedMode = 'surface';
  selection: SpeedSelection = 'auto';
  private context = '';
  private body = '';
  private orbital = false;
  private nearby = false;

  select(mode: SpeedSelection) { this.selection = mode; if (mode !== 'auto') this.mode = mode; }
  cycle(hasTarget: boolean) {
    this.select(this.selection === 'auto' ? 'surface' : this.selection === 'surface' ? 'orbit'
      : this.selection === 'orbit' && hasTarget ? 'target' : 'auto');
  }

  update(vessel: string, body: string, altitude: number, boundary: number, onSurface: boolean, hasTarget: boolean, vesselDistance = Infinity): SpeedMode {
    if (vessel !== this.context || body !== this.body) {
      // A new vessel / SOI gets its own reference frame, including after loading a save.
      if (this.context) this.selection = 'auto';
      this.context = vessel; this.body = body;
      this.orbital = altitude >= boundary; this.nearby = false;
    }
    // Descending hysteresis prevents chatter at the atmospheric / airless boundary.
    this.orbital = !onSurface && altitude >= boundary * (this.orbital ? 0.95 : 1);
    this.nearby = hasTarget && vesselDistance < (this.nearby ? 2500 : 2000);
    if (this.selection === 'target' && !hasTarget) this.selection = 'auto';
    this.mode = this.selection !== 'auto' ? this.selection : onSurface ? 'surface' : this.nearby ? 'target' : this.orbital ? 'orbit' : 'surface';
    return this.mode;
  }

  /** Scalar radial math only: no vectors, terrain sampling or per-frame object creation. */
  updateWorld(w: World, v: WorldVessel) {
    const b = w.universe.body(v.body), p = v.state.position;
    const origin = w.universe.ephem.getBodyState(v.body, w.ut).position;
    const target = w.targetId ? w.vessels.get(w.targetId) : undefined;
    const t = target?.state.position;
    this.update(v.state.id, v.body, Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) - b.radius,
      orbitSpeedAltitude(b.radius, b.atmosphere?.height ?? 0), v.mode === 'prelaunch' || v.state.situation !== 'flying',
      !!w.targetId, t && target.body === v.body ? Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) : Infinity);
  }
}
