import type { PartDef } from '../vessel/types';
import type { VesselState, VesselEvent } from '../vessel/runtime';
import type { AtmosphereSample } from '../atmosphere/api';

export const electronics = (p: PartDef) => p.modules.some(m => m.type === 'science' || m.type === 'surveyScanner' || m.type === 'surfaceScanner' || (m.type === 'command' && m.crew === 0));
export function pressureLimit(p: PartDef): number {
  return p.maxPressure ?? (p.category === 'fuelTank' ? 4e6 : p.category === 'command' ? electronics(p) ? 1e6 : 3e6 : 2e6);
}
export const operatingLimit = (p: PartDef) => Math.min(p.maxTemp, p.maxOperatingTemp ?? (electronics(p) ? 400 : p.category === 'command' ? 430 : p.maxTemp));
/** Best vault protects the connected assembly; factors do not stack. */
export function shielding(v: VesselState): number {
  let factor = 1;
  for (const p of v.parts) for (const m of p.def.modules) if (m.type === 'radiationShield') factor = Math.min(factor, Math.max(0.001, m.factor));
  return factor;
}
export interface HazardContext { air: AtmosphereSample; radiation: number; timeScale: number }
export type HazardFailure = [number, 'pressure' | 'overheat'];
/** Analytic heat soak and dose work for both fixed steps and rails intervals. */
export function stepHazards(v: VesselState, ctx: HazardContext, dt: number, events: VesselEvent[] = []): HazardFailure[] {
  const failures: HazardFailure[] = [];
  const dose = Math.max(0, ctx.radiation) * shielding(v) * dt;
  for (const p of v.parts) {
    p.radiationDose = (p.radiationDose ?? 0) + dose;
    if (electronics(p.def)) {
      const limit = p.def.maxRadiationDose ?? 100;
      if (!p.electronicsDegraded && p.radiationDose >= limit * 0.5) {
        p.electronicsDegraded = true;
        events.push({ type: 'hazardWarning', vesselId: v.id, message: `${p.def.name}: radiation degradation (power demand / science yield impaired)` });
      }
      if (!p.electronicsFailed && p.radiationDose >= limit) {
        p.electronicsFailed = true;
        events.push({ type: 'hazardWarning', vesselId: v.id, message: `${p.def.name}: electronics failed from radiation` });
      }
    }
    const overload = ctx.air.pressure / pressureLimit(p.def);
    p.pressureExposure = overload > 1 ? (p.pressureExposure ?? 0) + dt * (overload - 1) / 30 : 0;
    if (overload > 0.8 && !p.pressureWarned) {
      p.pressureWarned = true;
      events.push({ type: 'hazardWarning', vesselId: v.id, message: `${p.def.name}: approaching or exceeding pressure rating` });
    }
    if (p.pressureExposure >= 1) failures.push([p.uid, 'pressure']);
    if (ctx.air.pressure > 0 && ctx.air.temperature > 0) {
      const initial = p.ambientTemperature ?? 288;
      const tau = (p.def.heatSoakTime ?? 120) * ctx.timeScale / Math.max(0.01, Math.sqrt(ctx.air.pressure / 9.2e6));
      p.ambientTemperature = initial + (ctx.air.temperature - initial) * -Math.expm1(-dt / tau);
      const limit = operatingLimit(p.def);
      if (p.ambientTemperature > limit * 0.9 && !p.heatWarned) {
        p.heatWarned = true;
        events.push({ type: 'hazardWarning', vesselId: v.id, message: `${p.def.name}: internal heat-soak limit approaching` });
      }
      if (p.ambientTemperature > limit) failures.push([p.uid, 'overheat']);
    }
  }
  return failures;
}
