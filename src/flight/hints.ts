import { bindingText } from '../input/bindings';

/**
 * First-orbit coaching: short contextual hints for the classic "get to orbit" loop (gravity turn → coast →
 * circularise → orbit). Each hint appears while its moment is relevant and is remembered once that moment
 * passes (or the pilot dismisses it), so experienced players stop seeing it. Pure logic + tiny storage
 * helpers; the HUD renders the result.
 */
export type HintId = 'turn' | 'coast' | 'circularize' | 'orbit' | 'map' | 'node' | 'soi' | 'landing' | 'eva';

export interface HintInput {
  /** Hints only make sense for a free single-player flight from the home planet. */
  enabled: boolean;
  map?: boolean;
  node?: boolean;
  soi?: boolean;
  landing?: boolean;
  eva?: boolean;
  flying: boolean;
  altitude: number;
  surfaceSpeed: number;
  apoapsis: number;
  periapsis: number;
  timeToAp: number;
  atmosphereHeight: number;
  throttle: number;
  /** Engines able to thrust (anything to burn with). */
  hasThrust: boolean;
}

export interface Hint {
  id: HintId;
  text: string;
}

const TEXT: Record<HintId, string> = {
  map: 'Plan a burn: click your orbit line to add a maneuver node. Return to flight with {map}.',
  node: 'Drag the colored node handles to change the burn direction and strength. Drag the node along the orbit to change its time.',
  soi: 'New sphere of influence: your orbit is now measured around this body. Check periapsis in the map before accelerating time.',
  landing: 'Powered landing: point Retrograde and slow down before the ground arrives. Start your braking burn early; the Flight assist landing program can help.',
  eva: 'Outside the cabin: use {pitchUp}/{pitchDown} to move, {toggleRcs} for the jetpack. Approach the hatch slowly and press {board} to board.',
  turn: 'Gravity turn: tap {yawRight} to tip the nose about 10° east (heading 90°), then pick the Prograde SAS mode (left of the navball) so SAS follows the prograde marker as the rocket arcs over.',
  coast: 'Apoapsis is above the atmosphere. Cut the throttle ({throttleCut}) and coast up — the ⇥ button next to time warp (top-left) can take you straight to apoapsis.',
  circularize: 'Approaching apoapsis: hold Prograde in SAS and burn ({throttleFull}) until the periapsis climbs above the atmosphere.',
  orbit: 'You are in orbit! Open the map ({map}) to plan your next maneuver — the Moon is a short hop away.',
};

/** The single most relevant hint for this moment, or null. */
export function hintFor(i: HintInput, seen: ReadonlySet<HintId>): Hint | null {
  if (!i.enabled) return null;
  const atmo = i.atmosphereHeight;
  const pick = (id: HintId): Hint | null => (seen.has(id) ? null : { id, text: bindingText(TEXT[id]) });
  for (const id of ['eva', 'soi', 'node', 'map', 'landing'] as const) if (i[id] && !seen.has(id)) return pick(id);
  if (!i.flying) return null;
  if (i.periapsis > atmo) return pick('orbit');
  if (i.apoapsis < atmo && i.altitude < atmo * 0.25 && i.surfaceSpeed > 50 && i.surfaceSpeed < 300) return pick('turn');
  if (i.apoapsis > atmo + 5000 && i.throttle > 0 && i.altitude < atmo) return pick('coast');
  if (i.apoapsis > atmo && i.altitude > atmo * 0.9 && i.timeToAp < 90 && i.hasThrust) return pick('circularize');
  return null;
}

const KEY = 'wsp.hints.v1';

export function loadSeenHints(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Set<HintId> {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? (raw.filter((x) => typeof x === 'string') as HintId[]) : []);
  } catch {
    return new Set();
  }
}

export function saveSeenHints(seen: ReadonlySet<HintId>, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* storage unavailable */
  }
}

/** Tracks which hint is showing and marks it seen when its moment passes or it is dismissed. */
export class HintTracker {
  private current: HintId | null = null;
  constructor(readonly seen: Set<HintId> = loadSeenHints(), private persist: (s: ReadonlySet<HintId>) => void = saveSeenHints) {}

  update(i: HintInput): Hint | null {
    const h = hintFor(i, this.seen);
    if (this.current && h?.id !== this.current) this.markSeen(this.current);
    this.current = h?.id ?? null;
    return h;
  }

  dismiss() {
    if (this.current) this.markSeen(this.current);
    this.current = null;
  }

  private markSeen(id: HintId) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.persist(this.seen);
  }
}
