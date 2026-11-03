import { describe, expect, it } from 'vitest';
import { FlightController } from '../src/flight/controller';
import { WarpDriver } from '../src/flight/controller/warp';
import { alertTracker, shownAlerts } from '../src/flight/controller/telemetry';
import { SpeedModeTracker } from '../src/flight/speedMode';
import type { AlertInput } from '../src/flight/alerts';
import { World, type WorldVessel } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter, buildTender } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../src/game/scenarios';
import type { VesselCommand } from '../src/sim/vessel/runtime';

/** The controller's pilot state on a stand-in (no renderer): its real methods run against a real World. */
type Pilot = Omit<FlightController, 'input' | 'cam'> & {
  input: { state: { throttle: number }; trim: { pitch: number; yaw: number; roll: number } };
  cam: { mode: string };
  pendingCommands: VesselCommand[];
  sasHeld: boolean; stagePending: boolean; evaJumpPending: boolean; gearPending: boolean | undefined;
  syncTarget(): void;
  tickCountdown(dt: number): void;
};

function pilot(world: World): { c: Pilot; messages: string[] } {
  const messages: string[] = [];
  world.message = ((m: string) => { messages.push(m); }) as typeof world.message;
  const c = Object.create(FlightController.prototype) as Pilot;
  Object.assign(c, {
    world, network: null, assist: null, paused: false, audio: null, systems: { assistWarped: false },
    input: { state: { throttle: 0 }, trim: { pitch: 0, yaw: 0, roll: 0 } },
    cam: { mode: 'auto' }, warpDriver: new WarpDriver(), speedReference: new SpeedModeTracker(),
    sasOn: false, sas: 'off', sasHeld: false, rcsOn: false, dockingMode: false, ownPortUid: null, stageLocked: false,
    countdown: null, stagePending: false, evaJumpPending: false, gearPending: undefined, pendingCommands: [],
    pilotedId: world.activeId, hadTarget: !!world.targetId, padId: null,
  });
  return { c, messages };
}

/** An orbiter in low orbit with a docking target 100 m ahead (both in physics range). */
function rendezvous() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const a = world.launch(buildTender());
  placeInCircularOrbit(world, a, 'earth', 150000);
  const b = spawnRendezvousTarget(world, buildTender(), 100)!;
  return { world, a, b };
}

/** Everything a pilot can have set up for the vessel they are flying. */
function flyHard(c: Pilot) {
  Object.assign(c, { sasOn: true, sas: 'prograde', sasHeld: true, rcsOn: true, dockingMode: true, ownPortUid: 7, stageLocked: true, stagePending: true, evaJumpPending: true, gearPending: true });
  c.input.state.throttle = 1;
  c.input.trim.pitch = 0.2;
  c.pendingCommands.push({ kind: 'group', group: 'lights', state: true });
  c.cam.mode = 'chase';
}

function expectFreshControls(c: Pilot) {
  expect(c.input.state.throttle).toBe(0);
  expect(c.sasOn).toBe(false);
  expect(c.sas).toBe('off');
  expect(c.sasHeld).toBe(false);
  expect(c.rcsOn).toBe(false);
  expect(c.dockingMode).toBe(false);
  expect(c.ownPortUid).toBeNull();
  expect(c.stagePending).toBe(false);
  expect(c.evaJumpPending).toBe(false);
  expect(c.gearPending).toBeUndefined();
  expect(c.pendingCommands).toEqual([]);
  expect(c.input.trim).toEqual({ pitch: 0, yaw: 0, roll: 0 });
}

