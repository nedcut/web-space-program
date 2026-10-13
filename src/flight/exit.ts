import type { FlightRecord } from '../game/flightlog/recorder';
import type { CraftDef } from '../sim/vessel/types';
import { buildDebrief, type FlightDebrief, type ProgramTotals } from '../ui/hub/debrief';

/**
 * Leaving flight for the Space Center lands on the hub, which shows a debrief card for the flight's report
 * (`World.latestReportId`, saved with the world). Null when there is no report to summarise.
 */
export function flightDebrief(world: {
  latestReportId: string | null; flightlog: { records: FlightRecord[] }; mode: 'sandbox' | 'science' | 'career'; ut: number; progression: ProgramTotals;
}, opts: { before: ProgramTotals | null; crew: string[]; recoveryValue: number | null; craft: CraftDef | null; note: string | null }): FlightDebrief | null {
  const r = world.latestReportId ? world.flightlog.records.find(x => x.id === world.latestReportId) : undefined;
  if (!r) return null;
  return buildDebrief(r, { mode: world.mode, ut: world.ut, before: opts.before, after: world.progression, recoveryValue: opts.recoveryValue, crew: opts.crew, craft: opts.craft, note: opts.note });
}
