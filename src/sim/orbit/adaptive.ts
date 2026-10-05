import type { StateVector } from './api';
import type { AccelerationFn } from './nbody';
import { v3 } from '../../util/vec3';

// Dormand–Prince 5(4), advancing the fifth-order solution with embedded error control.
const C = [0, 1/5, 3/10, 4/5, 8/9, 1, 1];
const A = [[], [1/5], [3/40, 9/40], [44/45, -56/15, 32/9],
  [19372/6561, -25360/2187, 64448/6561, -212/729],
  [9017/3168, -355/33, 46732/5247, 49/176, -5103/18656],
  [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84]];
const E = [35/384-5179/57600, 0, 500/1113-7571/16695, 125/192-393/640,
  -2187/6784+92097/339200, 11/84-187/2100, -1/40];
export interface Accuracy { rtol?: number; positionAtol?: number; velocityAtol?: number }
export function adaptiveStep(state: StateVector, t: number, h: number, acceleration: AccelerationFn, accuracy: Accuracy = {}) {
  if (!(h > 0) || t + h === t) throw new RangeError('Numerical step cannot advance time');
  const p = state.position, v = state.velocity, y = [p.x,p.y,p.z,v.x,v.y,v.z];
  const k: number[][] = [];
  let next = y;
  for (let i = 0; i < 7; i++) {
    next = y.map((value, j) => value + h * A[i].reduce((sum, a, n) => sum + a*k[n][j], 0));
    const a = acceleration(v3(next[0],next[1],next[2]), t + C[i]*h);
    k.push([next[3],next[4],next[5],a.x,a.y,a.z]);
  }
  let error = 0;
  for (let j = 0; j < 6; j++) {
    const atol = j < 3 ? accuracy.positionAtol ?? 1e-3 : accuracy.velocityAtol ?? 1e-7;
    const tolerance = atol + (accuracy.rtol ?? 2e-11)*Math.max(Math.abs(y[j]),Math.abs(next[j]));
    error = Math.max(error, Math.abs(h*E.reduce((sum,e,i) => sum+e*k[i][j],0))/tolerance);
  }
  if (!Number.isFinite(error) || next.some(x => !Number.isFinite(x))) throw new RangeError('Non-finite numerical trajectory');
  return { state: { position: v3(next[0],next[1],next[2]), velocity: v3(next[3],next[4],next[5]) },
    accepted: error <= 1, nextStep: h*Math.max(.1,Math.min(5,error === 0 ? 5 : .9*error**(-.2))), error };
}

/** Bounded deterministic integration. An incomplete result is explicit; never silently skip time. */
export function integrateAdaptive(state: StateVector, t: number, target: number, acceleration: AccelerationFn,
  options: Accuracy & { step?: number; maxSteps?: number; stepLimit?: (state: StateVector, t: number) => number } = {}) {
  let h = options.step ?? Math.min(60, target-t), steps = 0;
  for (; t < target && steps < (options.maxSteps ?? 100000); steps++) {
    h = Math.min(h,target-t,options.stepLimit?.(state,t) ?? Infinity);
    const result = adaptiveStep(state,t,h,acceleration,options);
    if (result.accepted) { state = result.state; t += h; }
    h = result.nextStep;
  }
  return { state, time: t, nextStep: h, steps, complete: t >= target };
}
