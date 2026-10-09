import { describe, expect, it } from 'vitest';
import { AlertTracker, alertConditions, type AlertInput } from '../src/flight/alerts';
import { HintTracker, hintFor, type HintId, type HintInput } from '../src/flight/hints';
import { situationBanner } from '../src/flight/situation';
import { orbitMarkerFrame } from '../src/flight/controller/navball';
import { sasTargetDirection } from '../src/sim/vessel/sas';
import { dot } from '../src/util/vec3';
import { WarpDriver, warpTargets } from '../src/flight/controller/warp';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { spawnRelative } from '../src/scenarios/catalog';
import { neutralInput } from '../src/sim/vessel';
import { v3 } from '../src/util/vec3';

const calm: AlertInput = {
  noControl: false, eva: false, flying: true, heatFraction: 0.3, gForce: 1.2, agl: 20000, verticalSpeed: 50, horizontalSpeed: 400,
  chutes: false, gear: null, thrusting: true, stageBurnTime: 60, flameout: false, power: 0.8,
};

describe('flight cautions', () => {
  it('is quiet in normal flight', () => {
    expect(alertConditions(calm)).toEqual([]);
  });

  it('flags the important dangers with the right severity', () => {
    const ids = (i: Partial<AlertInput>) => alertConditions({ ...calm, ...i }).map((a) => `${a.id}:${a.level}`);
    expect(ids({ heatFraction: 0.8 })).toEqual(['heat:warn']);
    expect(ids({ heatFraction: 0.95 })).toEqual(['heat:bad']);
    expect(ids({ gForce: 7 })).toEqual(['g:warn']);
    expect(ids({ gForce: 11 })).toEqual(['g:bad']);
    expect(ids({ agl: 400, verticalSpeed: -100 })).toEqual(['terrain:bad']);
    expect(ids({ agl: 1500, verticalSpeed: -150 })).toEqual(['terrain:warn']);
    expect(ids({ stageBurnTime: 6 })).toEqual(['fuel:warn']);
    expect(ids({ flameout: true })).toEqual(['fuel:bad']);
    expect(ids({ noControl: true })).toEqual(['control:bad']);
    expect(ids({ power: 0 })).toEqual(['power:bad']);
    expect(ids({ gear: 'up', agl: 150, verticalSpeed: -5, horizontalSpeed: 2 })).toEqual(['gear:warn']);
  });

  it('does not nag under parachutes, on the ground or in EVA', () => {
    expect(alertConditions({ ...calm, agl: 100, verticalSpeed: -7, chutes: true, gear: 'down' })).toEqual([]);
    expect(alertConditions({ ...calm, flying: false, agl: 0, verticalSpeed: -20 })).toEqual([]);
    expect(alertConditions({ ...calm, eva: true, noControl: true, power: 0 })).toEqual([]);
  });

  it('holds alerts briefly so threshold chatter does not flicker, and orders warnings first', () => {
    const t = new AlertTracker();
    expect(t.update({ ...calm, gForce: 6.1, heatFraction: 0.95 }, 0).map((a) => a.id)).toEqual(['heat', 'g']);
    expect(t.update({ ...calm, gForce: 5.9 }, 0.5).map((a) => a.id)).toEqual(['heat', 'g']);
    expect(t.update(calm, 2)).toEqual([]);
  });
});

function orbiting() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const b = world.universe.body('earth');
  const r = b.radius + 150000;
  // Slightly elliptical so apoapsis/periapsis are distinct targets.
  const wv = spawnRelative(world, buildOrbiter(), 'earth', v3(r, 0, 0), v3(Math.sqrt(b.gm / r) * 0.04, Math.sqrt(b.gm / r) * 1.03, 0));
  return { world, wv };
}

