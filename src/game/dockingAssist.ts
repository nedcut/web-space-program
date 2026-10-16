import type { Autopilot, AutopilotStep } from './autopilot';
import type { World } from './world';
import { dockedPartner, freePorts, isPortFree, portInfo, type PortInfo } from '../sim/vessel/docking';
import { controlRotation } from '../sim/vessel/station';
import { totalResource } from '../sim/vessel/resources';
import { neutralInput, type VesselState } from '../sim/vessel/runtime';
import { rcsEnabled, rcsMask } from '../sim/vessel/tweaks';
import { qConj, qMul, qRotate } from '../util/quat';
import { add, cross, dot, length, normalize, scale, sub, v3, type Vec3 } from '../util/vec3';

export const DOCK_ASSIST_RANGE = 2000;
export const DOCK_ASSIST_SPEED = 5;
const MAX_TARGET_RATE = 0.01;
const clamp = (n: number, max: number) => Math.max(-max, Math.min(max, n));

/** Explicit port selection only: targeting the vessel centre cannot silently choose a different collar. */
export function targetedPort(world: World): PortInfo | null {
  const v = world.targetId ? world.vessels.get(world.targetId)?.state : undefined;
  const p = world.targetPortUid !== null ? v?.cache.byUid.get(world.targetPortUid) : undefined;
  return v && p && isPortFree(v, p) ? portInfo(v, p) : null;
}

export function targetPortOrientation(world: World) {
  const v = world.targetId ? world.vessels.get(world.targetId)?.state : undefined;
  const p = world.targetPortUid !== null ? v?.cache.byUid.get(world.targetPortUid) : undefined;
  if (!v || !p || !isPortFree(v, p)) return undefined;
  const rotation = controlRotation(p);
  return rotation ? qMul(v.orientation, rotation) : undefined;
}

/** Prefer the explicitly chosen own port, then the controlling port, then the nearest matching collar. */
export function dockingAssistPort(world: World, ownUid?: number | null): PortInfo | null {
  const v = world.active?.state, target = targetedPort(world);
  if (!v || !target) return null;
  const ports = freePorts(v);
  if (ownUid != null) return ports.find(p => p.part.uid === ownUid) ?? null;
  return ports.find(p => p.part.uid === v.controlUid)
    ?? ports.filter(p => p.mod.size === target.mod.size).sort((a, b) => length(sub(a.pos, target.pos)) - length(sub(b.pos, target.pos)))[0]
    ?? ports[0] ?? null;
}

/** Diagonal force per signed unit translation command, matching the sim's nozzle activation and masks. */
function translationForce(v: VesselState): number[] {
  const force = [0, 0, 0, 0, 0, 0];
  for (const p of v.parts) {
    if (!rcsEnabled(p)) continue;
    const mask = rcsMask(p).tr;
    for (const m of p.def.modules) {
      if (m.type !== 'rcs') continue;
      for (const n of m.nozzles) {
        const d = qRotate(p.rotation, normalize(n.direction));
        const components = [d.x, d.y, d.z];
        for (let i = 0; i < 3; i++) force[2 * i + (components[i] > 0 ? 1 : 0)] += components[i] ** 2 * m.thrustPerNozzle * mask[i];
      }
    }
  }
  return force;
}

type Phase = 'Stopping' | 'Aligning' | 'Lining up' | 'Closing';

