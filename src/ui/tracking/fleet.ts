/**
 * Fleet Tracking list model: vessel kinds, search/filter, grouping, sorting and list keys.
 * Pure data in, data out (no DOM, no World) so it is unit-tested; TrackingStation resolves the world state.
 */

export type VesselKind = 'station' | 'base' | 'ship' | 'lander' | 'rover' | 'plane' | 'probe' | 'astronaut' | 'debris' | 'flag';

/** Display order of kinds (type grouping, filter chips). */
export const KIND_ORDER: readonly VesselKind[] = ['station', 'base', 'ship', 'lander', 'rover', 'plane', 'probe', 'astronaut', 'debris', 'flag'];
export const KIND_LABEL: Record<VesselKind, { one: string; many: string }> = {
  station: { one: 'Station', many: 'Stations' },
  base: { one: 'Base', many: 'Bases' },
  ship: { one: 'Crewed ship', many: 'Crewed ships' },
  lander: { one: 'Lander', many: 'Landers' },
  rover: { one: 'Rover', many: 'Rovers' },
  plane: { one: 'Plane', many: 'Planes' },
  probe: { one: 'Probe', many: 'Probes' },
  astronaut: { one: 'Astronaut', many: 'Astronauts' },
  debris: { one: 'Debris', many: 'Debris' },
  flag: { one: 'Flag', many: 'Flags' },
};

interface ModuleLike { type: string; crew?: number; controllable?: false }
export interface PartLike { def: { modules: readonly ModuleLike[] } }

/**
 * Kind of a vessel from its parts. Nothing is stored on the vessel: a docked complex becomes a station the
 * moment it has two free-or-used docking ports, and a spent stage reads as debris (no controllable core).
 */
export function classifyParts(parts: readonly PartLike[], o: { eva?: boolean; landed?: boolean } = {}): VesselKind {
  if (o.eva) return 'astronaut';
  let control = false, seats = 0, ports = 0, wheels = 0, legs = 0, wings = 0, intakes = 0;
  for (const p of parts) for (const m of p.def.modules) {
    switch (m.type) {
      case 'command': if (m.controllable !== false) control = true; seats += m.crew ?? 0; break;
      case 'dockingPort': ports++; break;
      case 'wheel': wheels++; break;
      case 'landingLeg': legs++; break;
      case 'liftingSurface': wings++; break;
      case 'intake': intakes++; break;
    }
  }
  if (!control) return 'debris';
  if (ports >= 2) return o.landed ? 'base' : 'station';
  if (intakes > 0 || (wheels > 0 && wings >= 2)) return 'plane';
  if (wheels >= 2) return 'rover';
  if (legs > 0) return 'lander';
  return seats > 0 ? 'ship' : 'probe';
}

export interface FleetEvent { label: string; time: number }
export interface FleetEntry {
  /** Vessel id, or `flag:<id>` for a planted flag. */
  id: string;
  kind: VesselKind;
  name: string;
  /** Reference body id and display name. */
  body: string;
  bodyName: string;
  /** Situation line, e.g. "Orbiting", "Landed", "Sub-orbital". */
  status: string;
  /** Earliest upcoming event (node, alarm, SOI change, impact…). */
  next?: FleetEvent;
  /** Launch/creation order (insertion order of the world's vessel map). */
  order: number;
  active?: boolean;
  crew?: number;
}

/** Earliest candidate strictly after `now` (null/past candidates ignored). */
export function earliestEvent(now: number, candidates: readonly (FleetEvent | null | undefined)[]): FleetEvent | undefined {
  let best: FleetEvent | undefined;
  for (const c of candidates) if (c && Number.isFinite(c.time) && c.time > now && (!best || c.time < best.time)) best = c;
  return best;
}

export interface FleetFilter { query: string; hidden: ReadonlySet<VesselKind> }

