import { PART_CATALOG } from '../../data/parts';
import { facilityProblem, launchProblem, type FacilityBlock } from '../../data/technology';
import type { ScalePresetId } from '../../sim/bodies/scale';
import { computeStageStats } from '../../editor/ui/dv';
import { fmtDv, fmtKg } from '../../editor/ui/partInfo';
import type { Body } from '../../sim/bodies/types';
import type { GameMode, Progression } from '../../sim/science/progression';
import type { CraftDef } from '../../sim/vessel/types';

/** One row of the Launch Pad picker. */
export interface LaunchOption {
  key: string;
  source: 'pad' | 'saved' | 'stock';
  craft: CraftDef;
  /** Parts · mass · Δv. */
  info: string;
  /** Why it cannot fly from here (locked parts, funds, no control), else null. */
  blocked: string | null;
  /** Flies, but probably not as hoped (first stage cannot lift off). */
  warning: string | null;
  /** A Space Center limit stands in the way (the row offers the upgrade). */
  facility: FacilityBlock | null;
}

/** The editor's launch rules without the editor: something to fly, a way to control it, research and funds. */
export function launchBlocker(craft: CraftDef, mode: GameMode, progression: Progression, preset: ScalePresetId = 'standard'): string | null {
  if (!craft.parts.length) return 'Empty vehicle';
  const control = craft.parts.some(p => PART_CATALOG.get(p.partId)?.modules.some(m => m.type === 'command' && m.controllable !== false));
  if (!control) return 'Needs a command pod or probe core';
  return launchProblem(craft, PART_CATALOG, mode, progression, preset);
}

/** Parts, wet mass, vacuum Δv and a lift-off warning for a rocket whose first powered stage is below 1 g. */
export function craftSummary(craft: CraftDef, earth: Body): { info: string; warning: string | null } {
  try {
    const stages = [...computeStageStats(craft, PART_CATALOG, earth).entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
    const dv = stages.reduce((n, s) => n + s.dvVac, 0);
    const mass = stages.reduce((m, s) => Math.max(m, s.startMass), 0);
    // Same reading as the editor's launch check: the first stage (in firing order) with thrust or Δv.
    const first = stages.find(s => s.twrAsl > 0 || s.dvVac > 0);
    const warning = craft.type === 'SPH' ? null : !first ? 'No engines: it will not leave the pad' : first.twrAsl < 1 ? `Lift-off TWR ${first.twrAsl.toFixed(2)}: too heavy to climb` : null;
    return { info: `${craft.parts.length} parts · ${mass > 0 ? `${fmtKg(mass)} · ` : ''}${fmtDv(dv)}`, warning };
  } catch {
    return { info: `${craft.parts.length} parts`, warning: null };
  }
}

/** Picker rows: the vehicle on the pad (from the editor) first, then saved designs, then stock for this scale. */
export function launchOptions(input: {
  pad: CraftDef | null; saved: readonly { id: string; craft: CraftDef }[]; stock: readonly { id: string; craft: CraftDef }[];
  mode: GameMode; progression: Progression; earth: Body; preset?: ScalePresetId;
}): LaunchOption[] {
  const row = (key: string, source: LaunchOption['source'], craft: CraftDef): LaunchOption => ({ key, source, craft, ...craftSummary(craft, input.earth),
    blocked: launchBlocker(craft, input.mode, input.progression, input.preset),
    facility: input.mode === 'career' && craft.parts.length ? facilityProblem(craft, PART_CATALOG, input.mode, input.progression, input.preset ?? 'standard') : null });
  return [
    ...(input.pad?.parts.length ? [row('pad', 'pad', input.pad)] : []),
    ...input.saved.map(s => row(`saved:${s.id}`, 'saved', s.craft)),
    ...input.stock.map(s => row(`stock:${s.id}`, 'stock', s.craft)),
  ];
}
