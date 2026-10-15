import { describe, expect, it } from 'vitest';
import type { Orbit, TrajectoryPatch } from '../src/sim/orbit/api';
import { AutoFramer, NO_TRANSITION, UNDECIDED, ascentAngles, ascentFrame, ascentMinDistance, ascentPhase, firstTransition, orbitFrameDistance, pathFrameDistance } from '../src/flight/map/framing';
import { clearDistance, patchDrawnNow } from '../src/render/map/framing';

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
    expect(firstTransition([patch('earth', 'maneuver'), patch('earth', 'soiEnter', 'moon'), patch('moon', 'horizon')], 'earth')).toBe(UNDECIDED);
    expect(firstTransition([patch('earth', 'horizon')], 'earth')).toBe(NO_TRANSITION);
    // A path from a stale prediction (other body) never frames.
    expect(firstTransition([patch('earth', 'soiEnter', 'moon')], 'moon')).toBe(NO_TRANSITION);
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

  it('holds while a node decides the path, then frames its outcome (capture planned and flown in the SOI)', () => {
    const f = new AutoFramer();
    f.framed('moon', exit, 0, 0);
    expect(f.update('moon', null, 0, 1000, false)).toBe(false);
    expect(f.update('moon', null, 0, 9000, true)).toBe(false);
    expect(f.update('moon', undefined, 0, 9500, false)).toBe(false);
    expect(f.update('moon', undefined, 0, 10300, false)).toBe(true);
    // Opened with the TLI node still ahead: the encounter after the burn is framed.
    const tli = new AutoFramer();
    tli.framed('earth', null, 0, 0);
    expect(tli.update('earth', null, 0, 5000, false)).toBe(false);
    expect(tli.update('earth', enter, 0, 6000, false)).toBe(false);
    expect(tli.update('earth', enter, 0, 6800, false)).toBe(true);
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

describe('map framing: ascent view', () => {
  const mu = 3.986e14, R = 6.371e6, clear = R + 7e4;
  const v3 = (x: number, y: number, z: number) => ({ x, y, z });

  it('holds from the pad until the periapsis clears the atmosphere', () => {
    const pad = v3(R, 0, 0), spin = v3(0, 465, 0);
    expect(ascentPhase(false, true, pad, spin, mu, clear)).toBe(true);
    // Climbing suborbital: stays in the ascent view, including a coast past apoapsis.
    expect(ascentPhase(true, false, v3(R + 4e4, 0, 0), v3(800, 2000, 0), mu, clear)).toBe(true);
    expect(ascentPhase(true, false, v3(R + 9e4, 0, 0), v3(-50, 6000, 0), mu, clear)).toBe(true);
    // Circular orbit above the atmosphere: back to the orbit view.
    const rOrbit = R + 2e5;
    expect(ascentPhase(true, false, v3(rOrbit, 0, 0), v3(0, Math.sqrt(mu / rOrbit), 0), mu, clear)).toBe(false);
    // Straight up (radial, eccentricity 1) is still a suborbital climb; escape always leaves it.
    expect(ascentPhase(true, false, v3(R + 4e4, 0, 0), v3(3000, 0, 0), mu, clear)).toBe(true);
    expect(ascentPhase(true, false, v3(R + 4e4, 0, 0), v3(0, 12000, 0), mu, clear)).toBe(false);
  });

  it('does not start on a descent from orbit', () => {
    expect(ascentPhase(false, false, v3(R + 6e4, 0, 0), v3(-300, 7600, 0), mu, clear)).toBe(false);
    expect(ascentPhase(false, false, v3(R + 6e4, 0, 0), v3(300, 3000, 0), mu, clear)).toBe(true);
  });

  it('centres between the vessel and its apoapsis', () => {
    const pad = ascentFrame(v3(R, 0, 0), v3(0, 465, 0), mu, R);
    expect(pad.centre.x).toBeCloseTo(R, -2);
    expect(pad.distance).toBeCloseTo(0.8 * R, -3);
    // Straight up at 2 km/s: apoapsis directly overhead, the centre half way to it.
    const up = ascentFrame(v3(R + 1e4, 0, 0), v3(2000, 0, 0), mu, R);
    const ra = up.centre.x * 2 - (R + 1e4);
    expect(ra - R).toBeGreaterThan(2e5);
    expect(Math.abs(up.centre.y)).toBeLessThan(1);
    expect(up.distance).toBeCloseTo(0.8 * R, -3);
    // A high apoapsis widens the frame to keep both in view.
    const high = ascentFrame(v3(R + 1e4, 0, 0), v3(9000, 0, 0), mu, R);
    expect(high.distance).toBeCloseTo(1.5 * (high.centre.x * 2 - 2 * (R + 1e4)), -3);
    expect(high.distance).toBeGreaterThan(0.8 * R);
  });

  it('looks from beside the ascent plane, above the horizon, from the south so north is up', () => {
    const north = v3(0, 0, 1);
    const { yaw, pitch } = ascentAngles(v3(R, 0, 0), v3(0, 465, 0), north);
    const d = v3(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    expect(d.z).toBeLessThan(-0.75); // along the orbit normal, on the side away from the north pole
    expect(d.x).toBeGreaterThan(0.5); // tilted towards local up, so the camera is outside the body at any distance
    // A westward ascent: the orbit normal points south, the camera still sits on the south side.
    const west = ascentAngles(v3(R, 0, 0), v3(0, -465, 0), north);
    expect(Math.sin(west.pitch)).toBeLessThan(-0.75);
  });

  it('keeps the camera outside the body when the apoapsis is far round it', () => {
    // At periapsis 40 km up, just over circular speed: the apoapsis is on the far side, still in the ascent phase.
    const r = v3(R + 4e4, 0, 0), v = v3(0, Math.sqrt(mu / (R + 4e4)) * 1.005, 0);
    expect(ascentPhase(true, false, r, v, mu, clear)).toBe(true);
    const { centre } = ascentFrame(r, v, mu, R);
    // On the surface, on the vessel's side of the body.
    expect(Math.hypot(centre.x, centre.y, centre.z)).toBeCloseTo(R, -1);
    expect(centre.x).toBeGreaterThan(0.9 * R);
    const camera = (yaw: number, pitch: number) => {
      const d = ascentMinDistance(centre, yaw, pitch, R), cp = Math.cos(pitch);
      return Math.hypot(centre.x + d * Math.cos(yaw) * cp, centre.y + d * Math.sin(yaw) * cp, centre.z + d * Math.sin(pitch));
    };
    for (const yaw of [0, 1, 2, 3, 4, 5, 6]) for (const pitch of [-1.5, -0.7, 0, 0.7, 1.5]) expect(camera(yaw, pitch)).toBeGreaterThanOrEqual(R);
    // From above the centre's horizon the player can still zoom in close.
    const { yaw, pitch } = ascentAngles(r, v, v3(0, 0, 1));
    expect(ascentMinDistance(centre, yaw, pitch, R)).toBeCloseTo(0.15 * R, -3);
  });
});

describe('map framing: camera clearance', () => {
  const body = { x: -10, y: 0, z: 0 };
  it('keeps a camera outside the body where it is', () => {
    expect(clearDistance(5, 1, 0, 0, body, 9)).toBe(5);
    expect(clearDistance(0.5, 0, 0, 1, body, 9)).toBe(0.5);
  });
  it('moves a camera inside the body out to its far side', () => {
    // Looking along -x from 1 unit outside a radius-9 sphere centred 10 units away: exits at 19.
    expect(clearDistance(3, -1, 0, 0, body, 9)).toBeCloseTo(19, 9);
  });
});
