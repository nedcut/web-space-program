import { add, sub, scale, length, normalize, dot, cross, v3, type Vec3 } from '../../util/vec3';
import { qNormalize, qRotate, qFromTo, qMul, qFromAxisAngle, type Quat } from '../../util/quat';
import type { ControlInput, VesselState, StepResult } from './runtime';
import type { Environment } from './env';
import { stepHazards } from '../hazards/vessel';
import { removePart, recomputeMassProperties } from './assembly';

export const EVA_HEIGHT = 0.9;
/** Monopropellant exhaust speed (~225 s specific impulse): the 5 kg load gives a 100 kg astronaut ~113 m/s. */
export const EVA_EXHAUST_SPEED = 2200;
/** ~3 m/s² at full load: enough to fly on the Moon (1.62 m/s²), not on Mars or Earth. */
export const EVA_THRUST = 300;
export const EVA_WALK_SPEED = 1.4;
export const EVA_RUN_SPEED = 3.5;
export const EVA_JUMP_SPEED = 2.5;
const MAX_SLOPE = Math.cos(Math.PI / 4);
/** A walking astronaut keeps their feet on terrain that drops away by up to this much in one step (crests, downhill). */
const STEP_DOWN = 0.3;
/** Turn rate toward the walking / thrust direction (1/s). */
const TURN_RATE = 6;
const Y = v3(0, 1, 0);

/** Rotate `q` about `axis` toward facing `dir` (its -Z), by the fraction `a` of the remaining angle. */
function yawToward(q: Quat, dir: Vec3, axis: Vec3, a: number): Quat {
  const f = qRotate(q, v3(0, 0, -1));
  const angle = Math.atan2(dot(cross(f, dir), axis), dot(f, dir));
  return qNormalize(qMul(qFromAxisAngle(axis, angle * a), q));
}

/** Normalized linear blend toward `target` (shortest way round). */
function turnToward(q: Quat, target: Quat, a: number): Quat {
  const sign = q.x * target.x + q.y * target.y + q.z * target.z + q.w * target.w < 0 ? -1 : 1;
  return qNormalize({ x: q.x * (1 - a) + target.x * a * sign, y: q.y * (1 - a) + target.y * a * sign, z: q.z * (1 - a) + target.z * a * sign, w: q.w * (1 - a) + target.w * a * sign });
}