describe('time warp feel', () => {
  it('ramps up the rails rate instead of jumping, and slows down instantly', () => {
    const { world } = orbiting();
    const drv = new WarpDriver();
    world.warp = { mode: 'rails', index: 5 }; // 1000×
    const dt = 1 / 60;
    const rates: number[] = [];
    for (let i = 0; i < 90; i++) {
      const before = world.ut;
      world.tick(drv.rampDt(world, dt), neutralInput());
      rates.push((world.ut - before) / dt);
    }
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1] * 0.999);
    const t90 = rates.findIndex((r) => r > 900) * dt;
    console.log(`1× → 1000× ramp: 10% at ${(rates.findIndex((r) => r > 100) * dt).toFixed(2)} s, 90% at ${t90.toFixed(2)} s`);
    expect(rates[0]).toBeLessThan(150);
    expect(t90).toBeLessThan(1.2);
    world.warp = { mode: 'rails', index: 2 };
    const before = world.ut;
    world.tick(drv.rampDt(world, dt), neutralInput());
    expect((world.ut - before) / dt).toBeCloseTo(10, 3);
  }, 60000);

  it('offers the atmosphere entry instead of a periapsis inside the atmosphere, and stops above it', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const b = world.universe.body('earth'), atmo = b.atmosphere!.height;
    const r = b.radius + 2_000_000;
    // Falling from 2000 km with a 35 km periapsis, like a lunar return.
    const rp = b.radius + 35000, vt = Math.sqrt(2 * b.gm * rp / (r * (r + rp)));
    spawnRelative(world, buildOrbiter(), 'earth', v3(r, 0, 0), v3(0, vt, 0));
    const ids = warpTargets(world).map((o) => o.id);
    expect(ids).toContain('atmo');
    expect(ids).not.toContain('pe');
    const drv = new WarpDriver();
    expect(drv.start(world, 'atmo')).toBeNull();
    let frames = 0;
    while (drv.target && frames < 20000) { drv.drive(world, 1 / 60); world.tick(drv.rampDt(world, 1 / 60), neutralInput()); frames++; }
    const alt = world.warpContext().altitude;
    expect(drv.target).toBeNull();
    expect(world.warp.index).toBe(0);
    expect(alt).toBeGreaterThan(atmo);
    expect(alt).toBeLessThan(atmo + 60000);
  }, 60000);

  it('warps to apoapsis and stops just before it', () => {
    const { world, wv } = orbiting();
    const opts = warpTargets(world);
    expect(opts.map((o) => o.id)).toEqual(expect.arrayContaining(['ap', 'pe']));
    const drv = new WarpDriver();
    expect(drv.start(world, 'ap')).toBeNull();
    const target = drv.target!.time;
    let frames = 0;
    let maxRate = 0;
    while (drv.target && frames < 20000) {
      drv.drive(world, 1 / 60);
      const before = world.ut;
      world.tick(drv.rampDt(world, 1 / 60), neutralInput());
      maxRate = Math.max(maxRate, (world.ut - before) * 60);
      frames++;
    }
    const o = world.orbitSummary(wv);
    console.log(`warp-to apoapsis: ${frames} frames (${(frames / 60).toFixed(1)} s real), peak ${maxRate.toFixed(0)}×, stopped ${(target - world.ut).toFixed(2)} s before the lead point, T-Ap ${o.timeToAp.toFixed(1)} s`);
    expect(drv.target).toBeNull();
    expect(world.warp.index).toBe(0);
    expect(world.ut).toBeLessThanOrEqual(target + 1e-6);
    expect(target - world.ut).toBeLessThan(1);
    expect(o.timeToAp).toBeGreaterThan(10);
    expect(o.timeToAp).toBeLessThan(20);
    expect(frames / 60).toBeLessThan(20);
  }, 60000);
});

describe('first-orbit hints', () => {
  const base: HintInput = { enabled: true, flying: true, altitude: 2000, surfaceSpeed: 75, apoapsis: 3000, periapsis: -600000, timeToAp: 30, atmosphereHeight: 70000, throttle: 1, hasThrust: true };
  const id = (i: Partial<HintInput>, seen: HintId[] = []) => hintFor({ ...base, ...i }, new Set(seen))?.id ?? null;
  it('walks through turn → coast → circularise → orbit', () => {
    expect(id({})).toBe('turn');
    expect(id({ altitude: 40000, surfaceSpeed: 1500, apoapsis: 80000 })).toBe('coast');
    expect(id({ altitude: 70000, surfaceSpeed: 2000, apoapsis: 80000, throttle: 0, timeToAp: 40 })).toBe('circularize');
    expect(id({ altitude: 80000, apoapsis: 82000, periapsis: 75000, throttle: 0 })).toBe('orbit');
    expect(id({ enabled: false })).toBeNull();
    expect(id({ flying: false })).toBeNull();
    expect(id({}, ['turn'])).toBeNull();
  });
  it('remembers a hint once its moment has passed or it is dismissed', () => {
    const saved: string[][] = [];
    const t = new HintTracker(new Set(), (s) => saved.push([...s]));
    expect(t.update(base)?.id).toBe('turn');
    expect(t.update({ ...base, surfaceSpeed: 600, altitude: 20000 })).toBeNull();
    expect(saved.at(-1)).toEqual(['turn']);
    expect(t.update(base)).toBeNull();
    expect(t.update({ ...base, altitude: 40000, surfaceSpeed: 1500, apoapsis: 80000 })?.id).toBe('coast');
    t.dismiss();
    expect(saved.at(-1)).toEqual(['turn', 'coast']);
  });
  it('mentions the live key bindings', () => {
    expect(hintFor(base, new Set())!.text).toContain('D');
  });
});

describe('arrival banner', () => {
  it('describes pad and orbit situations', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter());
    expect(situationBanner(world)?.sub).toMatch(/On the pad/);
    const o = orbiting();
    expect(situationBanner(o.world)?.sub).toMatch(/^Orbiting Earth/);
  });
});

describe('navball markers', () => {
  it('draws radial-out away from the body, where SAS RAD+ points', () => {
    const { world, wv } = orbiting();
    const rs = world.relativeState(wv);
    const f = orbitMarkerFrame(rs.position, rs.velocity)!;
    expect(dot(f.radialOut, rs.position)).toBeGreaterThan(0);
    const env = world.universe.createEnvironment(() => wv.body);
    const sas = sasTargetDirection(wv.state, 'radialOut', neutralInput({ sasReference: 'orbit' }), env, world.ut)!;
    expect(dot(sas, f.radialOut)).toBeGreaterThan(0.999999);
    const n = sasTargetDirection(wv.state, 'normal', neutralInput({ sasReference: 'orbit' }), env, world.ut)!;
    expect(dot(n, f.normal)).toBeGreaterThan(0.999999);
  });
});
