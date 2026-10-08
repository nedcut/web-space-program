import type { WorldVessel } from '../../game/world';
import type { HudStage } from '../hud/Hud';
import type { StageDeltaV } from '../../sim/vessel/staging';
import type { PartState, VesselState } from '../../sim/vessel/runtime';
import type { EngineModule, ResourceId } from '../../sim/vessel/types';
import { availableResource, flowGroups } from '../../sim/vessel/resources';

/** Fraction of an engine's first propellant still reachable through its feed groups (null: none tracked). */
function engineFuelFraction(st: WorldVessel['state'], p: PartState): number | undefined {
  const m = p.def.modules.find((x): x is EngineModule => x.type === 'engine');
  const res = m && (Object.keys(m.propellants) as ResourceId[]).find(r => r !== 'electricCharge' && r !== 'intakeAir');
  if (!res) return undefined;
  let cap = 0;
  for (const g of flowGroups(st, p.uid, res)) for (const uid of g) cap += st.cache.byUid.get(uid)?.maxResources[res] ?? 0;
  return cap > 0 ? Math.max(0, Math.min(1, availableResource(st, p.uid, res) / cap)) : undefined;
}

/** Hottest skin/core temperature as a fraction of the part's limit. */
function heatFraction(p: PartState): number {
  let f = p.temperature / p.maxTemp;
  for (const t of p.skinTemperature) f = Math.max(f, t / p.maxTemp);
  return f;
}

/** Group the displayed hardware by the same stage IDs as the burn estimator. */
export function hudStages(st: VesselState, dvs: StageDeltaV[]): HudStage[] {
  const stageMap = new Map<number, HudStage>();
  for (const p of st.parts) {
    // Engines that are already burning are listed as the current ("burning") stage so its Δv stays visible.
    const burning = !!p.engine?.ignited;
    if (!burning && (p.stage === undefined || p.activated)) continue;
    const types = p.def.modules.map((m) => m.type);
    const engine = p.def.modules.find((m): m is EngineModule => m.type === 'engine');
    const icon: HudStage['parts'][number]['icon'] = engine ? (engine.plume === 'solid' ? 'solid' : 'engine') : types.includes('decoupler') ? 'decoupler'
      : types.includes('parachute') ? 'chute' : types.includes('fairing') ? 'fairing' : types.includes('dockingPort') ? 'port' : types.includes('science') ? 'science' : 'other';
    const idx = burning ? st.nextStage + 1 : p.stage!;
    const s = stageMap.get(idx) ?? { index: idx, parts: [], deltaV: 0 };
    const fuel = engine ? engineFuelFraction(st, p) : undefined;
    const heat = heatFraction(p);
    s.parts.push({ uid: p.uid, name: p.def.name, icon, active: burning || p.activated,
      ...(fuel === undefined ? {} : { fuelFrac: Math.round(fuel * 100) / 100 }), ...(heat > 0.5 ? { heatFrac: Math.round(heat * 50) / 50 } : {}) });
    stageMap.set(idx, s);
  }
  const stages = [...stageMap.values()].sort((a, b2) => b2.index - a.index);
  stages.forEach((s) => {
    const d = dvs.find((x) => x.stage === s.index);
    s.deltaV = d?.dv ?? 0;
  });

  return stages;
}
