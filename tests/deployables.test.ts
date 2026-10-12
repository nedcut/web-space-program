import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { DEFAULT_START_UT } from '../src/game/store';
import { worldNetwork } from '../src/game/comms';
import { alertConditions, type AlertInput } from '../src/flight/alerts';
import { buildVessel } from '../src/sim/vessel/assembly';
import { stepVessel } from '../src/sim/vessel/integrator';
import { neutralInput } from '../src/sim/vessel';
import { flatEarthEnv, vacuumEnv } from '../src/sim/vessel/testing';
import { isExtended, tweakDescriptors, validTweaks } from '../src/sim/vessel/tweaks';
import { AUTO_STOW_Q, MOVING_LOAD_FACTOR, PANEL_LOAD_WARN, panelMaxQ, stepDeployables } from '../src/sim/vessel/deployables';
import type { CraftDef, PartTweaks } from '../src/sim/vessel/types';
import type { VesselEvent, VesselState } from '../src/sim/vessel/runtime';
import { qIdentity } from '../src/util/quat';
import { length, v3 } from '../src/util/vec3';
import { flyToOrbit } from './helpers/ascent';
import { preflightChecks } from '../src/editor/checks';

const def = (id: string) => PART_CATALOG.get(id)!;
/** Probe core with one radial array (uid 2). */
const craft = (tweaks?: PartTweaks, panel = 'solar-fold'): CraftDef => ({ name: 'Array test', type: 'VAB', version: 1, parts: [
  { uid: 1, partId: 'probe-cairn', position: v3(), rotation: qIdentity() },
  { uid: 2, partId: panel, position: v3(0.5, 0, 0), rotation: qIdentity(), parent: 1, attachNode: 'srf', ...(tweaks ? { tweaks } : {}) },
] });
const OUT: PartTweaks = { extended: true, autoDeploy: false };
/** Uniform air of the given dynamic pressure (the vessel moves at 100 m/s through it, no gravity, no ground). */
function inAirflow(v: VesselState, q: number) {
  v.velocity = v3(0, 100, 0);
  return flatEarthEnv({ g: 0, scaleHeight: Infinity, rho0: 2 * q / 100 ** 2, p0: 101325, surface: 'none' });
}
const panelOf = (v: VesselState) => v.parts.find(p => p.uid === 2);

