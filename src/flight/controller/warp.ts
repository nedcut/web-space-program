import { PHYSICS_WARP, RAILS_WARP, warpRate } from '../../game/timewarp';
import type { World } from '../../game/world';
import { warpIndexFor } from '../assist';

/**
 * Time-warp feel: a short ramp when the warp rate goes up (the world accelerates instead of jumping), and
 * "warp to" targets (next maneuver node, apoapsis, periapsis, SOI change) that pick the fastest safe rate and
 * come back to 1× just before the event. Rails events and clamps in World still apply on top of this.
 */
export type WarpTargetId = 'node' | 'ap' | 'pe' | 'soi';

export interface WarpTargetOption {
  id: WarpTargetId;
  label: string;
  /** UT the warp should stop at (already includes the lead margin). */
  time: number;
}

const LEAD: Record<WarpTargetId, number> = { node: 30, ap: 15, pe: 15, soi: 5 };
const LABEL: Record<WarpTargetId, string> = { node: 'Maneuver', ap: 'Apoapsis', pe: 'Periapsis', soi: 'SOI change' };
/** Log-space ramp time constant when the selected rate increases. */
export const WARP_RAMP_TAU = 0.25;

/** Warp targets that make sense for the active vessel right now. */
export function warpTargets(world: World): WarpTargetOption[] {
  const wv = world.active;
  if (!wv || wv.mode === 'prelaunch' || wv.state.situation !== 'flying' || wv.state.eva) return [];
  const out: WarpTargetOption[] = [];
  const now = world.ut;
  const add = (id: WarpTargetId, t: number) => {
    const time = t - LEAD[id];
    if (Number.isFinite(time) && time > now + 2) out.push({ id, label: LABEL[id], time });
  };
  const node = world.nodes.filter((n) => n.time > now).sort((a, b) => a.time - b.time)[0];
  if (node) add('node', node.time);
  try {
    const o = world.orbitSummary(wv);
    if (o.orbit.e < 1 && o.ap > 0) add('ap', now + o.timeToAp);
    if (o.pe > (world.universe.body(wv.body).atmosphere?.height ?? 0)) add('pe', now + o.timeToPe);
  } catch {
    /* degenerate orbit */
  }
  const soi = world.trajectory().find((p) => p.endReason === 'soiExit' || p.endReason === 'soiEnter');
  if (soi) add('soi', soi.endTime);
  return out;
}

export class WarpDriver {
  target: { id: WarpTargetId; label: string; time: number; vessel: string } | null = null;
  private effective = 1;

  start(world: World, id: WarpTargetId): string | null {
    const t = warpTargets(world).find((o) => o.id === id);
    if (!t || !world.active) return `Nothing to warp to`;
    if (world.active.state.telemetry.thrust > 0) return 'Cut throttle before warping';
    this.target = { ...t, vessel: world.active.state.id };
    return null;
  }

  cancel(world: World, message?: string) {
    if (!this.target) return;
    this.target = null;
    world.warp = { mode: 'rails', index: 0 };
    if (message) world.message(message, 'info', 2.5);
  }

  /** Called once per frame before World.tick: steer the warp index towards the target. */
  drive(world: World, dt: number) {
    const t = this.target;
    if (!t) return;
    if (world.activeId !== t.vessel || !world.active || world.active.state.telemetry.thrust > 0) return this.cancel(world, 'Warp stopped');
    const remaining = t.time - world.ut;
    if (remaining <= 0.5) {
      this.target = null;
      world.warp = { mode: 'rails', index: 0 };
      world.message(`Arrived: ${t.label}`, 'info', 2.5);
      return;
    }
    // Plan with a realistic frame time so the last frame never jumps past the stop point.
    // Inside an atmosphere rails warp is refused; coast on the fastest physics warp instead.
    if (world.warpContext().inAtmosphere) world.warp = { mode: 'physics', index: PHYSICS_WARP.length - 1 };
    else world.warp = { mode: 'rails', index: Math.min(RAILS_WARP.length - 1, warpIndexFor(remaining, Math.max(dt, 1 / 30))) };
  }

  /**
   * Real seconds to hand World.tick. When the selected rails rate rises, the effective rate eases up in log
   * space instead of jumping (e.g. 1× → 1000× over ~1 s); slowing down and physics warp are immediate.
   */
  rampDt(world: World, dt: number): number {
    const rate = world.warp.mode === 'rails' ? warpRate(world.warp) : 1;
    if (rate <= 1 || rate < this.effective) {
      this.effective = rate;
      return dt;
    }
    const k = 1 - Math.exp(-dt / WARP_RAMP_TAU);
    this.effective = Math.exp(Math.log(this.effective) + (Math.log(rate) - Math.log(this.effective)) * k);
    if (this.effective > rate * 0.98) this.effective = rate;
    return dt * (this.effective / rate);
  }

  /** Current effective warp multiplier (for the HUD). */
  get effectiveRate() {
    return this.effective;
  }
}
