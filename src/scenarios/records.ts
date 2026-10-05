import { SCENARIOS } from './catalog';
import type { Result } from './evaluation';
export const RECORD_KEY = 'wsp.scenarios.v1';
export interface RecordStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readBests(storage?: RecordStore): Record<string, Result> {
  try {
    const raw: unknown = JSON.parse((storage ?? localStorage).getItem(RECORD_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const bests: Record<string, Result> = {};
    for (const scenario of SCENARIOS) {
      const value = (raw as Record<string, unknown>)[scenario.id];
      if (!value || typeof value !== 'object') continue;
      const r = value as Result;
      if (r.success === true && ['bronze', 'silver', 'gold'].includes(r.medal) && Number.isFinite(r.score) && r.score > 0 && Number.isFinite(r.elapsed) && r.elapsed >= 0 && Number.isFinite(r.dv) && r.dv >= 0 && typeof r.scienceBonus === 'boolean' && (r.precision === null || Number.isFinite(r.precision) && r.precision >= 0) && (r.landingSpeed === null || Number.isFinite(r.landingSpeed) && r.landingSpeed >= 0)) bests[scenario.id] = r;
    }
    return bests;
  } catch { return {}; }
}
export function saveBest(id: string, result: Result, storage?: RecordStore): boolean {
  if (!result.success || !SCENARIOS.some(s => s.id === id)) return false;
  try {
    const bests = readBests(storage), old = bests[id];
    const rank = { none: 0, bronze: 1, silver: 2, gold: 3 };
    if (old && (rank[old.medal] > rank[result.medal] || rank[old.medal] === rank[result.medal] && old.score >= result.score)) return false;
    (storage ?? localStorage).setItem(RECORD_KEY, JSON.stringify({ ...bests, [id]: result }));
    return true;
  } catch { return false; }
}
