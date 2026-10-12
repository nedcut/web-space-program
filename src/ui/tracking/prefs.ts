import { KIND_ORDER, type FleetGrouping, type FleetSort, type VesselKind } from './fleet';

/** Fleet list view choices, remembered across visits (per browser, not per save). */
export interface TrackingPrefs { group: FleetGrouping; sort: FleetSort; hidden: VesselKind[] }
export const DEFAULT_PREFS: TrackingPrefs = { group: 'body', sort: 'next', hidden: ['debris'] };
const KEY = 'wsp.tracking.v1';

export function loadTrackingPrefs(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TrackingPrefs {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<TrackingPrefs> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
    return {
      group: raw.group === 'type' || raw.group === 'none' || raw.group === 'body' ? raw.group : DEFAULT_PREFS.group,
      sort: raw.sort === 'name' || raw.sort === 'launch' || raw.sort === 'next' ? raw.sort : DEFAULT_PREFS.sort,
      hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((k): k is VesselKind => KIND_ORDER.includes(k)) : [...DEFAULT_PREFS.hidden],
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveTrackingPrefs(p: TrackingPrefs, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
