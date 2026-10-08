import { describe, expect, it } from 'vitest';
import type { Orbit, TrajectoryPatch } from '../src/sim/orbit/api';
import { AutoFramer, firstTransition, orbitFrameDistance, pathFrameDistance } from '../src/flight/map/framing';
import { patchDrawnNow } from '../src/render/map/framing';

const orbit = (body: string, e = 0.1): Orbit => ({ body, a: 7e6, e, i: 0, lan: 0, argPe: 0, m0: 0, epoch: 0, mu: 4e14 });
const patch = (body: string, endReason: TrajectoryPatch['endReason'], nextBody?: string, startTime = 0): TrajectoryPatch =>
  ({ orbit: orbit(body), startTime, endTime: startTime + 100, endReason, nextBody });

const PARENT: Record<string, string | undefined> = { moon: 'earth', earth: 'sun', mars: 'sun', sun: undefined };
const parent = (id: string) => PARENT[id];

describe('map framing: first SOI change on the flown path', () => {
  it('finds an encounter or escape on the current path and ignores planned ones', () => {
    expect(firstTransition([patch('earth', 'soiEnter', 'moon'), patch('moon', 'soiExit', 'earth')], 'earth')).toBe(0);
    expect(firstTransition([patch('moon', 'soiExit', 'earth'), patch('earth', 'horizon')], 'moon')).toBe(0);
    // A node first: the encounter belongs to the plan, which keeps the local frame (explicit overview instead).
    expect(firstTransition([patch('earth', 'maneuver'), patch('earth', 'soiEnter', 'moon'), patch('moon', 'horizon')], 'earth')).toBe(-1);
    expect(firstTransition([patch('earth', 'horizon')], 'earth')).toBe(-1);
    // A path from a stale prediction (other body) never frames.
    expect(firstTransition([patch('earth', 'soiEnter', 'moon')], 'moon')).toBe(-1);
  });

  it('widens the local frame to include the transition, never narrows it', () => {
    const local = orbitFrameDistance(6.4e6, 6.6e6, orbit('earth', 0.97));
    expect(pathFrameDistance(6.4e6, 6.6e6, orbit('earth', 0.97), 0)).toBe(local);
    const reach = 4.5e8;
    expect(pathFrameDistance(6.4e6, 6.6e6, orbit('earth', 0.97), reach)).toBeGreaterThan(2 * reach);
    expect(pathFrameDistance(6.4e6, 6e8, undefined, 1e6)).toBe(orbitFrameDistance(6.4e6, 6e8));
  });
});

describe('map framing: automatic reframing', () => {
  const enter = patch('earth', 'soiEnter', 'moon'), exit = patch('moon', 'soiExit', 'earth');

  it('reframes after an SOI change even after a manual zoom', () => {
    const f = new AutoFramer();
    f.framed('earth', enter, 0, 0);
    expect(f.update('earth', enter, 3, 100, false)).toBe(false);
    expect(f.update('moon', exit, 3, 200, false)).toBe(true);
  });

  it('frames a newly appeared encounter once it has settled and the burn has ended', () => {
    const f = new AutoFramer();
    f.framed('earth', undefined, 0, 0);
    expect(f.update('earth', undefined, 0, 50, false)).toBe(false);
    expect(f.update('earth', enter, 0, 100, true)).toBe(false);
    expect(f.update('earth', enter, 0, 900, true)).toBe(false); // still burning
    expect(f.update('earth', enter, 0, 950, false)).toBe(true);
    f.framed('earth', enter, 0, 950);
    expect(f.update('earth', enter, 0, 5000, false)).toBe(false);
  });

  it('does not frame a flickering transition before it settles', () => {
    const f = new AutoFramer();
    f.framed('earth', undefined, 0, 0);
    expect(f.update('earth', enter, 0, 100, false)).toBe(false);
    expect(f.update('earth', patch('earth', 'soiExit', 'sun'), 0, 500, false)).toBe(false);
    expect(f.update('earth', patch('earth', 'soiExit', 'sun'), 0, 1000, false)).toBe(false);
    expect(f.update('earth', patch('earth', 'soiExit', 'sun'), 0, 1300, false)).toBe(true);
  });

  it('reframes on capture (the escape disappears) unless the player zoomed', () => {
    const f = new AutoFramer();
    f.framed('moon', exit, 4, 0);
    expect(f.update('moon', undefined, 4, 100, false)).toBe(false);
    expect(f.update('moon', undefined, 4, 900, false)).toBe(true);
    const zoomed = new AutoFramer();
    zoomed.framed('moon', exit, 4, 0);
    expect(zoomed.update('moon', undefined, 5, 100, false)).toBe(false);
    expect(zoomed.update('moon', undefined, 5, 5000, false)).toBe(false);
  });
});

describe('map trajectory frames', () => {
  it('draws a later return to the body being left where that body will be, not over the current flyby', () => {
    // In the Moon's SOI without a capture: flyby, Earth orbit, Moon again, Earth again.
    const path = [patch('moon', 'soiExit', 'earth'), patch('earth', 'soiEnter', 'moon', 100), patch('moon', 'soiExit', 'earth', 200), patch('earth', 'horizon', undefined, 300)];
    expect(path.map((_, k) => patchDrawnNow(path, k, 'moon', parent))).toEqual([true, true, false, true]);
  });

  it('keeps the focused body\'s first encounter around it now, later ones at their time', () => {
    const path = [patch('earth', 'soiEnter', 'moon'), patch('moon', 'soiExit', 'earth', 100), patch('earth', 'soiEnter', 'moon', 200), patch('moon', 'horizon', undefined, 300)];
    expect(path.map((_, k) => patchDrawnNow(path, k, 'moon', parent))).toEqual([true, true, true, false]);
    // Focused on Earth (following the vessel): the encounter is drawn where the Moon will be.
    expect(path.map((_, k) => patchDrawnNow(path, k, 'earth', parent))).toEqual([true, false, true, false]);
  });

  it('escapes stay in the present frame; a return from solar orbit is drawn at the arrival', () => {
    const path = [patch('earth', 'soiExit', 'sun'), patch('sun', 'soiEnter', 'earth', 100), patch('earth', 'horizon', undefined, 200)];
    expect(path.map((_, k) => patchDrawnNow(path, k, 'earth', parent))).toEqual([true, true, false]);
  });
});