/**
 * Character contact and finite-propellant jetpack. Uses the dominant-body frame to avoid heliocentric drift.
 * Controls (`translateX/Y/Z`) are in the camera frame `evaHeading`, levelled to the local horizon near a surface.
 * `rcs` is the jetpack switch: off, the astronaut only walks, runs and jumps; on, translation fires the jetpack
 * whenever the feet are off the ground, and thrusting up lifts off where the jetpack can beat gravity.
 * Facing follows the walking direction (or the view while thrusting); with `evaFaceView` it always follows the view.
 */
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
  const g = length(gravity);
  const up = g > 1e-12 ? scale(gravity, -1 / g) : qRotate(v.orientation, Y);
  const ground = env.ground(v.position, t);
  const wasGrounded = v.situation === 'landed' || v.situation === 'splashed';
  let onGround = !!ground && dot(sub(v.position, ground.surfacePoint), ground.normal) <= EVA_HEIGHT + (wasGrounded ? STEP_DOWN : 0.04)
    && dot(sub(v.velocity, ground.surfaceVelocity), ground.normal) < 0.5;
  const view = input.evaHeading ?? v.orientation;
  // Near a surface the controls use the view's heading on the local horizon (W is level, Shift is straight up);
  // in space they follow the full camera attitude.
  const frame = ground ? qMul(qFromTo(qRotate(view, Y), up), view) : view;
  const p = v.parts[0];
  const fuel = p.resources.monopropellant ?? 0;
  const jetpack = input.rcs && fuel > 0;
  const cmd = v3(input.translateX, input.translateY, input.translateZ);
  const demand = Math.min(1, length(cmd));
  // Lift off under the jetpack only where its upward thrust beats gravity; elsewhere the feet stay down (Shift runs).
  if (onGround && jetpack && input.translateY > 0 && EVA_THRUST * Math.min(1, input.translateY) / v.mass > g) onGround = false;
  const turn = 1 - Math.exp(-dt * TURN_RATE);
  if (onGround) v.orientation = qNormalize(qMul(qFromTo(qRotate(v.orientation, Y), up), v.orientation));
  v.angularVelocity = v3();
  let velocity = sub(v.velocity, ref0.velocity);
  let jumped = false;
  eva.walking = false;
  eva.jetting = false;
  v.telemetry.thrust = 0;
  if (onGround && ground) {
    let move = qRotate(frame, v3(input.translateX, 0, input.translateZ));
    move = sub(move, scale(ground.normal, dot(move, ground.normal)));
    const want = Math.min(1, Math.hypot(input.translateX, input.translateZ));
    const len = length(move);
    // Full speed in the commanded direction whatever the camera pitch; no walking up slopes beyond the limit.
    move = len > 1e-6 && dot(ground.normal, up) >= MAX_SLOPE ? scale(move, want * (input.evaRun ? EVA_RUN_SPEED : EVA_WALK_SPEED) / len) : v3();
    // Reject steps onto steep slopes; gravity still applies during hops/falls.
    const ahead = env.ground(add(v.position, scale(move, dt)), t);
    if (ahead && dot(ahead.normal, up) < MAX_SLOPE) move = v3();
    velocity = add(sub(ground.surfaceVelocity, ref0.velocity), move);
    if (input.evaJump) { velocity = add(velocity, scale(up, EVA_JUMP_SPEED)); jumped = true; }
    const speed = length(move);
    eva.walking = speed > 0.05;
    eva.walkPhase += speed * dt * 4;
    if (input.evaFaceView) v.orientation = yawToward(v.orientation, qRotate(frame, v3(0, 0, -1)), up, turn);
    else if (eva.walking) v.orientation = yawToward(v.orientation, scale(move, 1 / speed), up, turn);
  } else if (jetpack && demand > 0) {
    const used = Math.min(fuel, EVA_THRUST * demand * dt / EVA_EXHAUST_SPEED);
    const dv = EVA_EXHAUST_SPEED * Math.log(v.mass / (v.mass - used));
    velocity = add(velocity, scale(qRotate(frame, normalize(cmd)), dv));
    p.resources.monopropellant = fuel - used;
    recomputeMassProperties(v, false);
    eva.jetting = true;
    v.telemetry.thrust = used * EVA_EXHAUST_SPEED / dt;
    // Face the way the camera looks while flying (upright near a surface).
    v.orientation = turnToward(v.orientation, frame, turn);
  } else if (input.evaFaceView) v.orientation = turnToward(v.orientation, frame, turn);
  const oldPosition = sub(v.position, ref0.position);
  v.position = add(ref1.position, add(oldPosition, add(scale(velocity, dt), scale(gravity, 0.5 * dt * dt))));
  v.velocity = add(ref1.velocity, add(velocity, scale(gravity, dt)));
  v.situation = 'flying';
  // Project the capsule foot onto the terrain at the END of the step (moving/rotating body). A walking astronaut
  // also follows terrain that falls away (STEP_DOWN), so crests and downhill runs do not turn into tiny hops.
  // Iteration matters on slopes: shifting along the normal changes the sampled radial surface point.
  const stick = onGround && !jumped;
  for (let i = 0; i < 4; i++) {
    const gs = env.ground(v.position, t + dt);
    if (!gs) break;
    const height = dot(sub(v.position, gs.surfacePoint), gs.normal);
    v.telemetry.altitudeAGL = height;
    if (height >= EVA_HEIGHT && !(stick && height < EVA_HEIGHT + STEP_DOWN)) break;
    if (Math.abs(height - EVA_HEIGHT) < 1e-9) { v.situation = gs.isWater ? 'splashed' : 'landed'; break; }
    v.position = add(v.position, scale(gs.normal, EVA_HEIGHT - height));
    const vn = dot(sub(v.velocity, gs.surfaceVelocity), gs.normal);
    if (vn < -12) { v.destroyed = true; break; }
    if (vn < 0 || stick) v.velocity = sub(v.velocity, scale(gs.normal, vn));
    v.situation = gs.isWater ? 'splashed' : 'landed';
  }
  return result;
}
