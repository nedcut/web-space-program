import { activeLinks } from './links';
import { seatCapacity, SUITED_MASS } from '../crew/crew';
import type { ResourceDef, ResourceId } from './types';
import type { PartState, VesselState } from './runtime';

/**
 * Resource flow.
 *
 *  - 'stack' (liquidFuel, oxidizer): flows through attach-node connections (not surface attachments),
 *    never through decouplers. Tanks are drained in priority groups: highest decouple stage first
 *    (the part that gets jettisoned soonest), then farthest from the root. Tanks in the same priority
 *    group drain proportionally (so they empty together, like symmetric tanks). Directed fuel lines
 *    bridge donor -> receiver stacks explicitly, draining upstream donors before downstream stacks.
 *  - 'all' (monoprop, EC, xenon): drawn proportionally from every part in the vessel.
 *  - 'none' (solidFuel, ablator): only from the consuming part itself.
 *
 * Mirrors src/data/resources.ts (sim may not import data; pass `resourceDefs` to override).
 */
export const DEFAULT_RESOURCE_DEFS: Record<ResourceId, ResourceDef> = {
  regolith: { id: 'regolith', name: 'Regolith', density: 2.5, flow: 'all' },
  liquidFuel: { id: 'liquidFuel', name: 'Kerolox Fuel', density: 0.81, flow: 'stack' },
  oxidizer: { id: 'oxidizer', name: 'Liquid Oxygen', density: 1.14, flow: 'stack' },
  monopropellant: { id: 'monopropellant', name: 'Hydrazine Monoprop', density: 1.0, flow: 'all' },
  xenon: { id: 'xenon', name: 'Xenon Gas', density: 2.9, flow: 'all' },
  solidFuel: { id: 'solidFuel', name: 'Solid Propellant Grain', density: 1.8, flow: 'none' },
  electricCharge: { id: 'electricCharge', name: 'Electric Charge', density: 0, flow: 'all' },
  ablator: { id: 'ablator', name: 'Ablative Resin', density: 1.0, flow: 'none' },
  /** Produced by intakes each step (1 unit = 1 kg of air); only a tiny buffer is held. Massless for simplicity. */
  intakeAir: { id: 'intakeAir', name: 'Intake Air', density: 0, flow: 'all' },
};

/** Amounts below this are snapped to zero to avoid endless tiny residues. */
const EPS_UNITS = 1e-9;

/** Optional ledger: when provided, draws are recorded (uid -> units) instead of applied. */
export type DrawLedger = Map<number, number>;

export const isDecoupler = (p: PartState): boolean => p.def.modules.some((m) => m.type === 'decoupler');

/** Parts connected to `p` through attach nodes (both directions). */
export function stackNeighbours(v: VesselState, p: PartState): PartState[] {
  const out: PartState[] = [];
  const by = v.cache.byUid;
  if (p.parent !== null && p.attachNode && p.attachNode !== 'srf') {
    const par = by.get(p.parent);
    if (par) out.push(par);
  }
  for (const c of p.children) {
    const ch = by.get(c);
    if (ch && ch.attachNode && ch.attachNode !== 'srf') out.push(ch);
  }
  return out;
}

/**
 * Build the stack-flow feed groups for an engine (or any consumer): BFS over node connections,
 * blocked by decouplers, sorted by (decoupleStage desc, depth desc, uid asc for determinism).
 */
