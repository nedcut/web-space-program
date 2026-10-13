import { BODY_DEFS } from '../../data/bodies';
import type { FlightRecord } from '../../game/flightlog/recorder';
import type { CraftDef } from '../../sim/vessel/types';

/**
 * Post-flight debrief shown on the hub after leaving flight (replaces the old one-line notice and the detour
 * through the Flight Log). Built once at exit from the flight's report; DOM-free so it is unit tested.
 */
export interface FlightDebrief {
  reportId: string | null;
  name: string;
  outcome: 'recovered' | 'lost' | 'docked' | 'boarded' | 'flying';
  /** "Recovered on Earth", "In orbit around the Moon", … */
  status: string;
  /** Short kicker matching the Flight Log arrival banner ("Back from flight · recovered"). */
  kicker: string;
  maxAltitude: number;
  /** Most significant body reached and how ("Moon · landed"); null before liftoff. */
  furthest: string | null;
  duration: number;
  /** Program changes over this flight (null when they do not apply: sandbox funds/reputation, sandbox science). */
  science: number | null;
  funds: number | null;
  reputation: number | null;
  /** Credits refunded on recovery (career), null otherwise. */
  recoveryValue: number | null;
  crew: string[];
  /** Craft to put back on the pad for "Launch again" (null when this flight was resumed, not launched). */
  craft: CraftDef | null;
  /** Any message that was queued for the hub before leaving (e.g. a save error); shown under the summary. */
  note: string | null;
}

export interface ProgramTotals { science: number; funds: number; reputation: number }

const NAMES = new Map(BODY_DEFS.map(b => [b.id, b.name]));
export const bodyName = (id: string) => NAMES.get(id) ?? id;
const HOME = 'earth';

/** Most significant body reached: landed beats orbit beats passing through; other worlds beat home. */
export function furthestReach(r: Pick<FlightRecord, 'bodies' | 'landedBodies' | 'orbitBodies' | 'launched'>): string | null {
  if (!r.launched) return null;
  const rank = (id: string) => (id === HOME ? 0 : 10) + (r.landedBodies.includes(id) ? 3 : r.orbitBodies.includes(id) ? 2 : 1);
  let best: string | null = null;
  for (const id of r.bodies) if (best === null || rank(id) >= rank(best)) best = id;
  if (best === null) return null;
  const how = r.landedBodies.includes(best) && best !== HOME ? 'landed' : r.orbitBodies.includes(best) ? 'orbit' : best === HOME ? 'suborbital' : 'flyby';
  return `${bodyName(best)} · ${how}`;
}

export function debriefStatus(r: Pick<FlightRecord, 'outcome' | 'last' | 'bodies'>): { outcome: FlightDebrief['outcome']; status: string } {
  const body = bodyName(r.last?.body ?? r.bodies.at(-1) ?? HOME);
  switch (r.outcome) {
    case 'recovered': return { outcome: 'recovered', status: `Recovered on ${body}` };
    case 'lost': return { outcome: 'lost', status: 'Vessel lost' };
    case 'merged': return { outcome: 'docked', status: 'Docked with another vessel' };
    case 'boarded': return { outcome: 'boarded', status: 'Crew boarded another vessel' };
  }
  const o = r.last;
  const status = !o ? 'Still in flight'
    : o.prelaunch ? 'Still on the launch pad'
    : o.stableOrbit ? `In orbit around ${body}`
    : !o.flying ? `${o.splashed ? 'Splashed down' : 'Landed'} on ${body}`
    : `In flight over ${body}`;
  return { outcome: 'flying', status };
}

export function buildDebrief(r: FlightRecord, opts: {
  mode: 'sandbox' | 'science' | 'career'; ut: number; before: ProgramTotals | null; after: ProgramTotals;
  recoveryValue?: number | null; crew: string[]; craft: CraftDef | null; note?: string | null;
}): FlightDebrief {
  const { outcome, status } = debriefStatus(r);
  const delta = (k: keyof ProgramTotals) => (opts.before ? opts.after[k] - opts.before[k] : null);
  const career = opts.mode === 'career';
  return {
    reportId: r.id, name: r.name, outcome, status,
    kicker: `Back from flight · ${outcome === 'flying' ? 'in progress' : outcome}`,
    maxAltitude: r.stats.maxAltitude,
    furthest: furthestReach(r),
    duration: Math.max(0, (r.end ?? opts.ut) - r.start),
    science: opts.mode === 'sandbox' ? null : delta('science'),
    funds: career ? delta('funds') : null,
    reputation: career ? delta('reputation') : null,
    recoveryValue: career && opts.recoveryValue ? opts.recoveryValue : null,
    crew: opts.crew,
    craft: opts.craft,
    note: opts.note ?? null,
  };
}

/** One debrief waits for the hub; the hub reads it when it mounts and clears it once shown. */
let pending: FlightDebrief | null = null;
export function setPendingDebrief(d: FlightDebrief | null) { pending = d; }
export const pendingDebrief = () => pending;
