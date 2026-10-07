import { whyCantStage } from '../game/cues';
import { availableResource } from '../sim/vessel/resources';
import { engineModule } from '../sim/vessel/engines';
import type { PartState, VesselState } from '../sim/vessel/runtime';
import type { ResourceId } from '../sim/vessel/types';

export function hasEngineFuel(v: VesselState, p: PartState): boolean {
  const engine = engineModule(p);
  return !!engine && Object.entries(engine.propellants).every(([id, ratio]) => !ratio || id === 'intakeAir' || availableResource(v, p.uid, id as ResourceId) > 1e-9);
}
export function stageExplanation(v: VesselState, locked: boolean, control: boolean): string | null {
  const parts = v.parts.filter(p => p.stage === v.nextStage && !p.activated);
  return whyCantStage({ locked, control, eva: !!v.eva, remaining: v.nextStage >= 0,
    engines: parts.some(p => !!p.engine), fuel: parts.some(p => p.engine && hasEngineFuel(v, p)),
    useful: parts.some(p => p.def.modules.some(m => ['decoupler', 'parachute', 'fairing'].includes(m.type))) || v.parts.some(p => !!p.actions?.stage?.length),
  });
}
export function throttleExplanation(v: VesselState): string | null {
  const engines = v.parts.filter(p => p.engine);
  if (!engines.length) return 'No engine aboard — throttle cannot produce thrust';
  const active = engines.filter(p => p.engine!.ignited);
  if (!active.length) return engines.some(p => !p.activated)
    ? 'Engines not staged — activate the engine stage first'
    : 'Engines are shut down — activate one in its part menu';
  if (!active.some(p => hasEngineFuel(v, p))) return 'Active engines have no reachable propellant — stage or check the fuel path';
  if (active.every(p => p.engine!.flamedOut)) return 'Engine flameout — check intake air and remaining ignitions';
  return null;
}