export function buildFeedGroups(v: VesselState, consumerUid: number): number[][] {
  const start = v.cache.byUid.get(consumerUid);
  if (!start) return [];
  const queue: PartState[] = [start];
  // Surface-mounted engines and fuel cells can feed from their host stack; other radial
  // attachments still do not bridge separate stacks or bypass a decoupler.
  if (start.attachNode === 'srf' && start.parent !== null && start.def.modules.some(m => m.type === 'engine' || m.type === 'fuelCell')) {
    const host = v.cache.byUid.get(start.parent);
    if (host && !isDecoupler(host)) queue.push(host);
  }
  const found: PartState[] = [];
  const component = new Map<number, number>();
  const members: PartState[][] = [];
  // Discover ordinary stacks first; hoses explicitly bridge them without opening decouplers.
  const expand = (seed: PartState[], id: number) => {
    const local: PartState[] = [];
    for (let i = 0; i < seed.length; i++) {
      const p = seed[i];
      if (component.has(p.uid)) continue;
      component.set(p.uid, id); local.push(p); found.push(p);
      if (p !== start && isDecoupler(p)) continue;
      for (const n of stackNeighbours(v, p)) if (!component.has(n.uid) && !isDecoupler(n)) seed.push(n);
    }
    members.push(local);
  };
  expand(queue, 0);
  const hoses = activeLinks(v, 'fuelLine');
  const edges = new Map<number, Set<number>>(); // donor component -> receiving components
  let changed = true;
  while (changed) {
    changed = false;
    for (const hose of hoses) {
      const link = hose.link!;
      const receiver = component.get(link.targetUid);
      const donor = v.cache.byUid.get(link.sourceUid)!;
      if (receiver === undefined || isDecoupler(donor) || isDecoupler(v.cache.byUid.get(link.targetUid)!)) continue;
      if (!component.has(donor.uid)) { expand([donor], members.length); changed = true; }
      const source = component.get(donor.uid)!;
      if (source !== receiver) {
        if (!edges.has(source)) edges.set(source, new Set());
        edges.get(source)!.add(receiver);
      }
    }
  }
  // Longest directed distance to the consumer makes every upstream asparagus stack drain first.
  // A visiting guard bounds cyclic plumbing deterministically (cycles cannot manufacture resources).
  const priorities = new Map<number, number>();
  const rank = (id: number, visiting = new Set<number>()): number => {
    if (visiting.has(id)) return 0;
    if (priorities.has(id)) return priorities.get(id)!;
    visiting.add(id);
    const value = Math.max(0, ...[...(edges.get(id) ?? [])].map(n => rank(n, visiting) + 1));
    visiting.delete(id); priorities.set(id, value); return value;
  };
  for (let i = 0; i < members.length; i++) rank(i);
  const key = (p: PartState) => [priorities.get(component.get(p.uid)!) ?? 0,
    v.cache.decoupleStage.get(p.uid) ?? -1, v.cache.depth.get(p.uid) ?? 0] as const;
  found.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2] || a.uid - b.uid;
  });
  const groups: number[][] = [];
  let lastKey: readonly number[] | null = null;
  for (const p of found) {
    const k = key(p);
    if (!lastKey || k.some((n, i) => n !== lastKey![i])) groups.push([]);
    groups[groups.length - 1].push(p.uid);
    lastKey = k;
  }
  return groups;
}

/** Ordered draw groups (uids) for `res` consumed by part `consumerUid`. */
export function flowGroups(v: VesselState, consumerUid: number, res: ResourceId): number[][] {
  const flow = v.resourceDefs[res].flow;
  if (flow === 'none') return [[consumerUid]];
  if (flow === 'all') return [v.parts.filter((p) => (p.maxResources[res] ?? 0) > 0).map((p) => p.uid)];
  return v.cache.feed.get(consumerUid) ?? buildFeedGroups(v, consumerUid);
}

export function availableResource(v: VesselState, consumerUid: number, res: ResourceId): number {
  let sum = 0;
  for (const g of flowGroups(v, consumerUid, res))
    for (const uid of g) sum += v.cache.byUid.get(uid)?.resources[res] ?? 0;
  return sum;
}

