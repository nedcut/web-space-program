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

/** A throttle problem must persist briefly; Z then Space should not produce a refusal toast. */
export class ThrottleCueTracker {
  private pending: string | null = null;
  private since = 0;
  private announced: string | null = null;
  update(reason: string | null, now: number, staged: boolean): string | null {
    if (staged || reason !== this.pending) {
      this.pending = reason; this.since = now; this.announced = null;
    }
    if (!reason || staged || now - this.since < 0.75 || reason === this.announced) return null;
    this.announced = reason;
    return reason;
  }
}

const THROTTLE_TEXT = /^(Engines not staged|Engines are shut down|No engine aboard|Active engines have no reachable propellant|Engine flameout)/;
const MESSAGE_PRIORITY = { bad: 2, warn: 1, info: 0 };

/** Drop stale throttle explanations and show at most two distinct notifications, danger first. */
export function flightMessages<T extends { id: number; text: string; level: 'info' | 'warn' | 'bad' }>(messages: readonly T[], throttleReason: string | null, staged: boolean): T[] {
  const seen = new Set<string>();
  return messages.filter(m => {
    if (THROTTLE_TEXT.test(m.text) && (staged || m.text !== throttleReason)) return false;
    if (seen.has(m.text)) return false;
    seen.add(m.text); return true;
  }).sort((a, b) => (MESSAGE_PRIORITY[b.level] - MESSAGE_PRIORITY[a.level]) || b.id - a.id).slice(0, 2);
}
