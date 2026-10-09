import { bindingText } from '../input/bindings';

/**
 * First-orbit coaching: short contextual hints for the classic "get to orbit" loop (gravity turn → coast →
 * circularise → orbit). Each hint appears while its moment is relevant and is remembered once that moment
 * passes (or the pilot dismisses it), so experienced players stop seeing it. Pure logic + tiny storage
 * helpers; the HUD renders the result.
 */
export type HintId = 'turn' | 'hold' | 'maxq' | 'coast' | 'circularize' | 'orbit' | 'map' | 'node' | 'soi' | 'landing' | 'eva';

export interface HintInput {
  /** Context coaching is offered in free single-player flight. */
  enabled: boolean;
  bodyId?: string;
  bodyName?: string;
  /** Highest possible terrain, and whether the osculating orbit is bound. */
  terrainHeight?: number;
  boundOrbit?: boolean;
  verticalSpeed?: number;
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
  /** Thrust-to-weight of the burning stage; sizes the turn window. Unknown → a typical 1.5. */
  twr?: number;
  /** Nose angle from local vertical (°); 0 on the pad, rises as the pitch-over starts. */
  tilt?: number;
  sasMode?: string;
  /** Normalized crossflow exposure (> 0 in the airframe's warn band). */
  stress?: number;
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
  turn: 'Gravity turn: gently tip about 5–10° east (heading 90°) with {yawRight}. Watch the attitude settle before adding more input.',
  hold: 'Turn under way: choose Prograde on the navball so the nose follows your flight path, and keep the throttle up.',
  maxq: 'Max-Q: side load on the airframe. Ease the throttle ({throttleDown}) and steer back toward Prograde until the air thins.',
  coast: 'Apoapsis is above the atmosphere. Cut the engines ({throttleCut}) once it reaches the height you want and coast — the ⇥ button next to time warp (top-left) can take you straight to apoapsis.',
  circularize: 'Approaching apoapsis: hold Prograde in SAS and burn ({throttleFull}) until the periapsis climbs above the atmosphere.',
  orbit: 'Orbit around {body}. Open the map ({map}) to plan your next maneuver.',
};

/** Pitch-over counts as started once the nose is this far (°) off vertical. */
const TURN_STARTED_TILT = 6;
/** Speed (m/s) where a vertical climb should begin to tip over. */
const TURN_START_SPEED = 50;
/** Past this height (m) the turn is overdue; the hint is retired instead of nagging. */
const TURN_LATEST_ALTITUDE = 3000;

/**
 * Surface speeds (m/s) between which the gravity-turn nudge is offered. It opens at {@link TURN_START_SPEED} and stays
 * about six seconds of net climb acceleration, so a hot TWR 2.5 rocket still gets time to read it and a sluggish one
 * is not told about the turn long after it was due.
 */
export function turnWindow(twr = 1.5): { from: number; to: number } {
  const net = Math.max(0, twr - 1) * 9.81;
  return { from: TURN_START_SPEED, to: TURN_START_SPEED + Math.min(150, Math.max(50, 6 * net)) };
}

/** Earth-style ascent through thick air: what the ascent coaching applies to. */
function ascending(i: HintInput): boolean {
  return i.flying && (i.bodyId ?? 'earth') === 'earth' && i.atmosphereHeight > 0 && (i.verticalSpeed ?? 1) > 0;
}

/** Ascent hints whose moment is over, whether or not they were ever shown: they must not come back later. */
function passedHints(i: HintInput): HintId[] {
  if (!ascending(i)) return [];
  const out: HintId[] = [];
  if ((i.tilt ?? 0) >= TURN_STARTED_TILT || i.surfaceSpeed > turnWindow(i.twr).to || i.altitude > TURN_LATEST_ALTITUDE || i.apoapsis >= i.atmosphereHeight) out.push('turn');
  if (i.sasMode === 'prograde' || i.surfaceSpeed > 800 || i.altitude > i.atmosphereHeight * 0.6 || i.apoapsis >= i.atmosphereHeight) out.push('hold');
  return out;
}

/** The single most relevant hint for this moment, or null. */
export function hintFor(i: HintInput, seen: ReadonlySet<HintId>): Hint | null {
  if (!i.enabled) return null;
  const atmo = i.atmosphereHeight;
  const pick = (id: HintId): Hint | null => (seen.has(id) ? null : { id, text: bindingText(TEXT[id].replace('{body}', i.bodyName ?? 'Earth')) });
  for (const id of ['eva', 'soi', 'node', 'map', 'landing'] as const) if (i[id] && !seen.has(id)) return pick(id);
  if (!i.flying) return null;
  if (i.boundOrbit !== false && i.periapsis > Math.max(atmo, i.terrainHeight ?? 0)) return pick('orbit');
  // Earth ascent coaching is never offered for a lunar orbit, descent or airless launch.
  if ((i.bodyId ?? 'earth') !== 'earth' || atmo <= 0 || (i.verticalSpeed ?? 1) <= 0) return null;
  const tilt = i.tilt ?? 0;
  const burning = i.throttle > 0 && i.hasThrust;
  if (i.altitude < atmo && burning && (i.stress ?? 0) > 0 && i.throttle > 0.9) return pick('maxq');
  const win = turnWindow(i.twr);
  if (i.apoapsis < atmo && i.altitude < Math.min(atmo * 0.25, TURN_LATEST_ALTITUDE) && tilt < TURN_STARTED_TILT && i.surfaceSpeed >= win.from && i.surfaceSpeed <= win.to && burning) return pick('turn');
  if (i.apoapsis < atmo && tilt >= TURN_STARTED_TILT && i.surfaceSpeed >= win.from && i.surfaceSpeed <= 800 && i.altitude < atmo * 0.6 && i.sasMode !== 'prograde' && burning) return pick('hold');
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
    for (const id of passedHints(i)) this.markSeen(id);
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