/** Draw `amount` units of `res` through the given groups (priority order). Returns units drawn. */
export function drawFromGroups(
  v: VesselState,
  groups: number[][],
  res: ResourceId,
  amount: number,
  ledger?: DrawLedger,
): number {
  if (amount <= 0) return 0;
  let remaining = amount;
  const by = v.cache.byUid;
  for (const g of groups) {
    let total = 0;
    for (const uid of g) total += by.get(uid)?.resources[res] ?? 0;
    if (total <= 0) continue;
    const take = Math.min(total, remaining);
    for (const uid of g) {
      const p = by.get(uid);
      const have = p?.resources[res] ?? 0;
      if (!p || have <= 0) continue;
      const share = take * (have / total);
      if (ledger) ledger.set(uid, (ledger.get(uid) ?? 0) + share);
      else {
        const left = have - share;
        p.resources[res] = left < EPS_UNITS * Math.max(1, p.maxResources[res] ?? 1) ? 0 : left;
      }
    }
    remaining -= take;
    if (remaining <= amount * 1e-12) return amount;
  }
  return amount - remaining;
}

export function drawResource(v: VesselState, consumerUid: number, res: ResourceId, amount: number, ledger?: DrawLedger): number {
  return drawFromGroups(v, flowGroups(v, consumerUid, res), res, amount, ledger);
}

/**
 * Draw a propellant mix: `need` = units per resource. Supplies the same fraction f of every
 * resource (mixture ratio is respected) and returns f in [0,1]. f < 1 means a propellant ran dry.
 */
export function drawPropellants(
  v: VesselState,
  consumerUid: number,
  need: Partial<Record<ResourceId, number>>,
  dryRun = false,
): number {
  let f = 1;
  for (const k in need) {
    const res = k as ResourceId;
    const n = need[res] ?? 0;
    if (n <= 0) continue;
    const avail = availableResource(v, consumerUid, res);
    f = Math.min(f, avail / n);
  }
  f = Math.max(0, Math.min(1, f));
  if (!dryRun && f > 0) for (const k in need) drawResource(v, consumerUid, k as ResourceId, (need[k as ResourceId] ?? 0) * f);
  return f;
}

/** Add `amount` of an 'all'-flow resource (e.g. EC from solar panels) to parts with capacity. Returns added. */
export function addResource(v: VesselState, res: ResourceId, amount: number): number {
  if (amount <= 0) return 0;
  let space = 0;
  for (const p of v.parts) space += Math.max(0, (p.maxResources[res] ?? 0) - (p.resources[res] ?? 0));
  if (space <= 0) return 0;
  const add = Math.min(space, amount);
  for (const p of v.parts) {
    const s = Math.max(0, (p.maxResources[res] ?? 0) - (p.resources[res] ?? 0));
    if (s > 0) p.resources[res] = (p.resources[res] ?? 0) + add * (s / space);
  }
  return add;
}

export function totalResource(v: VesselState, res: ResourceId): number {
  let s = 0;
  for (const p of v.parts) s += p.resources[res] ?? 0;
  return s;
}

/** Continuous electrical sources. Fuel cells draw a balanced mix only for available storage. */
export function stepPowerSources(v: VesselState, dt: number): void {
  if (!(dt > 0)) return;
  for (const p of v.parts) for (const m of p.def.modules) {
    if (m.type === 'generator') addResource(v, 'electricCharge', m.chargeRate * dt);
    if (m.type !== 'fuelCell' || m.chargeRate <= 0) continue;
    const space = v.parts.reduce((n, q) => n + Math.max(0, (q.maxResources.electricCharge ?? 0) - (q.resources.electricCharge ?? 0)), 0);
    const duration = Math.min(dt, space / m.chargeRate);
    if (duration <= 0) continue;
    const fraction = drawPropellants(v, p.uid, { liquidFuel: m.fuelRate * duration, oxidizer: m.oxidizerRate * duration });
    addResource(v, 'electricCharge', m.chargeRate * duration * fraction);
  }
}

/** Mass of a part's current contents + dry mass. */
export function partMass(p: PartState, defs: Record<ResourceId, ResourceDef>): number {
  let m = p.def.dryMass - (p.crew ? (seatCapacity(p) - p.crew.length) * SUITED_MASS : 0);
  for (const k in p.resources) m += (p.resources[k as ResourceId] ?? 0) * defs[k as ResourceId].density;
  return m;
}
