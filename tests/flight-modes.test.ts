import { describe, expect, it } from 'vitest';
import { FlightController } from '../src/flight/controller';
import { FlightInput } from '../src/flight/input';
import { WarpDriver } from '../src/flight/controller/warp';
import { actionAllowedInPhoto } from '../src/flight/modals';
import { game } from '../src/game/store';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';

/** Controller methods on a stand-in (no renderer) against a real World; `calls` records the map/view side effects. */
function pilot(world: World) {
  const messages: string[] = [];
  const calls: string[] = [];
  world.message = ((m: string) => { messages.push(m); }) as typeof world.message;
  const c = Object.create(FlightController.prototype) as Omit<FlightController, never> & {
    stagePending: boolean; tickCountdown(dt: number): void; activeVesselLost(wv: unknown): void;
  };
  Object.assign(c, {
    world, network: null, paused: false, audio: null, mapMode: false, stageLocked: false, countdown: null, stagePending: false,
    activeLost: false, warpDriver: new WarpDriver(),
    map: { setVisible: (on: boolean) => calls.push(`labels ${on}`), animateFrom: () => calls.push('zoom out') },
    pipeline: { setMapMode: (on: boolean) => calls.push(`hi-res ${on}`) },
    mapUi: { reset: () => calls.push('map reset'), focus: null },
    flashFade: () => calls.push('fade'),
  });
  return { c, messages, calls };
}

describe('launch countdown and the staging lock', () => {
  it('locking staging cancels a running countdown; it never stages', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter());
    const { c, messages } = pilot(world);
    c.countdown = 2;
    c.toggleStageLock();
    expect(c.countdown).toBeNull();
    expect(messages.at(-1)).toMatch(/launch countdown cancelled/);
    c.tickCountdown(3);
    expect(c.stagePending).toBe(false);
    // Unlocking does not bring the count back.
    c.toggleStageLock();
    c.tickCountdown(3);
    expect(c.stagePending).toBe(false);
    expect(messages.at(-1)).toBe('Staging unlocked');
  });
});

describe('flight and map view transitions', () => {
  it('M switches map labels, map resolution and map menus together, with the fade', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter());
    const { c, calls } = pilot(world);
    const reduce = game.get().settings.reduceMotion;
    game.set({ settings: { ...game.get().settings, reduceMotion: true } });
    try {
      c.toggleMap();
      expect(c.mapMode).toBe(true);
      expect(calls).toEqual(['labels true', 'hi-res true', 'map reset', 'fade']);
    } finally { game.set({ settings: { ...game.get().settings, reduceMotion: reduce } }); }
  });

  it('losing the vessel with the map open leaves the whole map view (labels, hi-res map pass, menus)', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const wv = world.launch(buildOrbiter());
    const { c, calls } = pilot(world);
    c.mapMode = true;
    world.vessels.delete(wv.state.id);
    world.activeId = null;
    c.activeVesselLost(wv);
    expect(c.mapMode).toBe(false);
    expect(calls).toEqual(['labels false', 'hi-res false', 'map reset']);
  });
});

describe('momentary SAS hold while input is suspended', () => {
  const harness = () => {
    const target = Object.assign(new EventTarget(), {
      document: { hasFocus: () => true, activeElement: null },
      navigator: { getGamepads: () => [] },
    });
    const input = new FlightInput(target as unknown as Window);
    const actions: string[] = [];
    input.onAction(a => actions.push(a));
    const send = (type: string, code: string) => target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
    return { input, actions, send };
  };

  it('releases the hold when input is disabled, so the next F press is a new hold', () => {
    const h = harness();
    try {
      h.send('keydown', 'KeyF');
      expect(h.actions).toEqual(['sasHold']);
      // Photo mode (or a pause) disables flight input; photo mode also swallows the key-up.
      h.input.enabled = false;
      h.input.update(0.016);
      expect(h.actions).toEqual(['sasHold', 'sasHoldRelease']);
      h.input.enabled = true;
      h.input.update(0.016);
      h.send('keydown', 'KeyF');
      h.send('keyup', 'KeyF');
      expect(h.actions).toEqual(['sasHold', 'sasHoldRelease', 'sasHold', 'sasHoldRelease']);
    } finally { h.input.dispose(); }
  });

  it('photo mode lets only the hold release through to the flight', () => {
    expect(actionAllowedInPhoto('sasHoldRelease')).toBe(true);
    for (const a of ['stage', 'toggleSas', 'sasHold', 'menu', 'quickload', 'map'] as const) expect(actionAllowedInPhoto(a)).toBe(false);
  });
});
