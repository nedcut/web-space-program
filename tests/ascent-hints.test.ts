import { describe, expect, it } from 'vitest';
import { HintTracker, hintFor, turnWindow, type HintId, type HintInput } from '../src/flight/hints';

const G = 9.81;
/** One second of a vertical climb at a constant TWR, then the same craft tipped over: enough to time the hints. */
function climb(twr: number, seconds: number, tilt = 0, extra: Partial<HintInput> = {}): HintInput {
  const a = (twr - 1) * G;
  return {
    enabled: true, flying: true, altitude: 0.5 * a * seconds * seconds, surfaceSpeed: a * seconds, verticalSpeed: a * seconds,
    apoapsis: 0.5 * a * seconds * seconds + (a * seconds) ** 2 / (2 * G), periapsis: -600000, timeToAp: 30,
    atmosphereHeight: 70000, throttle: 1, hasThrust: true, twr, tilt, ...extra,
  };
}

/** Seconds during which a pure vertical climb is offered the turn hint, and the altitude/speed it opens at. */
function turnOffer(twr: number) {
  const tracker = new HintTracker(new Set(), () => {});
  let first: { t: number; alt: number; v: number } | null = null;
  let shown = 0;
  for (let t = 0; t <= 80; t += 0.25) {
    const i = climb(twr, t);
    if (tracker.update(i)?.id === 'turn') { shown += 0.25; first ??= { t, alt: i.altitude, v: i.surfaceSpeed }; }
  }
  return { first, shown };
}

describe('gravity-turn timing', () => {
  it('opens at 50 m/s, low and early, for typical and extreme TWR', () => {
    for (const twr of [1.3, 1.5, 1.8, 2.5, 3.5]) {
      const { first, shown } = turnOffer(twr);
      expect(first, `TWR ${twr}`).not.toBeNull();
      expect(first!.v).toBeGreaterThanOrEqual(50);
      expect(first!.v).toBeLessThan(55 + 0.25 * (twr - 1) * G * 4);
      expect(first!.alt).toBeLessThan(700);
      expect(shown, `TWR ${twr} stays up long enough to read`).toBeGreaterThanOrEqual(5);
      expect(shown, `TWR ${twr} does not linger`).toBeLessThanOrEqual(25);
    }
  });
  it('scales the window with TWR but never past 200 m/s', () => {
    expect(turnWindow(1.3)).toEqual({ from: 50, to: 100 });
    expect(turnWindow(1.8).to).toBe(100);
    expect(turnWindow(2.5).to).toBeGreaterThan(120);
    expect(turnWindow(6).to).toBe(200);
    expect(turnWindow(undefined).to).toBe(100);
  });
  it('is never late: 252 m/s at 4.7 km gets no turn hint', () => {
    const late = climb(1.6, 40, 0, { altitude: 4700, surfaceSpeed: 252 });
    expect(hintFor(late, new Set())).toBeNull();
    expect(hintFor({ ...late, altitude: 2500, surfaceSpeed: 120 }, new Set())).toBeNull();
  });
  it('clears once the pitch-over is under way and does not come back', () => {
    const saved: HintId[][] = [];
    const t = new HintTracker(new Set(), (s) => saved.push([...s]));
    expect(t.update(climb(1.5, 12))?.id).toBe('turn');
    const tipped = climb(1.5, 13, 8);
    expect(t.update(tipped)?.id).not.toBe('turn');
    expect(saved.at(-1)).toContain('turn');
    // Back near vertical at a speed inside the old window: still quiet.
    expect(t.update(climb(1.5, 12))?.id).not.toBe('turn');
    expect(t.seen.has('turn')).toBe(true);
  });
  it('retires an unseen turn hint when the pilot tipped over before 50 m/s', () => {
    const t = new HintTracker(new Set(), () => {});
    t.update(climb(1.5, 6, 10));
    expect(t.seen.has('turn')).toBe(true);
    expect(t.update(climb(1.5, 12))).toBeNull();
  });
  it('shows at most one ascent hint at a time and respects the off switch', () => {
    const off = climb(1.5, 12, 0, { enabled: false });
    expect(hintFor(off, new Set())).toBeNull();
    expect(new HintTracker(new Set(), () => {}).update(off)).toBeNull();
    // Turn conditions and max-Q both true: exactly one hint, and it is the urgent one.
    expect(hintFor(climb(1.5, 12, 0, { stress: 0.6 }), new Set())?.id).toBe('maxq');
  });
});

describe('follow-up ascent cues', () => {
  const turned = (extra: Partial<HintInput> = {}) => climb(1.5, 20, 25, { surfaceSpeed: 180, ...extra });
  it('suggests Prograde once, only while the turn is going and SAS is not already on it', () => {
    expect(hintFor(turned(), new Set())?.id).toBe('hold');
    expect(hintFor(turned({ sasMode: 'prograde' }), new Set())).toBeNull();
    expect(hintFor(turned({ sasMode: 'stabilityAssist' }), new Set())?.id).toBe('hold');
    expect(hintFor(turned({ throttle: 0 }), new Set())).toBeNull();
    const t = new HintTracker(new Set(), () => {});
    expect(t.update(turned())?.id).toBe('hold');
    expect(t.update(turned({ sasMode: 'prograde' }))).toBeNull();
    expect(t.update(turned())).toBeNull();
  });
  it('mentions throttling back only when crossflow actually loads the airframe', () => {
    expect(hintFor(turned({ stress: 0 }), new Set())?.id).not.toBe('maxq');
    expect(hintFor(turned({ stress: 0.7 }), new Set())?.id).toBe('maxq');
    expect(hintFor(turned({ stress: 0.7, throttle: 0.5 }), new Set())?.id).not.toBe('maxq');
  });
  it('tells the pilot to cut the engines when the apoapsis clears the atmosphere', () => {
    const coast = hintFor(turned({ altitude: 40000, surfaceSpeed: 1500, apoapsis: 80000 }), new Set());
    expect(coast?.id).toBe('coast');
    expect(coast?.text).toMatch(/Cut the engines/);
  });
  it('stays out of the way on the Moon and on descents', () => {
    expect(hintFor(turned({ bodyId: 'moon', atmosphereHeight: 0 }), new Set())).toBeNull();
    expect(hintFor(turned({ verticalSpeed: -30 }), new Set())).toBeNull();
  });
});
