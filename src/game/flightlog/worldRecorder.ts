import { apoapsisRadius, periapsisRadius } from '../../sim/orbit';
import type { World, WorldVessel } from '../world';
import { length, dot, normalize } from '../../util/vec3';
import { qConj, qRotate } from '../../util/quat';
import { cachedStageDeltaV } from '../stageDeltaVCache';
import { scienceContext } from '../science';
import { crossesRingPlane, observe, recordFor, sampleInterval, startRecord } from './recorder';
/** Fast integration runs every physics step; orbital/terrain/Δv work follows the adaptive sample clock. */
export function recordVessel(w: World, v: WorldVessel, ut = w.ut, force = false) {
  const s = v.state, b = w.universe.body(v.body);
  const r = recordFor(w.flightlog, s.id) ?? startRecord(w.flightlog, s.id, s.name, ut);
  const last = r.last;
  const relative = w.relativeState(v, ut), radius = length(relative.position);
  const surface = (() => { const rs = relative; const rotation = w.universe.ephem.surfaceVelocity(v.body, rs.position, ut); return { x: rs.velocity.x - rotation.x, y: rs.velocity.y - rotation.y, z: rs.velocity.z - rotation.z }; })();
  const speed = length(surface), vertical = dot(surface, normalize(relative.position));
  // Packed states retain the last physics telemetry; it must never count as ongoing thrust during warp.
  const telemetry = v.mode === 'physics' ? s.telemetry : { ...s.telemetry, thrust: 0, dynamicPressure: 0, mach: 0, gForce: v.mode === 'rails' ? 0 : b.gm / (radius * radius * 9.80665) };
  r.stats.maxAltitude = Math.max(r.stats.maxAltitude, radius - b.radius);
  r.stats.maxSpeed = Math.max(r.stats.maxSpeed, speed);

  if (!force && last && last.body === v.body && last.flying === (s.situation === 'flying') && last.prelaunch === (v.mode === 'prelaunch') && ut - last.ut < sampleInterval({ ...last, thrustAcceleration: telemetry.thrust / Math.max(1, s.mass), q: telemetry.dynamicPressure })) {
    // Capture short-lived peak loads and integrate thrust at the actual physics rate.
    r.stats.maxG = Math.max(r.stats.maxG, telemetry.gForce);
    if (speed > 1500 && telemetry.dynamicPressure > 100 && !last.shield) r.hotUnshielded ||= s.parts.some(p => p.temperature > 1000 || p.skinTemperature.some(t => t > 1000));
    r.stats.dvSpent += telemetry.thrust / Math.max(1, s.mass) * Math.max(0, ut - (r.integrationUt ?? last.ut));
    r.integrationUt = ut;
    return;
  }
  const orbit = w.orbitOf(v);
  const o = { ap: apoapsisRadius(orbit) - b.radius, pe: periapsisRadius(orbit) - b.radius };
  const temperature = Math.max(0, ...s.parts.flatMap(p => [p.temperature, ...p.skinTemperature]));
  const fixed = qRotate(qConj(w.universe.ephem.bodyRotation(v.body, ut)), relative.position);
  const planar = Math.hypot(fixed.x, fixed.y);
  const dt = last ? Math.max(0, ut - (r.integrationUt ?? last.ut)) : 0;
  r.stats.dvSpent += telemetry.thrust / Math.max(1, s.mass) * dt;
  r.integrationUt = ut;
  // Full staging projections are expensive for large craft. Refresh at 1 Hz (or immediately after
  // topology changes), and subtract measured thrust Δv between projections.
  const topology = `${v.body}:${s.nextStage}:${s.parts.map(p => `${p.uid}:${p.engine?.ignited}:${p.engine?.moduleIndex}`).join(',')}`;
  if (!r.deltaVEstimate || r.deltaVEstimate.topology !== topology || ut - r.deltaVEstimate.ut >= 1) {
    r.deltaVEstimate = { ut, topology, spent: r.stats.dvSpent, value: cachedStageDeltaV(s, s.telemetry.staticPressure, 9.80665).reduce((sum, stage) => sum + stage.dv, 0) };
  }
  const dv = Math.max(0, r.deltaVEstimate.value - (r.stats.dvSpent - r.deltaVEstimate.spent));
  const ringPass = !!b.rings && (Math.abs(fixed.z) < Math.max(100, speed * 0.25) && planar >= b.rings.innerRadius && planar <= b.rings.outerRadius || !!r.ringPosition && r.ringPosition.body === v.body && crossesRingPlane(r.ringPosition, fixed, b.rings.innerRadius, b.rings.outerRadius));
  r.ringPosition = { body: v.body, ...fixed };
  observe(r, { inertialSpeed: length(relative.velocity), clearance: Number.isFinite(s.telemetry.altitudeAGL) ? s.telemetry.altitudeAGL : radius - b.radius, ut, body: v.body, altitude: radius - b.radius, speed, vertical, horizontal: Math.sqrt(Math.max(0, speed * speed - vertical * vertical)), ap: o.ap, pe: o.pe, mach: telemetry.mach, q: telemetry.dynamicPressure, g: telemetry.gForce, temperature, mass: s.mass,
    dv,
    thrustAcceleration: telemetry.thrust / Math.max(1, s.mass),
    flying: s.situation === 'flying', prelaunch: v.mode === 'prelaunch', stableOrbit: s.situation === 'flying' && orbit.e < 1 && o.pe > Math.max(b.atmosphere?.height ?? 0, w.universe.terrain(b.id).maxHeight), parts: s.parts.length,
    shield: s.parts.some(p => p.def.modules.some(m => m.type === 'heatShield')), plane: s.parts.some(p => p.def.modules.some(m => m.type === 'liftingSurface')),
    splashed: s.situation === 'splashed', biome: s.situation !== 'flying' ? scienceContext(w, v).biome : undefined,
    ringPass,
  }, force, false);
  // Preserve the current thrust for adaptive scheduling without integrating it twice.
  if (r.last) r.last.thrustAcceleration = telemetry.thrust / Math.max(1, s.mass);
  w.checkAchievements(r);
  return r;
}