/** Case-insensitive search over name, body and kind; every word must match. Hidden kinds are dropped. */
export function filterFleet(entries: readonly FleetEntry[], f: FleetFilter): FleetEntry[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(e => {
    if (f.hidden.has(e.kind)) return false;
    if (!words.length) return true;
    const hay = `${e.name} ${e.bodyName} ${KIND_LABEL[e.kind].one} ${KIND_LABEL[e.kind].many} ${e.status}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

export type FleetSort = 'next' | 'name' | 'launch';
export const SORT_LABEL: Record<FleetSort, string> = { next: 'Next event', name: 'Name', launch: 'Launch order' };
const byName = (a: FleetEntry, b: FleetEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.order - b.order;

export function sortFleet(entries: readonly FleetEntry[], sort: FleetSort): FleetEntry[] {
  const out = [...entries];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'launch') return out.sort((a, b) => a.order - b.order);
  // Soonest event first; vessels with nothing scheduled follow, by name.
  return out.sort((a, b) => (a.next?.time ?? Infinity) - (b.next?.time ?? Infinity) || byName(a, b));
}

export type FleetGrouping = 'body' | 'type' | 'none';
export const GROUP_LABEL: Record<FleetGrouping, string> = { body: 'Body', type: 'Type', none: 'None' };
export interface FleetGroup { key: string; label: string; entries: FleetEntry[] }

/**
 * Groups in display order: bodies by `bodyRank` (solar-system tree order), kinds by {@link KIND_ORDER}.
 * Entry order inside a group is the input order (sort first).
 */
export function groupFleet(entries: readonly FleetEntry[], by: FleetGrouping, bodyRank: (id: string) => number = () => 0): FleetGroup[] {
  if (by === 'none') return entries.length ? [{ key: 'all', label: 'All vessels', entries: [...entries] }] : [];
  const map = new Map<string, FleetGroup>();
  for (const e of entries) {
    const key = by === 'body' ? e.body : e.kind;
    let g = map.get(key);
    if (!g) map.set(key, g = { key, label: by === 'body' ? e.bodyName : KIND_LABEL[e.kind].many, entries: [] });
    g.entries.push(e);
  }
  const rank = (k: string) => by === 'body' ? bodyRank(k) : KIND_ORDER.indexOf(k as VesselKind);
  return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/** Count of entries per kind (for filter chips), before kind filtering. */
export function kindCounts(entries: readonly FleetEntry[]): Map<VesselKind, number> {
  const out = new Map<VesselKind, number>();
  for (const e of entries) out.set(e.kind, (out.get(e.kind) ?? 0) + 1);
  return out;
}

export type ListAction = 'fly' | 'focus' | 'rename' | 'terminate';
/**
 * Keyboard on the vessel list: ↑/↓ (and Home/End, PageUp/PageDown by 10) move the selection, Enter flies,
 * F focuses the view, F2 renames, Delete terminates. Returns null for keys the list does not use.
 */
export function listKey(key: string, index: number, count: number): { index: number } | { action: ListAction } | null {
  if (!count) return null;
  const at = index < 0 ? -1 : Math.min(index, count - 1);
  switch (key) {
    case 'ArrowDown': return { index: at < 0 ? 0 : Math.min(count - 1, at + 1) };
    case 'ArrowUp': return { index: at < 0 ? count - 1 : Math.max(0, at - 1) };
    case 'Home': return { index: 0 };
    case 'End': return { index: count - 1 };
    case 'PageDown': return { index: Math.min(count - 1, Math.max(0, at) + 10) };
    case 'PageUp': return { index: Math.max(0, at - 10) };
    case 'Enter': return at < 0 ? null : { action: 'fly' };
    case 'f': case 'F': return at < 0 ? null : { action: 'focus' };
    case 'F2': return at < 0 ? null : { action: 'rename' };
    case 'Delete': return at < 0 ? null : { action: 'terminate' };
    default: return null;
  }
}

/** Longest vessel name accepted by Rename. */
export const MAX_VESSEL_NAME = 60;
export const cleanVesselName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_VESSEL_NAME);
