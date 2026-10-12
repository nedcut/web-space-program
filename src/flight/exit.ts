import { formatDistance } from '../util/format';
import type { FlightRecord } from '../game/flightlog/recorder';

/**
 * Leaving flight for the Space Center lands on the hub (not the Flight Log). The flight's report stays
 * reachable: `World.latestReportId` (saved with the world) names it, and the hub shows a one-line notice
 * until it has a debrief card of its own.
 */
export function flightExitNotice(world: { latestReportId: string | null; flightlog: { records: FlightRecord[] } }, existing: string | null): string | null {
  const r = world.latestReportId ? world.flightlog.records.find(x => x.id === world.latestReportId) : undefined;
  if (!r) return existing;
  if (existing) return `${existing} · report in the Flight Log`;
  return `${r.name}: flight report in the Flight Log${r.stats.maxAltitude > 0 ? ` (max altitude ${formatDistance(r.stats.maxAltitude)})` : ''}`;
}
