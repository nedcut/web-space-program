import type { Universe } from '../universe';
import type { VesselState, ControlInput } from '../../sim/vessel/runtime';
import { neutralInput, rebuildTopology } from '../../sim/vessel';
import { stepVessel } from '../../sim/vessel/integrator';
import { predictTrajectory, propagate, stateToElements } from '../../sim/orbit';
import { add, length, sub, type Vec3 } from '../../util/vec3';

/** Cache/definitions are reconstructed in the worker, never cloned per frame. */
export type LandingVessel = Omit<VesselState, 'cache'>;
export interface LandingRequest {
  vessel: LandingVessel;
  body: string;
  bottom: number;
  preciseGravity: boolean;
  /** Unpowered prediction: hold attitude, or keep the heat shield into the airflow. */
  attitude: 'hold' | 'retrograde';
  horizon?: number;
}
export interface LandingPrediction {
  vesselId: string;
  body: string;
  start: number;
  /** Body-relative Float64 points. */
  points: Vec3[];
  times: number[];
  impact: { time: number; position: Vec3; fixedPosition: Vec3; speed: number } | null;
  outcome: 'impact' | 'escape' | 'breakup' | 'horizon';
  attitude: LandingRequest['attitude'];
  steps: number;
  computeMs: number;
  maxChunkMs: number;
}

/** The actual aero, heating, SAS, terrain/contact and rotating atmosphere, stepped at flight's 50 Hz.
 * Coast above atmosphere analytically first; yield every 100 physics steps for cancellation/fallback hosts.
 * No thrust, future staging or future parachute commands are assumed. Already armed/deployed chutes are simulated.
 */
export function* landingPrediction(universe: Universe, ut: number, request: LandingRequest): Generator<void, LandingPrediction> {
  let chunkStart = performance.now();
  const v = structuredClone(request.vessel) as VesselState;
  rebuildTopology(v);
  const body = universe.body(request.body);
  const env = universe.createEnvironment(() => request.body, request.preciseGravity);
  const input: ControlInput = neutralInput({ sas: request.attitude === 'retrograde' ? 'retrograde' : 'stabilityAssist', sasReference: 'surface' });
  const result: LandingPrediction = { vesselId: v.id, body: body.id, start: ut, points: [], times: [], impact: null, outcome: 'horizon', attitude: request.attitude, steps: 0, computeMs: 0, maxChunkMs: 0 };
  const account = () => {
    const duration = performance.now() - chunkStart;
    result.computeMs += duration; result.maxChunkMs = Math.max(result.maxChunkMs, duration);
  };
  const finish = () => { account(); return result; };
  const end = ut + Math.min(7200, Math.max(1, request.horizon ?? 3600));
  const start = ut;
  const record = () => {
    result.points.push(sub(v.position, universe.ephem.getBodyState(body.id, ut).position));
    result.times.push(ut);
  };
  record();
  if (!request.preciseGravity) {
    const ref = universe.ephem.getBodyState(body.id, ut);
    const rs = { position: sub(v.position, ref.position), velocity: sub(v.velocity, ref.velocity) };
    // Above the force/contact domain, the same conic as packed flight is both cheaper and more accurate.
    if (length(rs.position) > body.radius + Math.max(body.atmosphere?.height ?? 0, universe.terrain(body.id).maxHeight) + 1000) {
      const o = stateToElements(body.gm, body.id, rs.position, rs.velocity, ut);
      const patch = predictTrajectory({ ephem: universe.ephem, bodies: universe.bodies, initialBody: body.id, state: rs, t0: ut,
        horizon: end - ut, maxPatches: 1, stopAtAtmosphere: true,
        impactAltitude: () => Math.max(0, universe.terrain(body.id).maxHeight) + request.bottom + 1000 })[0];
      if (patch) {
        const coastEnd = Math.min(end, patch.endTime);
        for (let i = 1; i <= 32; i++) {
          ut = start + (coastEnd - start) * i / 32;
          const s = propagate(o, ut), b = universe.ephem.getBodyState(body.id, ut);
          v.position = add(b.position, s.position); v.velocity = add(b.velocity, s.velocity);
          record();
        }
        if (patch.endReason === 'soiEnter' || patch.endReason === 'soiExit') { result.outcome = 'escape'; return finish(); }
      }
    }
  }
  let lastRecord = ut;
  const interval = Math.max(0.5, (end - ut) / 400);
  while (ut < end && result.steps < 360000) {
    const step = Math.min(0.02, end - ut);
    stepVessel(v, input, env, ut, step);
    ut += step; result.steps++;
    if (ut - lastRecord >= interval) { record(); lastRecord = ut; }
    const site = universe.surfaceInfo(body.id, v.position, ut);
    if (v.situation !== 'flying' || site.heightAboveTerrain <= request.bottom + 0.25) {
      const relative = sub(v.position, universe.ephem.getBodyState(body.id, ut).position);
      const speed = length(sub(sub(v.velocity, universe.ephem.getBodyState(body.id, ut).velocity), universe.ephem.surfaceVelocity(body.id, relative, ut)));
      result.impact = { time: ut, position: relative, fixedPosition: universe.ephem.toBodyFixed(body.id, relative, ut), speed };
      result.outcome = 'impact'; record(); return finish();
    }
    if (v.destroyed || !v.parts.length) { result.outcome = 'breakup'; record(); return finish(); }
    if (site.r > body.soi) { result.outcome = 'escape'; record(); return finish(); }
    if (result.steps % 100 === 0 || performance.now() - chunkStart >= 8) {
      account(); yield; chunkStart = performance.now();
    }
  }
  record(); return finish();
}
