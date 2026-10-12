import { describe, expect, it } from 'vitest';
import { FlightController } from '../src/flight/controller';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildMoonLander, buildSwift } from '../src/editor/stockCrafts';
import { gearState, neutralInput, setGear, type VesselState } from '../src/sim/vessel';

const PHYSICS_DT = 1 / 50;

function launch(craft: ReturnType<typeof buildMoonLander>) {
  const world = new World(new Universe('standard'), PART_CATALOG, 1000);
  return { world, wv: world.launch(craft) };
}
const legs = (v: VesselState) => v.parts.filter(p => p.leg);
const wheels = (v: VesselState) => v.parts.filter(p => p.wheel && (p.def.modules[p.wheel.moduleIndex] as { retractable?: boolean }).retractable);
/** A synthetic bay, as a cargo/service bay part would be (stock landers carry none). */
const addBay = (v: VesselState, open: boolean) => { v.parts[0].bayOpen = open; };

/** Drive toggleGear on a stand-in controller so the real method runs without a renderer. */
function pilot(world: World) {
  const queued: unknown[] = [];
  const messages: string[] = [];
  const self = {
    world,
    gearPending: undefined as boolean | undefined,
    gearWanted: undefined as { vesselId: string; down: boolean } | undefined,
    hasBindings: (g: string) => !!world.active && world.active.state.parts.some(p => p.actions?.[g as 'gear']?.length),
    fireGroup: (group: string, state?: boolean) => { queued.push({ kind: 'group', group, state }); },
  };
  world.message = ((m: string) => { messages.push(m); }) as typeof world.message;
  const press = () => FlightController.prototype.toggleGear.call(self as unknown as FlightController);
  /** One controller frame: hand the pending command to the world and clear it, as the frame loop does. */
  const frame = (dt: number) => {
    world.tick(dt, neutralInput({ gear: self.gearPending }));
    self.gearPending = undefined;
  };
  return { self, press, frame, messages, queued };
}

describe('gearState', () => {
  it('is down only when every leg and retractable wheel is down; bays never decide it', () => {
    const { wv } = launch(buildMoonLander());
    const v = wv.state;
    expect(legs(v).length).toBeGreaterThan(1);
    setGear(v, false);
    expect(gearState(v)).toBe(false);
    legs(v)[0].leg!.deployed = true; // one stray leg down
    expect(gearState(v)).toBe(false);
    setGear(v, true);
    expect(gearState(v)).toBe(true);
    legs(v)[0].leg!.deployed = false;
    expect(gearState(v)).toBe(false);
    setGear(v, false);
    addBay(v, true); // open bay with legs up
    expect(gearState(v)).toBe(false);
    setGear(v, true);
    v.parts[0].bayOpen = false; // closed bay with legs down
    expect(gearState(v)).toBe(true);
  });
  it('falls back to bays on a vessel without legs or wheels, and is undefined with nothing to move', () => {
    const { wv } = launch(buildMoonLander());
    const v = wv.state;
    for (const p of v.parts) { delete p.leg; delete p.wheel; }
    expect(gearState(v)).toBeUndefined();
    addBay(v, true);
    expect(gearState(v)).toBe(true);
    v.parts[0].bayOpen = false;
    expect(gearState(v)).toBe(false);
  });
  it('counts a retractable-wheel plane as down only when all wheels are down', () => {
    const { wv } = launch(buildSwift());
    const v = wv.state;
    expect(wheels(v).length).toBeGreaterThan(1);
    expect(gearState(v)).toBe(true);
    wheels(v)[0].wheel!.deployed = false;
    expect(gearState(v)).toBe(false);
  });
});

