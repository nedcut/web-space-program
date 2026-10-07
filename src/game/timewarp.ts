/**
 * Time warp policy. Rails warp propagates vessels on Keplerian orbits (exact at any rate);
 * physics warp runs extra fixed physics steps per frame (allowed while thrusting / in atmosphere).
 */
export const RAILS_WARP = [1, 5, 10, 50, 100, 1_000, 10_000, 100_000, 1_000_000] as const;
export const PHYSICS_WARP = [1, 2, 3, 4] as const;

export interface WarpState {
  mode: 'rails' | 'physics';
  index: number;
}

export const warpRate = (w: WarpState) => (w.mode === 'rails' ? RAILS_WARP[w.index] : PHYSICS_WARP[w.index]);

export const warpLabel = (w: WarpState) => {
  const r = warpRate(w);
  return r >= 1000 ? `${r / 1000}k×` : `${r}×`;
};

/**
 * Minimum altitude above the datum required for each rails warp level, as a fraction of body radius
 * (capped at standard Earth's radius). Rails propagation resolves atmosphere, terrain and SOI events
 * independently of frame size; full-size planets must not force weeks of parking-orbit waits at 50×.
 */
const RAILS_CLEARANCE = [0, 0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.5, 2];
const railsClearance = (bodyRadius: number) => RAILS_CLEARANCE.map((f) => f * Math.min(bodyRadius, 637100));

export function maxRailsIndexAt(altitude: number, bodyRadius: number, atmosphereHeight: number): number {
  if (altitude < atmosphereHeight) return 0;
  const clearance = altitude - atmosphereHeight;
  const limits = railsClearance(bodyRadius);
  let idx = 0;
  for (let i = 0; i < limits.length; i++) if (clearance >= limits[i]) idx = i;
  return idx;
}

export interface WarpContext {
  /** Engines producing thrust or player commanding throttle > 0. */
  thrusting: boolean;
  inAtmosphere: boolean;
  landed: boolean;
  altitude: number;
  bodyRadius: number;
  atmosphereHeight: number;
}

/** Step warp up/down. Rails warp is refused while thrusting / in atmosphere → physics warp instead. */
export function stepWarp(w: WarpState, delta: number, ctx: WarpContext): WarpState {
  const canRails = !ctx.thrusting && (!ctx.inAtmosphere || ctx.landed);
  if (w.mode === 'physics' || (!canRails && w.index === 0)) {
    if (canRails && delta > 0 && w.mode === 'physics' && w.index === 0) return { mode: 'rails', index: 1 };
    if (!canRails || w.mode === 'physics') {
      const idx = Math.max(0, Math.min(PHYSICS_WARP.length - 1, w.index + delta));
      return { mode: idx === 0 && canRails ? 'rails' : 'physics', index: idx };
    }
  }
  const maxIdx = ctx.landed ? RAILS_WARP.length - 1 : maxRailsIndexAt(ctx.altitude, ctx.bodyRadius, ctx.atmosphereHeight);
  const idx = Math.max(0, Math.min(maxIdx, w.index + delta));
  return { mode: 'rails', index: idx };
}

/** Clamp an existing warp when conditions change (e.g. descending toward a body). */
export function clampWarp(w: WarpState, ctx: WarpContext): WarpState {
  if (w.mode !== 'rails' || w.index === 0) return w;
  if (ctx.thrusting) return { mode: 'rails', index: 0 };
  const maxIdx = ctx.landed ? RAILS_WARP.length - 1 : maxRailsIndexAt(ctx.altitude, ctx.bodyRadius, ctx.atmosphereHeight);
  return w.index > maxIdx ? { mode: 'rails', index: maxIdx } : w;
}

const km = (m: number) => (m >= 10_000 ? `${Math.round(m / 1000).toLocaleString('en-US')} km` : `${(m / 1000).toFixed(1)} km`);

/**
 * Why a warp-up request (`delta` > 0) from `w` produced `next`, for the player: null when it went up as asked or
 * there is nothing to explain. A switch to physics warp is reported too (it is a different kind of warp).
 */
export function warpRefusal(w: WarpState, next: WarpState, ctx: WarpContext): { text: string; level: 'info' | 'warn' } | null {
  const reason = ctx.thrusting ? 'engines are firing' : ctx.inAtmosphere && !ctx.landed ? 'in the atmosphere' : null;
  if (next.mode === 'physics') {
    if (w.mode === 'physics' && next.index === w.index) return { text: `Physics warp is at its ${warpLabel(next)} maximum${reason ? ` (${reason})` : ''}`, level: 'warn' };
    return w.mode === 'rails' ? { text: `Physics warp ${warpLabel(next)}: ${reason ?? 'rails warp unavailable'}`, level: 'info' } : null;
  }
  if (next.index > w.index || w.mode !== 'rails') return null;
  if (next.index >= RAILS_WARP.length - 1) return { text: `Time warp is at its ${warpLabel(next)} maximum`, level: 'info' };
  if (reason) return { text: `Cannot warp faster: ${reason}`, level: 'warn' };
  const want = RAILS_WARP[next.index + 1];
  const need = ctx.atmosphereHeight + railsClearance(ctx.bodyRadius)[next.index + 1];
  return { text: `Cannot warp to ${want >= 1000 ? `${want / 1000}k` : want}× below ${km(need)} altitude`, level: 'warn' };
}
