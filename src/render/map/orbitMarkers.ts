/**
 * Pure orbit-marker extraction for the map: apsides on every trajectory patch, SOI encounters/escapes with the
 * periapsis inside the encountered body, impacts and atmosphere entries. No three.js or DOM, so it is unit tested.
 * Positions are relative to `body` (the patch's central body), like the patches themselves.
 */
import type { TrajectoryPatch } from '../../sim/orbit/api';
import { elementsToState, period, periapsisRadius, timeToApoapsis, timeToPeriapsis } from '../../sim/orbit/kepler';
import { patchState } from '../../sim/orbit/numericalPrediction';
import { formatDistance, formatDuration } from '../../util/format';
import { length, type Vec3 } from '../../util/vec3';

export type OrbitMarkerKind = 'ap' | 'pe' | 'encounter' | 'escape' | 'impact' | 'atmosphere';

export interface OrbitMarker {
  /** Stable identity across frames (used to keep a label pinned). */
  key: string;
  kind: OrbitMarkerKind;
  body: string;
  position: Vec3;
  time: number;
  /** Altitude above `body` for apsides; periapsis altitude inside `other` for encounters. */
  altitude: number;
  /** True for patches after the first maneuver node (the planned trajectory). */
  planned: boolean;
  /** Encountered/escaped body. */
  other?: string;
  /** Index of the trajectory patch the marker sits on (its colour family). */
  patch: number;
}

/** Whether a patch is drawn as its full conic (closed ellipse) rather than the arc it actually spans. */
export function patchDrawnClosed(p: TrajectoryPatch): boolean {
  if (p.samples || p.orbit.e >= 1) return false;
  const T = period(p.orbit);
  return p.endReason === 'horizon' || p.endReason === 'maneuver' || p.endTime - p.startTime > T;
}

/** Index of the first patch after the first maneuver node (patches.length when there is none). */
export function firstPlannedPatch(patches: readonly TrajectoryPatch[]): number {
  for (let i = 0; i < patches.length; i++) if (patches[i].endReason === 'maneuver') return i + 1;
  return patches.length;
}

export interface MarkerBodies { radius(id: string): number; /** SOI radius (apsides beyond it are never reached). */ soi?(id: string): number }

export function orbitMarkers(patches: readonly TrajectoryPatch[], now: number, bodies: MarkerBodies): OrbitMarker[] {
  const out: OrbitMarker[] = [];
  const planned = firstPlannedPatch(patches);
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i], body = p.orbit.body, radius = bodies.radius(body), isPlanned = i >= planned;
    const from = Math.max(p.startTime, now);
    if (p.samples?.length) {
      // Numerical paths: extrema of the sampled radius (interior samples only).
      let lo = -1, hi = -1;
      for (let k = 1; k + 1 < p.samples.length; k++) {
        const r = length(p.samples[k].position), prev = length(p.samples[k - 1].position), next = length(p.samples[k + 1].position);
        if (p.samples[k].time < from) continue;
        if (lo < 0 && r <= prev && r < next) lo = k;
        if (hi < 0 && r >= prev && r > next) hi = k;
      }
      for (const [k, kind] of [[lo, 'pe'], [hi, 'ap']] as const) if (k >= 0) {
        const s = p.samples[k];
        out.push({ key: `${kind}:${i}`, kind, body, position: s.position, time: s.time, altitude: length(s.position) - radius, planned: isPlanned, patch: i });
      }
    } else if (from < p.endTime || patchDrawnClosed(p)) {
      const closed = patchDrawnClosed(p);
      for (const kind of ['pe', 'ap'] as const) {
        let dt: number;
        try { dt = kind === 'pe' ? timeToPeriapsis(p.orbit, from) : timeToApoapsis(p.orbit, from); } catch { continue; }
        if (!Number.isFinite(dt)) continue;
        const time = from + dt;
        // An outbound hyperbola already past periapsis has no upcoming apsis on this patch.
        if (!closed && (time > p.endTime || time < from - 1)) continue;
        const position = elementsToState(p.orbit, time).position;
        if (length(position) > (bodies.soi?.(body) ?? Infinity)) continue;
        out.push({ key: `${kind}:${i}`, kind, body, position, time, altitude: length(position) - radius, planned: isPlanned, patch: i });
      }
    }
    if (p.endTime <= now) continue;
    const end = (): Vec3 => patchState(p, p.endTime).position;
    if (p.endReason === 'soiEnter' && p.nextBody) {
      const next = patches[i + 1];
      let altitude = NaN;
      if (next && next.orbit.body === p.nextBody) {
        try { altitude = (next.samples ? Math.min(...next.samples.map(s => length(s.position))) : periapsisRadius(next.orbit)) - bodies.radius(p.nextBody); } catch { /* radial */ }
      }
      out.push({ key: `encounter:${i}`, kind: 'encounter', body, position: end(), time: p.endTime, altitude, planned: isPlanned, other: p.nextBody, patch: i });
    } else if (p.endReason === 'soiExit') {
      out.push({ key: `escape:${i}`, kind: 'escape', body, position: end(), time: p.endTime, altitude: NaN, planned: isPlanned, other: body, patch: i });
    } else if (p.endReason === 'impact' || p.endReason === 'atmosphere') {
      out.push({ key: `${p.endReason}:${i}`, kind: p.endReason, body, position: end(), time: p.endTime, altitude: 0, planned: isPlanned, patch: i });
    }
  }
  return out;
}

const SHORT: Record<OrbitMarkerKind, string> = { ap: 'Ap', pe: 'Pe', encounter: '', escape: '', impact: 'Impact', atmosphere: 'Entry' };

/** Short caption shown next to a marker (encounter captions name the body). */
export function markerCaption(m: OrbitMarker, name: (id: string) => string): string {
  if (m.kind === 'encounter') return `${name(m.other!)} encounter`;
  if (m.kind === 'escape') return `${name(m.other!)} escape`;
  return SHORT[m.kind];
}

/** Hover/pinned detail text. */
export function markerDetail(m: OrbitMarker, now: number, name: (id: string) => string): string {
  const when = `T−${formatDuration(Math.max(0, m.time - now))}`;
  const plan = m.planned ? ' (planned)' : '';
  switch (m.kind) {
    case 'ap': return `Apoapsis${plan} ${formatDistance(m.altitude)}\n${when}`;
    case 'pe': return `Periapsis${plan} ${formatDistance(m.altitude)}${m.altitude < 0 ? ' · below surface' : ''}\n${when}`;
    case 'encounter': return `${name(m.other!)} encounter${plan}\nPeriapsis ${Number.isFinite(m.altitude) ? formatDistance(m.altitude) : '—'}${m.altitude < 0 ? ' · impact' : ''}\n${when}`;
    case 'escape': return `Leaving ${name(m.other!)}${plan}\n${when}`;
    case 'impact': return `Impact${plan}\n${when}`;
    case 'atmosphere': return `Atmosphere entry${plan}\n${when}`;
  }
}