describe('retractable arrays and antennas', () => {
  it('launch stowed by default, with extend-above-atmosphere on', () => {
    const v = buildVessel(buildOrbiter(), PART_CATALOG);
    const arrays = v.parts.filter(p => p.def.modules.some(m => m.type === 'solarPanel' && m.tracking));
    expect(arrays.length).toBeGreaterThan(0);
    for (const p of arrays) {
      expect(isExtended(p)).toBe(false);
      expect(p.panelDeploy).toBe(0);
    }
    for (const id of ['solar-fold', 'solar-wing', 'solar-grand-1', 'antenna-thread', 'antenna-horizon']) {
      const d = tweakDescriptors(def(id));
      expect(d.find(x => x.key === 'extended')).toMatchObject({ fallback: false, flight: false });
      expect(d.find(x => x.key === 'autoDeploy')).toMatchObject({ fallback: true, flight: true });
      expect(panelMaxQ(def(id))).toBeLessThan(10_000);
    }
    expect(tweakDescriptors(def('solar-patch')).find(x => x.key === 'autoDeploy')).toBeUndefined();
    // Extended at launch in the editor: out from the first frame.
    expect(panelOf(buildVessel(craft({ extended: true }), PART_CATALOG))!.panelDeploy).toBe(1);
  });

  it('tear off as debris above their rated dynamic pressure, and earlier while moving', () => {
    const maxQ = panelMaxQ(def('solar-fold'));
    const below = buildVessel(craft(OUT), PART_CATALOG);
    const r0 = stepVessel(below, neutralInput(), inAirflow(below, 0.95 * maxQ), 0);
    expect(r0.newVessels).toHaveLength(0);
    expect(below.telemetry.deployableLoad).toBeGreaterThan(PANEL_LOAD_WARN);

    const above = buildVessel(craft(OUT), PART_CATALOG);
    const r1 = stepVessel(above, neutralInput(), inAirflow(above, 1.05 * maxQ), 0);
    const tear = r1.events.find((e): e is Extract<VesselEvent, { type: 'structuralFailure' }> => e.type === 'structuralFailure');
    expect(tear).toMatchObject({ partUid: 2, cause: 'airload' });
    expect(panelOf(above)).toBeUndefined();
    const debris = r1.newVessels.find(n => n.id === tear!.newVesselId)!;
    expect(panelOf(debris)!.panelTorn).toBe(true);
    expect(isExtended(panelOf(debris)!)).toBe(false);

    const moving = buildVessel(craft(OUT), PART_CATALOG);
    panelOf(moving)!.panelDeploy = 0.5;
    const r2 = stepVessel(moving, neutralInput(), inAirflow(moving, (MOVING_LOAD_FACTOR + 0.05) * maxQ), 0);
    expect(r2.events.some(e => e.type === 'structuralFailure' && e.cause === 'airload')).toBe(true);

    // Stowed hardware rides through the same air untouched.
    const stowed = buildVessel(craft({ autoDeploy: false }), PART_CATALOG);
    expect(stepVessel(stowed, neutralInput(), inAirflow(stowed, 10 * maxQ), 0).newVessels).toHaveLength(0);
    expect(stowed.telemetry.deployableLoad).toBe(0);
  });

  it('tear off when their skin overheats', () => {
    const v = buildVessel(craft(OUT), PART_CATALOG);
    const p = panelOf(v)!;
    p.skinTemperature = p.skinTemperature.map(() => 0.85 * p.maxTemp);
    const r = stepVessel(v, neutralInput(), vacuumEnv(), 0, undefined, { disableHeating: true });
    expect(r.events.find(e => e.type === 'structuralFailure')).toMatchObject({ partUid: 2, cause: 'heat' });
  });

  it('stop producing power when stowed, moving or torn off', () => {
    const charge = (v: VesselState) => v.parts.reduce((s, p) => s + (p.resources.electricCharge ?? 0), 0);
    const gain = (v: VesselState, env = vacuumEnv()) => {
      for (const p of v.parts) if (p.maxResources.electricCharge) p.resources.electricCharge = p.maxResources.electricCharge / 2;
      const before = charge(v); stepVessel(v, neutralInput(), env, 0); return charge(v) - before; };
    const drain = gain(buildVessel(craft({ autoDeploy: false }), PART_CATALOG));
    expect(drain).toBeLessThan(0);
    expect(gain(buildVessel(craft(OUT), PART_CATALOG))).toBeGreaterThan(0);
    const moving = buildVessel(craft(OUT), PART_CATALOG);
    panelOf(moving)!.panelDeploy = 0.5;
    expect(gain(moving)).toBeCloseTo(drain, 12);
    const torn = buildVessel(craft(OUT), PART_CATALOG);
    stepVessel(torn, neutralInput(), inAirflow(torn, 2 * panelMaxQ(def('solar-fold'))), 0);
    expect(panelOf(torn)).toBeUndefined();
    torn.velocity = v3();
    expect(gain(torn)).toBeLessThan(0);
  });

  it('extend above the atmosphere and stow again in thick air, with hysteresis', () => {
    const v = buildVessel(craft(), PART_CATALOG);
    const p = panelOf(v)!;
    const run = (q: number, pressure: number, seconds = 0.02) => { for (let t = 0; t < seconds - 1e-9; t += 0.02) stepDeployables(v, q, pressure, 0.02); };
    run(0, 101325); // on the pad
    expect(isExtended(p)).toBe(false);
    run(40, 50); // thinning, inside the band
    expect(isExtended(p)).toBe(false);
    run(5, 50, 1); // thin air: extending
    expect(isExtended(p)).toBe(true);
    expect(p.panelDeploy).toBeCloseTo(0.5, 6);
    run(0, 0, 1.5);
    expect(p.panelDeploy).toBe(1);
    run(AUTO_STOW_Q * 0.9, 500); // descending, inside the band: stays out
    expect(isExtended(p)).toBe(true);
    run(AUTO_STOW_Q * 1.1, 500, 0.5); // stows before the load gets dangerous
    expect(isExtended(p)).toBe(false);
    expect(p.panelDeploy).toBeCloseTo(0.75, 6);
    run(5, 50);
    expect(isExtended(p)).toBe(true);
    // A manual retract in vacuum holds until the air next crosses a threshold.
    p.tweaks = { ...p.tweaks, extended: false };
    run(0, 0, 1);
    expect(isExtended(p)).toBe(false);
    // Turned off: never moves on its own.
    const manual = buildVessel(craft({ autoDeploy: false }), PART_CATALOG);
    stepDeployables(manual, 0, 0, 0.02);
    expect(isExtended(panelOf(manual)!)).toBe(false);
  });

  it('honour launch settings and open when spawned in vacuum', () => {
    const pad = buildVessel(craft({ extended: true }), PART_CATALOG);
    stepDeployables(pad, 0, 101325, 0.02);
    expect(isExtended(panelOf(pad)!)).toBe(true);
    const orbit = buildVessel(craft(), PART_CATALOG);
    stepDeployables(orbit, 0, 0, 0.02);
    expect(isExtended(panelOf(orbit)!)).toBe(true);
  });

  it('round-trip the new setting and state through saves and validation', () => {
    expect(validTweaks({ autoDeploy: false })).toBe(true);
    expect(validTweaks({ autoDeploy: false }, true)).toBe(true);
    expect(validTweaks({ autoDeploy: 1 })).toBe(false);
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(craft({ autoDeploy: false, extended: true }));
    const part = panelOf(world.active!.state)!;
    part.panelDeploy = 0.25;
    part.autoDeploySafe = false;
    const restored = panelOf(deserializeWorld(serializeWorld(world), PART_CATALOG).active!.state)!;
    expect(restored.tweaks).toEqual({ autoDeploy: false, extended: true });
    expect(restored.panelDeploy).toBe(0.25);
    expect(restored.autoDeploySafe).toBe(false);
  });

  it('keep hardware from older flight saves extended, and pads on the new default', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(craft());
    const saved = serializeWorld(world);
    const legacy = (mode: 'physics' | 'prelaunch') => {
      const copy = structuredClone(saved);
      copy.vessels[0].mode = mode;
      for (const p of copy.vessels[0].state.parts) { delete p.panelDeploy; delete p.tweaks; }
      return panelOf(deserializeWorld(copy, PART_CATALOG).active!.state)!;
    };
    expect(legacy('physics')).toMatchObject({ panelDeploy: 1, tweaks: { extended: true } });
    expect(legacy('prelaunch')).toMatchObject({ panelDeploy: 0, tweaks: { extended: false } });
  });

  it('keep a near-field command link while an antenna is stowed', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(craft(undefined, 'antenna-thread'));
    const net = () => worldNetwork(world).connections.get(world.active!.state.id);
    expect(net()?.connected).toBe(true);
    world.active!.state.parts[1].tweaks = { extended: true };
    expect(net()?.connected).toBe(true);
  });

  it('raise a HUD caution before tearing and a warning when close', () => {
    const base: AlertInput = { noControl: false, eva: false, flying: true, heatFraction: 0, gForce: 1, agl: 5000, verticalSpeed: 100,
      horizontalSpeed: 0, chutes: false, gear: null, thrusting: true, stageBurnTime: NaN, flameout: false, power: 1 };
    expect(alertConditions({ ...base, panelLoad: 0.5 }).find(a => a.id === 'panels')).toBeUndefined();
    expect(alertConditions({ ...base, panelLoad: 0.75 }).find(a => a.id === 'panels')).toMatchObject({ level: 'warn' });
    expect(alertConditions({ ...base, panelLoad: 0.95 }).find(a => a.id === 'panels')).toMatchObject({ level: 'bad' });
  });
});