/** Mutate the port destination so the COM path clears both vessels' enclosing spheres. */
function lineUpDestination(destination: Vec3, own: PortInfo, target: PortInfo): 'Lining up' | 'Moving clear' | 'Circling' {
  const a = own.vessel, b = target.vessel;
  const x = a.position.x - b.position.x, y = a.position.y - b.position.y, z = a.position.z - b.position.z;
  // Convert the port-relative destination to an own-COM position relative to the target COM.
  const dx = (target.pos.x - b.position.x) - (own.pos.x - a.position.x);
  const dy = (target.pos.y - b.position.y) - (own.pos.y - a.position.y);
  const dz = (target.pos.z - b.position.z) - (own.pos.z - a.position.z);
  const gx = destination.x + dx, gy = destination.y + dy, gz = destination.z + dz;
  const ex = gx - x, ey = gy - y, ez = gz - z;
  const distanceSq = ex * ex + ey * ey + ez * ez;
  const t = distanceSq > 0 ? Math.max(0, Math.min(1, -(x * ex + y * ey + z * ez) / distanceSq)) : 0;
  const nearX = x + t * ex, nearY = y + t * ey, nearZ = z + t * ez;
  const keepOut = a.cache.boundingRadius + b.cache.boundingRadius + 5;
  // Extra room covers pursuit lag when leaving the arc for the straight standoff leg.
  const clearance = keepOut + 2, orbit = keepOut + 5;
  if (nearX * nearX + nearY * nearY + nearZ * nearZ >= clearance * clearance) return 'Lining up';
  const radius = Math.sqrt(x * x + y * y + z * z);
  // Overlapping COMs have no radial direction; use the destination direction to move clear.
  const goalRadius = Math.sqrt(gx * gx + gy * gy + gz * gz);
  const nx = radius > 1e-6 ? x / radius : gx / goalRadius;
  const ny = radius > 1e-6 ? y / radius : gy / goalRadius;
  const nz = radius > 1e-6 ? z / radius : gz / goalRadius;
  let wx = nx, wy = ny, wz = nz;
  const movingClear = radius < clearance;
  if (!movingClear) {
    const cos = clamp((nx * gx + ny * gy + nz * gz) / goalRadius, 1);
    let tx = gx / goalRadius - nx * cos, ty = gy / goalRadius - ny * cos, tz = gz / goalRadius - nz * cos;
    let tangent = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tangent < 1e-6) {
      // Antipodal start: project a nonparallel coordinate axis into the tangent plane.
      const useX = Math.abs(nx) < 0.8, projection = useX ? nx : ny;
      tx = (useX ? 1 : 0) - nx * projection;
      ty = (useX ? 0 : 1) - ny * projection;
      tz = -nz * projection;
      tangent = Math.sqrt(tx * tx + ty * ty + tz * tz);
    }
    // Bound the chord, including for large stations: it must stay outside keepOut + 1 m.
    const angle = Math.min(0.35, Math.acos(cos), Math.acos((keepOut + 1) / clearance));
    const c = Math.cos(angle), s = Math.sin(angle) / tangent;
    wx = nx * c + tx * s; wy = ny * c + ty * s; wz = nz * c + tz * s;
  }
  destination.x = wx * orbit - dx;
  destination.y = wy * orbit - dy;
  destination.z = wz * orbit - dz;
  return movingClear ? 'Moving clear' : 'Circling';
}