describe('switching the active vessel', () => {
  it('[ / ] give the next vessel fresh controls; pilot preferences carry over', () => {
    const { world, b } = rendezvous();
    const { c, messages } = pilot(world);
    flyHard(c);
    c.switchVessel(1);
    expect(world.activeId).toBe(b.state.id);
    expectFreshControls(c);
    expect(c.stageLocked).toBe(true);
    expect(c.cam.mode).toBe('chase');
    expect(messages.at(-1)).toBe(`Switched to ${b.state.name}`);
  });

  it('a switch made elsewhere (map, World) is picked up once, on the next frame', () => {
    const { world, a, b } = rendezvous();
    const { c } = pilot(world);
    flyHard(c);
    c.syncActiveVessel();
    expect(c.sasOn).toBe(true); // same vessel: nothing resets
    world.switchTo(b.state.id);
    c.syncActiveVessel();
    expectFreshControls(c);
    c.sasOn = true;
    c.syncActiveVessel();
    expect(c.sasOn).toBe(true);
    expect(c.switchToVessel(a.state.id)).toBe(true);
    expect(c.sasOn).toBe(false);
  });

  it('cancels a running assist program and returns its settings to the vessel it flew', () => {
    const { world, a, b } = rendezvous();
    const { c, messages } = pilot(world);
    world.addNode(world.ut + 600).prograde = 20;
    c.startAssist('node');
    expect(c.assist).not.toBeNull();
    const engine = a.state.parts.find(p => p.engine)!;
    // The program had lowered a thrust limit for the end of the burn.
    c.assist!.release = () => [{ kind: 'tweak', uid: engine.uid, tweaks: { thrustLimit: 0.3 }, symmetric: false }];
    c.switchVessel(1);
    expect(world.activeId).toBe(b.state.id);
    expect(c.assist).toBeNull();
    expect(engine.tweaks?.thrustLimit).toBe(0.3);
    expect(b.state.parts.find(p => p.uid === engine.uid)?.tweaks?.thrustLimit).toBeUndefined();
    expect(c.pendingCommands).toEqual([]);
    expect(c.sasOn).toBe(false);
    expect(messages).toContain('Assist cancelled: switched vessels');
  });

  it('cancels a launch countdown instead of launching the vessel switched to', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const a = world.launch(buildOrbiter());
    const b = world.launch(buildOrbiter(), 'pad', true);
    world.switchTo(a.state.id);
    const { c, messages } = pilot(world);
    c.countdown = 1;
    c.switchToVessel(b.state.id);
    expect(world.activeId).toBe(b.state.id);
    c.tickCountdown(2);
    expect(c.countdown).toBeNull();
    expect(c.stagePending).toBe(false);
    expect(b.mode).toBe('prelaunch');
    expect(messages).toContain('Launch countdown cancelled');
  });

  it('drops the old vessel’s lingering and silenced alerts', () => {
    const { world, b } = rendezvous();
    const { c } = pilot(world);
    const flight = c as unknown as FlightController;
    const hot: AlertInput = { noControl: false, eva: false, flying: true, heatFraction: 0.95, gForce: 1, agl: 1e5, verticalSpeed: 0, horizontalSpeed: 0,
      chutes: false, gear: null, thrusting: false, stageBurnTime: Number.NaN, flameout: false, power: Number.NaN };
    const tracker = alertTracker(flight);
    tracker.update(hot, 0);
    tracker.silence('heat');
    expect(shownAlerts(flight)[0]).toMatchObject({ id: 'heat', silenced: true });
    world.switchTo(b.state.id);
    c.syncActiveVessel();
    expect(shownAlerts(flight)).toEqual([]);
    // The new vessel overheating is its own warning, with its tone.
    expect(tracker.update(hot, 0.1)[0].silenced).toBeUndefined();
  });

  it('puts the camera back in the astronaut’s cycle when switching to one', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter());
    const { c } = pilot(world);
    c.cam.mode = 'chase';
    expect(world.goEva()).toBeTruthy();
    c.syncActiveVessel();
    expect(c.cam.mode).toBe('auto');
    c.cam.mode = 'locked';
    world.boardEva();
    c.syncActiveVessel();
    expect(c.cam.mode).toBe('locked');
  });
});

describe('target loss', () => {
  it('ends docking mode and target holds when the target goes away, not when it was never set', () => {
    const { world } = rendezvous();
    const { c } = pilot(world);
    Object.assign(c, { dockingMode: true, sasOn: true, sas: 'target' });
    c.syncTarget();
    expect(c.dockingMode).toBe(true);
    world.setTarget(null);
    c.syncTarget();
    expect(c.dockingMode).toBe(false);
    expect(c.sas).toBe('stabilityAssist');
    // The docking button still works without a target (to choose your own port first).
    c.toggleDockingMode();
    c.syncTarget();
    expect(c.dockingMode).toBe(true);
  });
});

describe('pad equipment vessel', () => {
  it('keeps holding the vessel on the pad while another vessel is flown', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const a = world.launch(buildOrbiter());
    const { c } = pilot(world);
    expect(c.padVesselFor(a)).toBe(a);
    const eva = world.goEva() as WorldVessel;
    expect(eva).toBeTruthy();
    expect(c.padVesselFor(eva)).toBe(a);
    a.mode = 'physics'; // it launched after all
    expect(c.padVesselFor(eva)).toBe(eva);
  });
});
