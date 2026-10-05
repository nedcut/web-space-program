import type { StateVector } from '../../sim/orbit/api';
import type { World, WorldVessel } from '../world';
import type { WorldInternals } from './internals';
import { shielding, stepHazards } from '../../sim/hazards/vessel';
import { removePart, recomputeMassProperties } from '../../sim/vessel/assembly';
import { period, propagate } from '../../sim/orbit';
import { add } from '../../util/vec3';
import { qConj, qMul, qRotate } from '../../util/quat';
import { AU } from '../../sim/vessel/env';
import { addResource } from '../../sim/vessel/resources';
import type { Vec3 } from '../../util/vec3';

/** Crew equivalent dose uses a unit radiation weighting factor; game warning, not medical guidance. */
export function advanceCrewDose(w: World, wv: WorldVessel, dt: number, rate?: number): void {
  if (!wv.state.eva && !wv.state.parts.some(p => p.crew?.length)) return;
  const dose = (rate ?? w.universe.createEnvironment(() => wv.body).radiation?.(wv.state.position, w.ut) ?? 0) * shielding(wv.state) * dt;
  if (dose <= 0) return;
  for (const c of w.crew) {
    if (wv.state.eva?.astronautId !== c.id && !wv.state.parts.some(p => p.crew?.includes(c.id))) continue;
    const before = c.radiationDose ?? 0;
    c.radiationDose = before + dose;
    if (wv.state.id === w.activeId && before < 0.1 && c.radiationDose >= 0.1) w.message(`${c.name}: accumulated radiation dose warning`, 'warn', 8);
  }
}

/** Rails quadrature follows the current conic, bounded to 2048 samples for multi-year warps.
 * Landed temperatures use exact exponential soak. No aerodynamic entry is integrated on rails. */
export function advancePackedHazards(w: World, internals: WorldInternals, wv: WorldVessel, start: number, end: number, sampleState?: (t: number) => StateVector): void {
  const duration = end - start;
  if (duration <= 0 || wv.state.destroyed) return;
  const env = w.universe.createEnvironment(() => wv.body);
  const orbitalPeriod = wv.orbit ? period(wv.orbit) : Math.abs(w.universe.body(wv.body).rotationPeriod);
  const step = Math.max(1, Math.min(300, Number.isFinite(orbitalPeriod) ? orbitalPeriod / 64 : 300));
  const samples = Math.min(2048, Math.max(1, Math.ceil(duration / step)));
  const dt = duration / samples;
  const originalPosition = wv.state.position;
  for (let i = 0; i < samples && !wv.state.destroyed; i++) {
    const t = start + (i + 0.5) * dt;
    let pos: Vec3;
    if (sampleState) pos = sampleState(t).position;
    else if (wv.orbit) pos = add(w.universe.ephem.getBodyState(wv.body, t).position, propagate(wv.orbit, t).position);
    else if (wv.fixed) pos = add(w.universe.ephem.getBodyState(wv.body, t).position, w.universe.ephem.fromBodyFixed(wv.body, wv.fixed.pos, t));
    else pos = originalPosition;
    const rate = env.radiation?.(pos, t) ?? 0;
    advanceCrewDose(w, wv, dt, rate);
    const events: Parameters<typeof stepHazards>[3] = [];
    const failures = stepHazards(wv.state, { air: env.air(pos, t).sample, radiation: rate, timeScale: env.hazardTimeScale ?? 1 }, dt, events);
    for (const event of events) internals.handleEvent(event);
    for (const [uid, reason] of failures) {
      if (!wv.state.cache.byUid.has(uid)) continue;
      // Remove in the sampled frame so detached debris starts at the failure location.
      wv.state.position = pos;
      const fragments = removePart(wv.state, uid);
      internals.handleEvent({ type: 'partDestroyed', vesselId: wv.state.id, partUid: uid, reason });
      for (const fragment of fragments) if (!fragment.destroyed) {
        w.vessels.set(fragment.id, { state: fragment, mode: 'physics', body: wv.body });
      }
    }
    if (wv.state.destroyed) break;
    const sun = env.sun(pos, t);
    const orientation = wv.fixed ? qMul(w.universe.ephem.bodyRotation(wv.body, t), wv.fixed.orient) : wv.state.orientation;
    const sunBody = qRotate(qConj(orientation), sun.dir);
    let supply = 0;
    for (const p of wv.state.parts) for (const m of p.def.modules) {
      if (m.type === 'solarPanel') {
        const n = qRotate(p.rotation, { x: 0, y: 0, z: 1 });
        const incidence = m.tracking ? 1 : Math.max(0, n.x * sunBody.x + n.y * sunBody.y + n.z * sunBody.z);
        supply += m.chargeRate * (AU / sun.distance) ** 2 * (sun.exposure ?? 1) * incidence;
      }
      // Landed generators are already included in advanceISRU; orbiting generators are not.
      if (m.type === 'generator' && wv.mode === 'rails') supply += m.chargeRate;
    }
    // Preserve background hibernation: command/wheel consumption remains physics-only.
    addResource(wv.state, 'electricCharge', supply * dt);
  }
  wv.state.position = originalPosition;
  if (wv.state.destroyed) {
    w.finishFlight(wv, 'lost', end);
    w.vessels.delete(wv.state.id);
    if (w.activeId === wv.state.id) { w.message(`${wv.state.name} lost to environmental hazards`, 'bad', 8); w.activeId = null; }
  } else recomputeMassProperties(wv.state, false);
}