/** RCS-only, 10 Hz closed-loop guidance; the normal simulation owns forces, resources and the latch. */
export function autoDock(world: World, ownUid?: number | null): Autopilot {
  const mine = dockingAssistPort(world, ownUid), target = targetedPort(world), active = world.active;
  if (!mine || !target || !active) throw new Error('Select a free target port and a free own port');
  const id = active.state.id, targetId = target.vessel.id, portUid = mine.part.uid, targetUid = target.part.uid;
  // Leave room for the inflated line-up corridor even on craft larger than the 15 m minimum.
  const standoff = Math.max(15, active.state.cache.boundingRadius + target.vessel.cache.boundingRadius + 10);
  const env = world.universe.createEnvironment(() => active.body, world.preciseGravity);
  const step: AutopilotStep = { input: neutralInput({ sas: 'portAlign', rcs: true }) };
  let first = true, last = -Infinity, phase: Phase = 'Stopping';
  const start = world.ut;
  const ap: Autopilot = {
    name: 'Auto-dock', cancelOnAnyInput: true, status: phase, done: false,
    update(w) {
      // Consume the one-shot rebase even when a render frame precedes the next guidance sample.
      step.input.commands = undefined;
      if (w.ut - last < 0.1 - 1e-6) return step;
      last = w.ut;
      const v = w.active?.state, tv = w.vessels.get(targetId)?.state;
      const p = v?.cache.byUid.get(portUid), tp = tv?.cache.byUid.get(targetUid);
      const fail = (reason: string) => { ap.error = reason; step.input = neutralInput({ sas: 'stabilityAssist' }); return step; };
      if (!v || v.id !== id || v.destroyed) return fail('active vessel changed or lost');
      if (!tv && v.parts.some(part => part.docked?.vesselId === targetId) && p && dockedPartner(v, p)) {
        ap.done = true; ap.status = 'Docked'; step.input = neutralInput({ sas: 'stabilityAssist' }); return step;
      }
      if (w.targetId !== targetId || w.targetPortUid !== targetUid) return fail('target port changed or lost');
      if (!p || !tv || !tp || !isPortFree(v, p) || !isPortFree(tv, tp)) return fail('docking port is no longer free');
      const a = portInfo(v, p)!, b = portInfo(tv, tp)!;
      if (a.mod.size !== b.mod.size) return fail('port size mismatch');
      if (p.dockDisarmed || tp.dockDisarmed) return fail('port is rearming; drift clear before docking');
      if (length(tv.angularVelocity) > MAX_TARGET_RATE) return fail('target tumbling too fast (limit 0.6°/s)');
      const offset = sub(a.pos, b.pos), relative = sub(a.vel, b.vel);
      if (length(offset) > DOCK_ASSIST_RANGE) return fail('target port beyond 2 km');
      if (length(relative) > DOCK_ASSIST_SPEED) return fail('relative speed above 5 m/s');
      if (totalResource(v, 'monopropellant') <= 1e-6) return fail('out of RCS propellant');
      if (w.ut - start > 1800) return fail('docking timed out; check RCS and attitude authority');
      if (first) {
        first = false;
        step.input.commands = [{ kind: 'control', uid: portUid }];
        step.input.targetPortOrientation = targetPortOrientation(w);
        return step;
      }
      const force = translationForce(v);
      if (force.some(f => f < 1e-3)) return fail('RCS translation required in all six directions; check thrusters and axis settings');
      const authority = Math.min(...force) / v.mass;
      const angle = Math.acos(clamp(-dot(a.dir, b.dir), 1));
      const axial = dot(offset, b.dir);
      const lateral = sub(offset, scale(b.dir, axial));
      if (phase === 'Stopping' && length(relative) < 0.04) phase = 'Aligning';
      if (phase === 'Aligning' && angle < Math.PI / 90 && length(v.angularVelocity) < 0.01) phase = 'Lining up';
      if (phase === 'Lining up' && length(lateral) < 0.12 && Math.abs(axial - standoff) < 0.4 && length(relative) < 0.04) phase = 'Closing';
      // Reacquire the safe standoff if a disturbance spoils the final corridor.
      if (phase === 'Closing' && (angle > Math.PI / 30 || length(lateral) > 0.5)) phase = 'Lining up';
      let desired = v3();
      let status: string = phase;
      if (phase === 'Lining up' || phase === 'Closing') {
        const destination = scale(b.dir, phase === 'Closing' ? 0 : standoff);
        if (phase === 'Lining up') status = lineUpDestination(destination, a, b);
        const error = sub(destination, offset);
        const distance = length(error);
        const maxSpeed = phase === 'Closing' ? (axial < 10 ? 0.12 : 0.35) : 1.5;
        const speed = Math.min(maxSpeed, distance * 0.3, Math.sqrt(2 * authority * 0.3 * distance));
        if (distance > 1e-6) desired = scale(error, speed / distance);
        desired = add(desired, cross(qRotate(tv.orientation, tv.angularVelocity), destination));
      }
      const gravity = sub(env.gravity(v.position, w.ut), env.gravity(tv.position, w.ut));
      const acc = sub(scale(sub(desired, relative), 0.8), gravity);
      const body = qRotate(qConj(v.orientation), acc);
      const command = (value: number, axis: number) => clamp(value * v.mass / force[2 * axis + (value < 0 ? 1 : 0)], 0.7);
      const input = step.input;
      input.translateX = command(body.x, 0); input.translateY = command(body.y, 1); input.translateZ = command(body.z, 2);
      input.targetPortOrientation = targetPortOrientation(w);
      // Inside the capture field, let the existing magnetic collar pull the faces together without fighting it.
      if (length(offset) < Math.min(a.mod.captureRange, b.mod.captureRange) && angle < Math.min(a.mod.captureAngle, b.mod.captureAngle) && length(relative) < Math.min(a.mod.captureSpeed, b.mod.captureSpeed)) {
        input.translateX = input.translateY = input.translateZ = 0;
      }
      ap.status = phase === 'Closing' ? `Closing ${Math.max(0, axial).toFixed(1)} m` : status;
      return step;
    },
  };
  return ap;
}