describe('G key', () => {
  it('lowers the legs of a lander in one press even when a bay is open', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    setGear(wv.state, false);
    addBay(wv.state, true);
    p.press();
    p.frame(PHYSICS_DT);
    expect(legs(wv.state).every(l => l.leg!.deployed)).toBe(true);
    expect(p.messages.at(-1)).toBe('Gear down');
  });
  it('lowers all legs when only one is still down, and raises them when all are down', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    setGear(wv.state, false);
    legs(wv.state)[0].leg!.deployed = true;
    p.press(); p.frame(PHYSICS_DT);
    expect(legs(wv.state).every(l => l.leg!.deployed)).toBe(true);
    p.press(); p.frame(PHYSICS_DT);
    expect(legs(wv.state).some(l => l.leg!.deployed)).toBe(false);
    expect(p.messages).toEqual(['Gear down', 'Gear up']);
  });
  it('is not lost on render frames that run no physics step (120 Hz display, 50 Hz physics)', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    setGear(wv.state, false);
    p.press();
    p.frame(0.004); // far less than one physics step: the world must keep the request
    expect(legs(wv.state).some(l => l.leg!.deployed)).toBe(false);
    for (let i = 0; i < 6; i++) p.frame(0.008);
    expect(legs(wv.state).every(l => l.leg!.deployed)).toBe(true);
  });
  it('works for a plane with retractable wheels', () => {
    const { world, wv } = launch(buildSwift());
    const p = pilot(world);
    p.press(); p.frame(0.004); p.frame(0.03);
    expect(wheels(wv.state).every(w => !w.wheel!.deployed)).toBe(true);
    p.press(); p.frame(0.03);
    expect(wheels(wv.state).every(w => w.wheel!.deployed)).toBe(true);
  });
  it('alternates on rapid presses made before the sim has applied the last one', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    setGear(wv.state, false);
    p.press(); p.press(); p.press(); // down, up, down — nothing stepped in between
    p.frame(PHYSICS_DT);
    expect(legs(wv.state).every(l => l.leg!.deployed)).toBe(true);
    expect(p.messages).toEqual(['Gear down', 'Gear up', 'Gear down']);
    p.press(); p.press(); p.frame(PHYSICS_DT); // up then down again, across a zero-step frame
    expect(legs(wv.state).every(l => l.leg!.deployed)).toBe(true);
    p.press(); p.frame(PHYSICS_DT);
    expect(legs(wv.state).some(l => l.leg!.deployed)).toBe(false);
  });
  it('alternates when presses straddle a frame that has not stepped yet', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    setGear(wv.state, false);
    p.press(); p.frame(0.004); // handed to the world, vessel still shows legs up
    p.press(); p.frame(0.004); // second press must mean "up", not "down" again
    p.frame(0.05);
    expect(legs(wv.state).some(l => l.leg!.deployed)).toBe(false);
  });
  it('drives the gear action group with the same direction, and bays follow the legs', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    setGear(wv.state, false);
    wv.state.parts[1].actions = { gear: ['deploy.toggle'] };
    addBay(wv.state, true);
    p.press();
    expect(p.queued).toEqual([{ kind: 'group', group: 'gear', state: true }]);
    p.frame(PHYSICS_DT);
    expect(legs(wv.state).every(l => l.leg!.deployed)).toBe(true);
    expect(wv.state.parts[0].bayOpen).toBe(true);
  });
  it('on a group-only vessel reports the direction it actually sent', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    for (const part of wv.state.parts) { delete part.leg; delete part.wheel; }
    wv.state.parts[1].actions = { gear: ['deploy.toggle'] };
    p.press(); p.press();
    expect(p.messages).toEqual(['Gear down', 'Gear up']);
    expect(p.queued).toEqual([{ kind: 'group', group: 'gear', state: true }, { kind: 'group', group: 'gear', state: false }]);
  });
  it('does nothing on a vessel with no gear and no bound group', () => {
    const { world, wv } = launch(buildMoonLander());
    const p = pilot(world);
    for (const part of wv.state.parts) { delete part.leg; delete part.wheel; }
    p.press();
    expect(p.messages).toEqual([]);
  });
});