describe('arrays on a stock ascent', () => {
  it('extended by hand: a caution first, then they tear off during ascent', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const orbiter = buildOrbiter();
    for (const p of orbiter.parts) if (def(p.partId).id === 'solar-fold') p.tweaks = { ...p.tweaks, extended: true, autoDeploy: false };
    world.launch(orbiter);
    const torn: { ut: number; q: number }[] = [];
    let firstWarn = Infinity;
    const messages: string[] = [];
    world.onEvent = e => {
      if (e.type === 'structuralFailure' && e.cause) torn.push({ ut: world.ut, q: world.active!.state.telemetry.dynamicPressure });
    };
    const log: string[] = [];
    flyToOrbit(world, 85000, log, () => {
      if ((world.active!.state.telemetry.deployableLoad ?? 0) >= PANEL_LOAD_WARN) firstWarn = Math.min(firstWarn, world.ut);
      for (const m of world.messages) if (!messages.includes(m.text)) messages.push(m.text);
    });
    expect(torn.length).toBe(2);
    expect(firstWarn).toBeLessThan(torn[0].ut);
    const record = world.flightlog.records.find(r => r.vesselId === world.active!.state.id)!;
    expect(record.events.filter(e => e.kind === 'partLoss').map(e => e.detail)).toEqual(new Array(2).fill('Sunfold Array was ripped off by the airstream'));
    expect(messages).toContain('Sunfold Array was ripped off by the airstream');
  }, 120000);

  it('left on automatic: stowed through the air, open in orbit, power positive', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter());
    let tears = 0;
    world.onEvent = e => { if (e.type === 'structuralFailure') tears++; };
    const log: string[] = [];
    let openedAt = NaN;
    const phase = flyToOrbit(world, 85000, log, () => {
      const arrays = world.active!.state.parts.filter(p => p.partId === 'solar-fold');
      if (Number.isNaN(openedAt) && arrays.length && arrays.every(p => isExtended(p))) openedAt = length(world.relativeState(world.active!).position) - world.universe.body('earth').radius;
    });
    expect(phase).toBe('done');
    expect(tears).toBe(0);
    const arrays = world.active!.state.parts.filter(p => p.partId === 'solar-fold');
    expect(arrays.length).toBe(2);
    for (const p of arrays) expect(p.panelDeploy).toBe(1);
    expect(openedAt).toBeGreaterThan(30_000);
  }, 120000);
});

describe('editor advisory', () => {
  it('flags arrays extended at launch outside a fairing', () => {
    expect(preflightChecks(craft(), PART_CATALOG).find(c => c.id === 'panels-out')).toBeUndefined();
    expect(preflightChecks(craft({ extended: true }), PART_CATALOG).find(c => c.id === 'panels-out')).toMatchObject({ uids: [2] });
  });
});
