import { qConj, qRotate } from '../util/quat';
import { dot, length, normalize, v3, type Vec3 } from '../util/vec3';
import type { Budget, MissionId, Scenario, Setup } from './catalog';

export const TOUR_MOONS = ['titan', 'rhea', 'dione', 'tethys', 'enceladus'];
/** World adapter output. Synthetic states can exercise goals without running orbital physics. */
export interface Observation {
  ut: number; alive: boolean; body: string; landed: boolean; speed: number; verticalSpeed: number;
  altitude: number; agl: number; fixed: Vec3; bound: boolean; periapsis: number;
  atmosphereTop: number; fullChute: boolean; intact: boolean; dockedStation: boolean; precision: number;
}
export interface MissionState {
  started: number; elapsed: number; dv: number; hover: number; visited: string[];
  atmosphere: boolean; chute: boolean; crossed: boolean; plume: boolean; scienceBonus: boolean;
  jupiterPeriapsis: boolean; leftJupiter: boolean; precision: number; landingSpeed: number;
  previous?: Observation; status: 'flying' | 'success' | 'failed'; reason: string;
}
export function initialMission(started: number): MissionState {
  return { started, elapsed: 0, dv: 0, hover: 0, visited: [], atmosphere: false, chute: false, crossed: false, plume: false, scienceBonus: false, jupiterPeriapsis: false, leftJupiter: false, precision: Infinity, landingSpeed: Infinity, status: 'flying', reason: '' };
}
export function observeWorld(setup: Setup, originalParts: number): Observation {
  const w = setup.world;
  const merged = setup.vesselId ? [...w.vessels.values()].find(vessel => vessel.state.parts.some(p => p.docked?.vesselId === setup.vesselId)) : undefined;
  const v = setup.vesselId ? w.vessels.get(setup.vesselId) ?? merged : w.active;
  if (!v) return { ut: w.ut, alive: false, body: '', landed: false, speed: 0, verticalSpeed: 0, altitude: 0, agl: 0, fixed: v3(), bound: false, periapsis: 0, atmosphereTop: 0, fullChute: false, intact: false, dockedStation: false, precision: Infinity };
  const b = w.universe.body(v.body), relative = w.relativeState(v).position;
  const fixed = qRotate(qConj(w.universe.ephem.bodyRotation(v.body, w.ut)), relative);
  const direction = normalize(fixed);
  const terrain = b.solidSurface ? w.universe.terrain(v.body).heightAt(direction.x, direction.y, direction.z) : 0;
  const orbit = setup.id === 'mars-aerobrake' ? w.orbitSummary(v) : null;
  return { ut: w.ut, alive: !v.state.destroyed, body: v.body, landed: v.state.situation !== 'flying' && v.mode !== 'prelaunch', speed: length(w.surfaceVelocity(v)), verticalSpeed: w.verticalSpeed(v), altitude: length(relative) - b.radius, agl: length(relative) - b.radius - terrain,
    fixed, bound: !!orbit && orbit.orbit.e < 1, periapsis: orbit ? orbit.pe - (b.solidSurface ? w.universe.terrain(v.body).maxHeight : 0) : 0, atmosphereTop: b.atmosphere?.height ?? 0,
    fullChute: v.state.parts.some(p => p.chute?.phase === 'full'), intact: v.state.parts.length >= originalParts,
    dockedStation: !!setup.stationId && (v.state.parts.some(p => p.docked?.vesselId === setup.stationId) || v.state.id === setup.stationId && !!merged),
    precision: setup.target ? b.radius * Math.acos(Math.max(-1, Math.min(1, dot(direction, setup.target)))) : 0 };
}
/** Pure state reducer: consume one simulation step and its measured propulsion cost. */
export function evaluateMission(id: MissionId, state: MissionState, o: Observation, dt: number, dv = 0): MissionState {
  if (state.status !== 'flying') return state;
  const next: MissionState = { ...state, elapsed: Math.max(0, o.ut - state.started), dv: state.dv + Math.max(0, dv), visited: [...new Set([...state.visited, o.body])], previous: o };
  const fail = (reason: string) => ({ ...next, status: 'failed' as const, reason });
  const success = () => ({ ...next, status: 'success' as const, reason: 'Mission objectives achieved.' });
  if (!o.alive) return fail('The mission vessel was lost.');
  const before = state.previous;
  if (o.altitude < o.atmosphereTop && o.atmosphereTop > 0) next.atmosphere = true;
  next.chute ||= o.fullChute;
  if (o.landed && !before?.landed) next.landingSpeed = before?.speed ?? o.speed;
  if (id === 'ring-skimmer') {
    if (!o.intact) return fail('Gossamer must emerge with every original part intact.');
    if (o.body === 'saturn' && before?.body === 'saturn' && before.fixed.z > 0 && o.fixed.z <= 0) {
      const f = before.fixed.z / (before.fixed.z - o.fixed.z);
      const radius = Math.hypot(before.fixed.x + f * (o.fixed.x - before.fixed.x), before.fixed.y + f * (o.fixed.y - before.fixed.y));
      if (radius < 11758000 || radius > 12217000) return fail('Ring-plane crossing missed the Cassini Division.');
      next.crossed = true; next.precision = Math.abs(radius - 11987500);
    }
    if (next.crossed && o.body === 'saturn' && o.fixed.z < -5000) return success();
  } else if (id === 'plume-dive') {
    if (!o.intact) return fail('The sampler must survive the pass intact.');
    if (o.body === 'enceladus' && o.agl > 0 && o.agl < 10000 && normalize(o.fixed).z < -Math.sin(80 * Math.PI / 180)) { next.plume = true; next.scienceBonus ||= o.agl < 5000; }
    if (next.plume && o.body === 'enceladus' && o.agl > 15000 && o.verticalSpeed > 0) return success();
  } else if (id === 'grand-tour') {
    if (TOUR_MOONS.every(m => next.visited.includes(m))) return success();
  } else if (id === 'rendezvous') {
    if (o.dockedStation) return success();
  } else if (id === 'mars-aerobrake') {
    if (next.dv > 0.01) return fail('Atmosphere-only capture forbids propulsion.');
    if (o.landed) return fail('The goal is an orbit, rather than a surface landing.');
    if (next.atmosphere && o.body === 'mars' && o.altitude > o.atmosphereTop && o.bound && o.periapsis > 0) return success();
  } else if (id === 'jupiter-assist') {
    if (before?.body === 'jupiter' && o.body === 'jupiter' && before.verticalSpeed < 0 && o.verticalSpeed >= 0) next.jupiterPeriapsis = true;
    // Rails may jump across periapsis: an inbound-to-outbound SOI exit certifies the flyby too.
    if (before?.body === 'jupiter' && o.body !== 'jupiter') { next.leftJupiter = true; next.jupiterPeriapsis = true; }
    if (next.jupiterPeriapsis && next.leftJupiter && o.body === 'saturn') return success();
  } else {
    if (id === 'suicide-burn' && o.agl > 100 && Math.abs(o.verticalSpeed) < 2) next.hover += Math.max(0, dt);
    if (next.hover > 2) return fail('More than two seconds of hovering above 100 m.');
    if (o.landed) {
      const body = id === 'titan-descent' ? 'titan' : id === 'moon-return' ? 'earth' : 'moon';
      if (o.body !== body) return fail('Touchdown was on the wrong world.');
      next.precision = o.precision;
      if (next.landingSpeed >= (id === 'moon-return' ? 8 : 5)) return fail('Touchdown speed exceeded the safe limit.');
      if (id === 'titan-descent' && (!next.atmosphere || !next.chute || o.precision > 5000)) return fail('Titan needs atmospheric entry, a full chute and a landing within 5 km.');
      if (id === 'moon-return' && (!next.atmosphere || !next.chute)) return fail('Earth return needs atmospheric entry and a full chute.');
      if (id === 'moon-landing' && o.precision > 2000) return fail('Touchdown missed the survey point by more than 2 km.');
      return success();
    }
  }
  return next;
}
export type Medal = 'gold' | 'silver' | 'bronze' | 'none';
export interface Result { score: number; medal: Medal; elapsed: number; dv: number; landingSpeed: number | null; precision: number | null; scienceBonus: boolean; success: boolean }
function meets(state: MissionState, b: Budget) { return state.elapsed <= b.time && state.dv <= b.dv && (b.speed === Infinity || state.landingSpeed <= b.speed) && (b.precision === Infinity || state.precision <= b.precision); }
export function scoreMission(scenario: Scenario, state: MissionState): Result {
  const success = state.status === 'success';
  const medal: Medal = !success ? 'none' : meets(state, scenario.gold) ? 'gold' : meets(state, scenario.silver) ? 'silver' : 'bronze';
  const finitePenalty = (v: number, limit: number) => Number.isFinite(limit) && limit > 0 ? Math.min(10, v / limit) : 0;
  const b = scenario.gold;
  const penalty = (scenario.id === 'rendezvous' ? 5000 : 500) * finitePenalty(state.elapsed, b.time) + 5000 * finitePenalty(state.dv, b.dv) + 2000 * finitePenalty(state.landingSpeed, b.speed) + 2000 * finitePenalty(state.precision, b.precision);
  return { score: success ? Math.max(1, Math.round(100000 - penalty + (state.scienceBonus ? 5000 : 0))) : 0, medal, elapsed: state.elapsed, dv: state.dv, landingSpeed: Number.isFinite(state.landingSpeed) ? state.landingSpeed : null, precision: Number.isFinite(state.precision) ? state.precision : null, scienceBonus: state.scienceBonus, success };
}
