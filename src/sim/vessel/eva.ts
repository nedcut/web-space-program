import { add, sub, scale, length, normalize, dot, v3 } from '../../util/vec3';
import { qNormalize, qRotate, qFromTo, qMul } from '../../util/quat';
import type { ControlInput, VesselState, StepResult } from './runtime';
import type { Environment } from './env';
import { stepHazards } from '../hazards/vessel';
import { removePart, recomputeMassProperties } from './assembly';

export const EVA_HEIGHT = 0.9;
export const EVA_EXHAUST_SPEED = 600;
export const EVA_THRUST = 35;
const MAX_SLOPE = Math.cos(Math.PI / 4);

/** Character contact and finite-propellant jetpack. Uses the dominant-body frame to avoid heliocentric drift. */
export function stepEva(v: VesselState, input: ControlInput, env: Environment, t: number, dt: number): StepResult {
  const result: StepResult = { newVessels: [], events: [] };
  const failures = stepHazards(v, { air: env.air(v.position, t).sample,
    radiation: env.radiation?.(v.position, t) ?? 0, timeScale: env.hazardTimeScale ?? 1 }, dt, result.events);
  for (const [uid, reason] of failures) {
    result.events.push({ type: 'partDestroyed', vesselId: v.id, partUid: uid, reason });
    result.newVessels.push(...removePart(v, uid));
  }
  if (v.destroyed) return result;
  const eva = v.eva!;
  const ref0 = env.referenceBody?.(v.position, t) ?? { position: v3(), velocity: v3() };
  const ref1 = env.referenceBody?.(v.position, t + dt) ?? ref0;
  const gravity = env.gravity(v.position, t);
  const up = length(gravity) > 1e-12 ? scale(normalize(gravity), -1) : qRotate(v.orientation, v3(0, 1, 0));
  const ground = env.ground(v.position, t);
  const onGround = !!ground && dot(sub(v.position, ground.surfacePoint), ground.normal) <= EVA_HEIGHT + 0.04 && dot(sub(v.velocity, ground.surfaceVelocity), ground.normal) < 0.5;
  if (input.evaHeading) {
    let target = input.evaHeading;
    if (onGround) target = qMul(qFromTo(qRotate(target, v3(0, 1, 0)), up), target);
    const q = v.orientation;
    const sign = q.x * target.x + q.y * target.y + q.z * target.z + q.w * target.w < 0 ? -1 : 1;
    const a = 1 - Math.exp(-dt * 5);
    v.orientation = qNormalize({ x: q.x * (1-a) + target.x * a * sign, y: q.y * (1-a) + target.y * a * sign, z: q.z * (1-a) + target.z * a * sign, w: q.w * (1-a) + target.w * a * sign });
  }
  if (onGround) v.orientation = qNormalize(qMul(qFromTo(qRotate(v.orientation, v3(0, 1, 0)), up), v.orientation));
  v.angularVelocity = v3();
  let velocity = sub(v.velocity, ref0.velocity);
  let move = qRotate(input.evaHeading ?? v.orientation, v3(input.translateX, 0, input.translateZ));
  eva.walking = false;
  eva.jetting = false;
  v.telemetry.thrust = 0;
  if (onGround && ground) {
    move = sub(move, scale(ground.normal, dot(move, ground.normal)));
    if (dot(ground.normal, up) < MAX_SLOPE) move = v3();
    move = scale(move, (input.evaRun ? 3.5 : 1.4) / Math.max(1, length(move)));
    // Reject steps onto steep slopes; gravity still applies during hops/falls.
    const ahead = env.ground(add(v.position, scale(move, dt)), t);
    if (ahead && dot(ahead.normal, up) < MAX_SLOPE) move = v3();
    velocity = add(sub(ground.surfaceVelocity, ref0.velocity), move);
    if (input.evaJump) velocity = add(velocity, scale(up, 2.5));
    eva.walking = length(move) > 0.05;
    eva.walkPhase += length(move) * dt * 4;
  } else {
    const cmd = v3(input.translateX, input.translateY, input.translateZ);
    const demand = Math.min(1, length(cmd));
    const p = v.parts[0];
    const fuel = p.resources.monopropellant ?? 0;
    const used = Math.min(fuel, EVA_THRUST * demand * dt / EVA_EXHAUST_SPEED);
    if (used > 0) {
      const dv = EVA_EXHAUST_SPEED * Math.log(v.mass / (v.mass - used));
      velocity = add(velocity, scale(qRotate(input.evaHeading ?? v.orientation, normalize(cmd)), dv));
      p.resources.monopropellant = fuel - used;
      recomputeMassProperties(v, false);
      eva.jetting = true;
      v.telemetry.thrust = used * EVA_EXHAUST_SPEED / dt;
    }
  }
  const oldPosition = sub(v.position, ref0.position);
  v.position = add(ref1.position, add(oldPosition, add(scale(velocity, dt), scale(gravity, 0.5 * dt * dt))));
  v.velocity = add(ref1.velocity, add(velocity, scale(gravity, dt)));
  v.situation = 'flying';
  // Project the capsule foot onto the terrain at the END of the step (moving/rotating body).
  // Iteration matters on slopes: shifting along the normal changes the sampled radial surface point.
  for (let i = 0; i < 4; i++) {
    const g = env.ground(v.position, t + dt);
    if (!g) break;
    const height = dot(sub(v.position, g.surfacePoint), g.normal);
    v.telemetry.altitudeAGL = height;
    if (height >= EVA_HEIGHT) break;
    v.position = add(v.position, scale(g.normal, EVA_HEIGHT - height));
    const vn = dot(sub(v.velocity, g.surfaceVelocity), g.normal);
    if (vn < -12) { v.destroyed = true; break; }
    if (vn < 0) v.velocity = sub(v.velocity, scale(g.normal, vn));
    v.situation = g.isWater ? 'splashed' : 'landed';
  }
  return result;
}
