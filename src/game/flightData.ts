import type { World, WorldVessel } from './world';
import { ballisticImpact, targetPlaneNodes, phaseAngle, suicideBurn, period, burnTimeEstimate, periapsisRadius } from '../sim/orbit';
import { biomeAt } from '../sim/science/biomes';
import { type StageDeltaV } from '../sim/vessel';
import { add, cross, dot, length, normalize, sub, v3 } from '../util/vec3';
import { qConj, qRotate } from '../util/quat';
import { formatDuration, formatDistance, formatSpeed } from '../ui/format';

export function targetOrbitState(w: World, v: WorldVessel) {
  if (!w.targetId) return null;
  const tv = w.vessels.get(w.targetId);
  if (tv) return tv.body === v.body ? w.relativeState(tv) : null;
  const body = w.universe.bodies.get(w.targetId);
  return body?.parent === v.body ? w.universe.ephem.getRelativeState(body.id, w.ut) : null;
}
export function flightPredictions(w: World, v: WorldVessel) {
  const u = w.universe, orbit = w.orbitOf(v), b = u.body(v.body);
  const target = targetOrbitState(w, v);
  const crossings = target ? targetPlaneNodes(orbit, cross(target.position, target.velocity), w.ut) : [];
  const soi = w.trajectory().find(p => p.orbit.body === v.body && (p.endReason === 'soiEnter' || p.endReason === 'soiExit'));
  const impact = b.solidSurface && periapsisRadius(orbit) <= b.radius + Math.max(0, u.terrain(b.id).maxHeight) && v.state.situation !== 'landed' && v.mode !== 'prelaunch'
    ? ballisticImpact(orbit, w.ut, (p, t) => u.surfaceInfo(v.body, add(u.ephem.getBodyState(v.body, t).position, p), t).heightAboveTerrain,
      (p, t) => u.ephem.surfaceVelocity(v.body, p, t), Math.min(period(orbit), soi ? Math.max(0, soi.endTime - w.ut) : 86400)) : null;
  return { crossings, impact };
}
export type FlightData = { title: string; rows: [string, string][] }[];
export function flightData(w: World, v: WorldVessel, stages: StageDeltaV[], predictions: ReturnType<typeof flightPredictions>): FlightData {
  const u = w.universe, b = u.body(v.body), st = v.state, rs = w.relativeState(v), o = w.orbitOf(v);
  const info = u.surfaceInfo(v.body, st.position, w.ut), gravity = b.gm / info.r ** 2;
  const active = st.parts.filter(p => p.engine?.ignited);
  const stage = active.length ? stages.find(s => s.stage === st.nextStage + 1) : stages.find(s => s.thrust > 0);
  const currentThrust = active.reduce((sum, p) => sum + (p.engine?.thrust ?? 0), 0);
  const maxThrust = stage?.thrust ?? 0;
  const vel = w.surfaceVelocity(v), local = qRotate(qConj(st.orientation), vel);
  const up = normalize(rs.position), pole = qRotate(u.ephem.bodyRotation(v.body, w.ut), v3(0, 0, 1));
  let east = normalize(cross(pole, up));
  if (length(east) < 1e-8) east = normalize(cross(v3(1, 0, 0), up));
  const north = cross(up, east), forward = qRotate(st.orientation, v3(0, 1, 0)), top = qRotate(st.orientation, v3(0, 0, 1));
  const deg = (x: number | null) => x !== null && Number.isFinite(x) ? `${(x * 180 / Math.PI).toFixed(1)}°` : '—';
  const heading = (Math.atan2(dot(forward, east), dot(forward, north)) + 2 * Math.PI) % (2 * Math.PI);
  const horizonTop = normalize(sub(up, { x: forward.x * dot(up, forward), y: forward.y * dot(up, forward), z: forward.z * dot(up, forward) }));
  const roll = length(horizonTop) > 1e-7 ? Math.atan2(dot(cross(horizonTop, top), forward), dot(horizonTop, top)) : NaN;
  const suicide = suicideBurn(info.heightAboveTerrain, w.verticalSpeed(v), gravity, maxThrust / st.mass);
  // Axial drag-only terminal speed, exposed forward/rear faces; lift and Mach effects excluded.
  const cdArea = st.parts.reduce((sum, p) => sum + p.def.dragCoefficient.axial * Math.max(...(st.cache.exposed.get(p.uid)?.slice(2, 4) ?? [0])), 0);
  const terminal = st.telemetry.airDensity * cdArea > 0 ? Math.sqrt(2 * st.mass * gravity / (st.telemetry.airDensity * cdArea)) : Infinity;
  const node = w.nodes[0], target = targetOrbitState(w, v);
  let phase = target ? phaseAngle(rs.position, target.position, cross(rs.position, rs.velocity)) : null;
  // Sibling planets use the common heliocentric reference instead of the parking orbit.
  const tb = w.targetId ? u.bodies.get(w.targetId) : null;
  if (b.parent && tb?.parent === b.parent) {
    const a = u.ephem.getRelativeState(b.id, w.ut), t = u.ephem.getRelativeState(tb.id, w.ut);
    phase = phaseAngle(a.position, t.position, cross(a.position, a.velocity));
  }
  const dt = (n: number) => Number.isFinite(n) ? formatDuration(n) : '—';
  return [
    { title: 'Propulsion', rows: [
      ['TWR current / max', `${(currentThrust / st.mass / gravity).toFixed(2)} / ${(maxThrust / st.mass / gravity).toFixed(2)}`],
      ['Stage Δv / vacuum', `${(stage?.dv ?? 0).toFixed(0)} / ${(stage?.dvVac ?? 0).toFixed(0)} m/s`],
      ['Total Δv / vacuum', `${stages.reduce((s, x) => s + x.dv, 0).toFixed(0)} / ${stages.reduce((s, x) => s + x.dvVac, 0).toFixed(0)} m/s`],
      ['Next node burn', node && maxThrust > 0 ? dt(burnTimeEstimate(Math.hypot(node.prograde, node.normal, node.radial), maxThrust, st.mass, stage?.isp ?? 300)) : '—'],
    ] },
    { title: 'Surface & atmosphere', rows: [
      ['Ballistic impact', predictions.impact ? dt(predictions.impact.time - w.ut) : '—'],
      ['Impact speed (no drag)', predictions.impact ? formatSpeed(predictions.impact.speed) : '—'],
      ['Burn start altitude', suicide ? formatDistance(suicide.startAltitude) : '—'],
      ['Burn countdown', suicide ? suicide.overdue ? 'BURN NOW' : dt(suicide.countdown) : '—'],
      ['Terminal speed (axial)', Number.isFinite(terminal) ? formatSpeed(terminal) : '—'],
      ['Biome', biomeAt(b, u.terrain(b.id), info.fixedDir)],
    ] },
    { title: 'Attitude', rows: [
      ['Angle of attack', length(vel) > 0.5 ? deg(Math.atan2(-local.z, local.y)) : '—'],
      ['Sideslip', length(vel) > 0.5 ? deg(Math.asin(Math.max(-1, Math.min(1, local.x / length(vel))))) : '—'],
      ['Heading / pitch / roll', `${deg(heading)} / ${deg(Math.asin(Math.max(-1, Math.min(1, dot(forward, up)))))} / ${deg(roll)}`],
    ] },
    { title: 'Orbit & target', rows: [
      ['Inclination', deg(o.i)], ['Eccentricity', o.e.toFixed(5)], ['Period', dt(period(o))],
      ['LAN / argument Pe', `${deg(o.lan)} / ${deg(o.argPe)}`],
      ['Time to AN / DN', ['AN', 'DN'].map(k => { const c = predictions.crossings.find(x => x.kind === k); return c ? dt(c.time - w.ut) : '—'; }).join(' / ')],
      ['Phase angle', deg(phase)],
    ] },
  ];
}
