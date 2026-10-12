import type { Contract } from '../sim/science/progression';

/** `open` (the default) is the work on the desk: active and offered commissions. */
export type MissionFilter = 'open' | 'all' | Contract['status'];
export const MISSION_FILTERS: readonly MissionFilter[] = ['open', 'active', 'offered', 'completed', 'failed', 'all'];
const ORDER: Record<Contract['status'], number> = { active: 0, offered: 1, completed: 2, failed: 3 };

/** Contracts shown under `filter`, work in progress first (active, offered, then the record). */
export function visibleContracts<T extends Pick<Contract, 'status'>>(contracts: readonly T[], filter: MissionFilter): T[] {
  return contracts.filter(c => filter === 'all' || c.status === filter || filter === 'open' && (c.status === 'active' || c.status === 'offered')).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
export function contractCounts(contracts: readonly Pick<Contract, 'status'>[]): Record<MissionFilter, number> {
  const counts: Record<MissionFilter, number> = { open: 0, all: contracts.length, active: 0, offered: 0, completed: 0, failed: 0 };
  for (const c of contracts) counts[c.status]++;
  counts.open = counts.active + counts.offered;
  return counts;
}
