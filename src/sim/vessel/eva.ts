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

/** Suit radius for hull contact (the EVA part is 0.7 × 0.65 m across). */
export const EVA_HULL_RADIUS = 0.35;
/** Contact spheres along the suit's up axis, from its centre (EVA_HEIGHT above the feet): shins, waist, helmet. */
const PROBES = [-0.5, 0, 0.5];

// Scratch for the allocation-free hull test (the sim is single-threaded; nothing here escapes a call). Vectors pass
// through a typed array by offset: doubles passed as arguments to a call V8 does not inline are boxed.
const S = new Float64Array(9);
const R = 0, L = 3, P = 6;
const put = (o: number, x: number, y: number, z: number) => { S[o] = x; S[o + 1] = y; S[o + 2] = z; };

/** S[o..o+2] = q · S[i..i+2] · q⁻¹ (or the inverse rotation when `inv`); `i` may equal `o`. */
function rot(q: { x: number; y: number; z: number; w: number }, i: number, inv: boolean, o: number) {
  const x = S[i], y = S[i + 1], z = S[i + 2];
  const qx = inv ? -q.x : q.x, qy = inv ? -q.y : q.y, qz = inv ? -q.z : q.z, qw = q.w;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  S[o] = x + qw * tx + (qy * tz - qz * ty);
  S[o + 1] = y + qw * ty + (qz * tx - qx * tz);
  S[o + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/**
 * Keep an astronaut out of a vessel's hull: three spheres along the suit against every part's collision shape
 * (box, or cylinder/cone as for aero and the pad placement). Penetration is resolved by moving the astronaut out
 * along the shortest way, and velocity into the hull (relative to the vessel) is removed; the vessel is not pushed
 * (a 100 kg astronaut against tonnes). With feet on the ground the push is horizontal only, so an astronaut is
 * stopped by a hull rather than lifted onto it. Returns whether there was contact. Allocation-free.
 */
export function collideEvaWithHull(eva: VesselState, hull: VesselState): boolean {
  const ep = eva.position, hp = hull.position, eo = eva.orientation;
  const grounded = eva.situation === 'landed' || eva.situation === 'splashed';
  put(R, 0, 1, 0);
  rot(eo, R, false, R);
  const ux = S[R], uy = S[R + 1], uz = S[R + 2];
  const reach = hull.cache.boundingRadius + EVA_HULL_RADIUS + 0.5;
  if (Math.abs(ep.x - hp.x) > reach + 0.5 || Math.abs(ep.y - hp.y) > reach + 0.5 || Math.abs(ep.z - hp.z) > reach + 0.5) return false;
  const hq = hull.orientation;
  let hit = false;
  const parts = hull.parts;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], s = p.def.shape;
    // Part centre relative to the hull's reference point (COM), world axes.
    put(R, p.position.x - hull.com.x, p.position.y - hull.com.y, p.position.z - hull.com.z);
    rot(hq, R, false, R);
    const cx = hp.x + S[R], cy = hp.y + S[R + 1], cz = hp.z + S[R + 2];
    // Bounding sphere of the shape (as `shapeRadius`, without Math.hypot's allocation).
    const rMax = s.kind === 'box' ? 0 : Math.max(s.radiusTop, s.radiusBottom);
    const bound = (s.kind === 'box' ? 0.5 * Math.sqrt(s.size.x * s.size.x + s.size.y * s.size.y + s.size.z * s.size.z) : Math.sqrt(s.height * s.height / 4 + rMax * rMax)) + EVA_HULL_RADIUS + 0.5;
    const dx0 = ep.x - cx, dy0 = ep.y - cy, dz0 = ep.z - cz;
    if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > bound * bound) continue;
    const pq = p.rotation;
    for (let j = 0; j < PROBES.length; j++) {
      const k = PROBES[j];
      // Probe centre in the part frame.
      put(R, ep.x + ux * k - cx, ep.y + uy * k - cy, ep.z + uz * k - cz);
      rot(hq, R, true, R);
      rot(pq, R, true, L);
      const lx = S[L], ly = S[L + 1], lz = S[L + 2];
      let depth = 0, nx = 0, ny = 0, nz = 0;
      if (s.kind === 'box') {
        const hx = s.size.x / 2, hy = s.size.y / 2, hz = s.size.z / 2;
        const qx = Math.max(-hx, Math.min(hx, lx)), qy = Math.max(-hy, Math.min(hy, ly)), qz = Math.max(-hz, Math.min(hz, lz));
        const ox = lx - qx, oy = ly - qy, oz = lz - qz, d = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (d > 1e-9) {
          if (d >= EVA_HULL_RADIUS) continue;
          depth = EVA_HULL_RADIUS - d; nx = ox / d; ny = oy / d; nz = oz / d;
        } else {
          // Centre inside the box: out through the nearest face.
          const fx = hx - Math.abs(lx), fy = hy - Math.abs(ly), fz = hz - Math.abs(lz);
          if (fx <= fy && fx <= fz) { depth = fx + EVA_HULL_RADIUS; nx = lx < 0 ? -1 : 1; }
          else if (fy <= fz) { depth = fy + EVA_HULL_RADIUS; ny = ly < 0 ? -1 : 1; }
          else { depth = fz + EVA_HULL_RADIUS; nz = lz < 0 ? -1 : 1; }
        }
      } else {
        const hh = s.height / 2;
        const yc = Math.max(-hh, Math.min(hh, ly));
        const rad = s.radiusBottom + (s.radiusTop - s.radiusBottom) * (hh > 0 ? (yc + hh) / (2 * hh) : 0.5);
        const rr = Math.sqrt(lx * lx + lz * lz);
        if (Math.abs(ly) < hh && rr < rad) {
          // Inside: out through the side or the nearer end, whichever is shorter.
          const side = rad - rr, end = hh - Math.abs(ly);
          if (side <= end && rr > 1e-9) { depth = side + EVA_HULL_RADIUS; nx = lx / rr; nz = lz / rr; }
          else { depth = end + EVA_HULL_RADIUS; ny = ly < 0 ? -1 : 1; }
        } else {
          const k2 = rr > rad && rr > 1e-9 ? rad / rr : 1;
          const ox = lx - lx * k2, oy = ly - yc, oz = lz - lz * k2, d = Math.sqrt(ox * ox + oy * oy + oz * oz);
          if (d >= EVA_HULL_RADIUS || d < 1e-9) continue;
          depth = EVA_HULL_RADIUS - d; nx = ox / d; ny = oy / d; nz = oz / d;
        }
      }
      // Back to world axes.
      put(R, nx, ny, nz);
      rot(pq, R, false, R);
      rot(hq, R, false, P);
      let px = S[P], py = S[P + 1], pz = S[P + 2];
      if (grounded) {
        const up = px * ux + py * uy + pz * uz;
        px -= ux * up; py -= uy * up; pz -= uz * up;
        const n = Math.sqrt(px * px + py * py + pz * pz);
        if (n < 0.2) continue;
        depth /= n; px /= n; py /= n; pz /= n;
      }
      ep.x += px * depth; ep.y += py * depth; ep.z += pz * depth;
      const vn = (eva.velocity.x - hull.velocity.x) * px + (eva.velocity.y - hull.velocity.y) * py + (eva.velocity.z - hull.velocity.z) * pz;
      if (vn < 0) { eva.velocity.x -= px * vn; eva.velocity.y -= py * vn; eva.velocity.z -= pz * vn; }
      hit = true;
    }
  }
  return hit;
}
