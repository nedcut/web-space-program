import { requireIntactFlight } from './helpers/structural';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LESSONS, stableOrbit, type TutorialContext } from '../src/tutorial/lessons';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT, game } from '../src/game/store';
import { EditorSession } from '../src/editor/session';
import { Builder, buildSoundingRocket } from '../src/editor/stockCrafts';
import { neutralInput, freePorts, mergeVessels } from '../src/sim/vessel';
import { placeInCircularOrbit, placeOnSurface } from '../src/game/scenarios';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { dot, normalize, sub, v3 } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { COMPLETION_KEY, startLesson, getTutorial, endTutorial, tickTutorial, advanceTutorial, readCompletions, saveCompletion } from '../src/tutorial/runtime';

function setup(id: string) {
  const lesson = LESSONS.find(l => l.id === id)!;
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const craft = lesson.craft();
  if (craft) { world.launch(craft); lesson.setup?.(world); }
  return world;
}
function predicate(id: string, step: string, context: TutorialContext) { return LESSONS.find(l => l.id === id)!.steps.find(s => s.id === step)!.complete(context); }
afterEach(() => { endTutorial(); vi.unstubAllGlobals(); });
describe('training definitions and deterministic scenarios', () => {
  it('has eight unique lessons and valid steps safe without an attached scene', () => {
    expect(LESSONS).toHaveLength(8);
    expect(new Set(LESSONS.map(l => l.id)).size).toBe(8);
    for (const l of LESSONS) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(new Set(l.steps.map(s => s.id)).size).toBe(l.steps.length);
      for (const s of l.steps) { expect(s.text.length).toBeGreaterThan(20); expect(s.complete({})).toBe(false); }
    }
  });
  it('observes controller controls and maneuver creation without completing idle steps', () => {
    const flight = { mapMode: false, sasOn: false, rcsOn: false, dockingMode: false, input: { state: { throttle: 0 } } };
    const world = setup('moon-transfer');
    expect(predicate('first-flight', 'throttle', { flight })).toBe(false);
    flight.input.state.throttle = 1;
    expect(predicate('first-flight', 'throttle', { flight })).toBe(true);
    expect(predicate('first-flight', 'sas', { flight })).toBe(false);
    flight.sasOn = true;
    expect(predicate('first-flight', 'sas', { flight })).toBe(true);
    expect(predicate('moon-transfer', 'map', { flight })).toBe(false);
    flight.mapMode = true;
    expect(predicate('moon-transfer', 'map', { flight })).toBe(true);
    expect(predicate('moon-transfer', 'transfer', { world })).toBe(false);
    world.addNode(world.ut + 120);
    expect(predicate('moon-transfer', 'transfer', { world })).toBe(true);
    flight.dockingMode = true;
    expect(predicate('docking', 'mode', { flight })).toBe(false);
    flight.rcsOn = true;
    expect(predicate('docking', 'mode', { flight })).toBe(true);
  });
  it('starts each lesson independently with deterministic physical state and survives serialization', () => {
    for (const l of LESSONS.filter(l => l.scene === 'flight')) {
      const w = setup(l.id), second = setup(l.id);
      expect(w.active!.state.position).toEqual(second.active!.state.position);
      expect(w.active!.state.velocity).toEqual(second.active!.state.velocity);
      expect(w.active!.state.parts.map(p => p.partId)).toEqual(second.active!.state.parts.map(p => p.partId));
      const resumed = deserializeWorld(serializeWorld(w), PART_CATALOG);
      requireIntactFlight(resumed);
      expect(resumed.active!.body).toBe(w.active!.body);
      expect(resumed.canControl()).toBe(true);
      expect(resumed.active!.state.destroyed).toBe(false);
    }
  });
  it('recognizes assembled hardware and checks the actual engine-before-chute stage order', () => {
    const editor = new EditorSession();
    expect(predicate('building', 'pod', { editor })).toBe(false);
    editor.load(buildSoundingRocket(), false);
    for (const id of ['pod', 'tank', 'engine', 'chute', 'staging']) expect(predicate('building', id, { editor })).toBe(true);
    const craft = editor.currentCraft();
    editor.load({ ...craft, parts: craft.parts.map(p => ({ ...p, stage: 0 })) }, false);
    expect(predicate('building', 'staging', { editor })).toBe(false);
    editor.dispose();
  });
  it('rejects the reported Wisp stack and accepts a fueled surface lifter', () => {
    const b = new Builder(PART_CATALOG, 'Lesson rocket', 'Regression for launch thrust.');
    const pod = b.root('pod-lantern-1');
    const tank = b.stack(pod, 'tank-1-mid');
    const engine = b.stack(tank, 'eng-wisp');
    const editor = new EditorSession(b.done());
    expect(predicate('building', 'engine', { editor })).toBe(false);
    const craft = editor.currentCraft();
    editor.load({ ...craft, parts: craft.parts.map(p => p.uid === engine ? { ...p, partId: 'eng-sirocco' } : p) }, false);
    expect(predicate('building', 'engine', { editor })).toBe(true);
    editor.load({ ...editor.currentCraft(), parts: editor.currentCraft().parts.map(p => p.uid === tank ? { ...p, resources: { liquidFuel: 0, oxidizer: 0 } } : p) }, false);
    expect(predicate('building', 'engine', { editor })).toBe(false);
    editor.dispose();
  });
  it('requires full throttle for the limited Kestrel and an actual cutoff after 10 km', () => {
    const world = setup('first-flight');
    const flight = { mapMode: false, sasOn: true, rcsOn: false, dockingMode: false, input: { state: { throttle: 0.5 } } };
    expect(predicate('first-flight', 'throttle', { flight })).toBe(false);
    flight.input.state.throttle = 1;
    expect(predicate('first-flight', 'throttle', { flight })).toBe(true);
    placeInCircularOrbit(world, world.active!, 'earth', 11000);
    expect(predicate('first-flight', 'climb', { world, flight })).toBe(false);
    flight.input.state.throttle = 0;
    expect(predicate('first-flight', 'climb', { world, flight })).toBe(true);
  });
  it('distinguishes a bound safe orbit from atmosphere-crossing and surface states', () => {
    const w = setup('orbit');
    expect(stableOrbit({ world: w })).toBe(false);
    placeInCircularOrbit(w, w.active!, 'earth', 90000);
    expect(stableOrbit({ world: w })).toBe(true);
    placeInCircularOrbit(w, w.active!, 'earth', 10000);
    expect(stableOrbit({ world: w })).toBe(false);
    placeInCircularOrbit(w, w.active!, 'moon', 20000);
    expect(predicate('moon-transfer', 'arrival', { world: w })).toBe(true);
    expect(predicate('moon-transfer', 'capture', { world: w })).toBe(true);
    w.active!.state.destroyed = true;
    expect(stableOrbit({ world: w })).toBe(false);
  });
  it('observes stages, parachutes and safe landing instead of awarding success after a crash', () => {
    const world = setup('first-flight');
    expect(predicate('first-flight', 'stage', { world })).toBe(false);
    world.tick(0.02, neutralInput({ stage: true }));
    expect(predicate('first-flight', 'stage', { world })).toBe(true);
    const chute = world.active!.state.parts.find(p => p.chute)!;
    expect(predicate('first-flight', 'chute', { world })).toBe(false);
    chute.chute!.phase = 'full';
    expect(predicate('first-flight', 'chute', { world })).toBe(true);
    world.active!.state.situation = 'landed';
    expect(predicate('first-flight', 'landing', { world })).toBe(true);
    world.active!.state.destroyed = true;
    expect(predicate('first-flight', 'landing', { world })).toBe(false);
  });
  it('spawns a target, and lunar lander starts with its engine in the first stage', () => {
    const world = setup('docking');
    expect(world.vessels.size).toBe(2);
    expect(predicate('docking', 'target', { world })).toBe(false);
    world.setTarget([...world.vessels.keys()].find(id => id !== world.activeId)!);
    expect(predicate('docking', 'target', { world })).toBe(true);
    const moon = setup('moon-landing');
    moon.tick(0.02, neutralInput({ stage: true, throttle: 1 }));
    expect(moon.active!.state.parts.some(p => p.engine?.ignited)).toBe(true);
    expect(moon.active!.state.parts.some(p => p.partId === 'eng-chinook')).toBe(false);
  });
  it('observes lunar descent, terrain clearance, landing and docking state', () => {
    const world = setup('moon-landing');
    expect(predicate('moon-landing', 'radar', { world })).toBe(false);
    expect(predicate('moon-landing', 'land', { world })).toBe(false);
    world.active!.state.parts.find(p => p.leg)!.leg!.deployed = true;
    expect(predicate('moon-landing', 'legs', { world })).toBe(true);
    placeInCircularOrbit(world, world.active!, 'moon', 1000);
    expect(predicate('moon-landing', 'radar', { world })).toBe(true);
    const up = world.relativeState(world.active!).position;
    const r = Math.hypot(up.x, up.y, up.z);
    world.active!.state.velocity.x -= 20 * up.x / r;
    world.active!.state.velocity.y -= 20 * up.y / r;
    world.active!.state.velocity.z -= 20 * up.z / r;
    expect(predicate('moon-landing', 'descent', { world })).toBe(true);
    expect(predicate('moon-landing', 'burn', { world })).toBe(false);
    world.active!.state.telemetry.thrust = 100;
    expect(predicate('moon-landing', 'burn', { world })).toBe(true);
    placeOnSurface(world, world.active!, 'moon');
    expect(predicate('moon-landing', 'land', { world })).toBe(true);
    const dock = setup('docking');
    expect(predicate('docking', 'dock', { world: dock })).toBe(false);
    // A real simulated docking operation joins the practice target to the active craft.
    const target = [...dock.vessels.values()].find(v => v !== dock.active)!;
    const a = freePorts(dock.active!.state)[0].part;
    const b = freePorts(target.state)[0].part;
    mergeVessels(dock.active!.state, target.state, a.uid, b.uid);
    expect(predicate('docking', 'dock', { world: dock })).toBe(true);
  });
  it('observes aircraft acceleration, flight and stopped touchdown', () => {
    const world = setup('plane');
    expect(predicate('plane', 'runway', { world })).toBe(false);
    expect(predicate('plane', 'rotate', { world })).toBe(false);
    placeInCircularOrbit(world, world.active!, 'earth', 1000);
    expect(predicate('plane', 'runway', { world })).toBe(true);
    expect(predicate('plane', 'rotate', { world })).toBe(true);
    placeOnSurface(world, world.active!, 'earth');
    expect(predicate('plane', 'return', { world })).toBe(true);
  });
  it('starts EVA on terrain with a crewed cabin and supports going outside and boarding', () => {
    const world = setup('eva');
    expect(world.active!.body).toBe('moon');
    const lander = world.active!.state;
    for (let i = 0; i < 500; i++) world.tick(0.02, neutralInput());
    expect(world.active!.state.destroyed).toBe(false);
    // Set down on level ground: it must still stand upright (a 12° slope used to topple it within 7 s).
    const up = normalize(sub(lander.position, world.universe.ephem.getBodyState('moon', world.ut).position));
    expect(dot(qRotate(lander.orientation, v3(0, 1, 0)), up)).toBeGreaterThan(Math.cos(5 * Math.PI / 180));
    expect(world.goEva()).not.toBeNull();
    expect(predicate('eva', 'eva', { world })).toBe(true);
    expect(predicate('eva', 'board', { world })).toBe(false);
    world.active!.state.parts[0].resources.monopropellant = 4;
    expect(predicate('eva', 'jetpack', { world })).toBe(true);
    world.active!.state.situation = 'landed';
    world.plantFlag();
    expect(predicate('eva', 'flag', { world })).toBe(true);
    expect(world.boardEva()).toBe(true);
    expect(predicate('eva', 'board', { world })).toBe(true);
  });
});
describe('training progression and storage', () => {
  function storage() {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
    return data;
  }
  it('latches a goal, blocks premature Next, restarts, and restores the original program', () => {
    storage();
    const original = game.get();
    startLesson('building');
    advanceTutorial();
    expect(getTutorial()!.index).toBe(0);
    const editor = new EditorSession(buildSoundingRocket());
    tickTutorial({ editor });
    expect(getTutorial()!.ready).toBe(true);
    tickTutorial({});
    expect(getTutorial()!.ready).toBe(true);
    advanceTutorial();
    expect(getTutorial()!.index).toBe(1);
    startLesson('building');
    expect(getTutorial()!.index).toBe(0);
    expect(getTutorial()!.ready).toBe(false);
    endTutorial();
    expect(game.get().resumeWorld).toBe(original.resumeWorld);
    expect(game.get().mode).toBe(original.mode);
    expect(game.get().scene).toBe('training');
    editor.dispose();
  });
  it('keeps the remembered editor craft intact and retains settings changed during practice', () => {
    const data = storage();
    data.set('wsp.craft.v1', 'previous saved craft');
    startLesson('plane');
    expect(game.get().trainingActive).toBe(true);
    expect(data.get('wsp.craft.v1')).toBe('previous saved craft');
    game.set({ settings: { ...game.get().settings, masterVolume: 0.25 } });
    endTutorial();
    expect(game.get().trainingActive).toBe(false);
    expect(data.get('wsp.craft.v1')).toBe('previous saved craft');
    expect(game.get().settings.masterVolume).toBe(0.25);
  });
  it('only awards a checkmark after all goals; skipped steps never award completion', () => {
    storage();
    startLesson('building');
    for (const _ of LESSONS[0].steps) { void _; advanceTutorial(true); }
    expect(getTutorial()!.finished).toBe(true);
    expect(readCompletions()).toEqual([]);
    startLesson('building');
    const editor = new EditorSession(buildSoundingRocket());
    const world = setup('first-flight');
    for (const _ of LESSONS[0].steps) { void _; tickTutorial({ editor, world }); advanceTutorial(); }
    expect(getTutorial()!.finished).toBe(true);
    expect(readCompletions()).toEqual(['building']);
    saveCompletion('building');
    expect(readCompletions()).toEqual(['building']);
    editor.dispose();
  });
  it('ignores malformed storage and unknown lesson IDs, including unavailable storage', () => {
    const data = storage();
    data.set(COMPLETION_KEY, '{'); expect(readCompletions()).toEqual([]);
    data.set(COMPLETION_KEY, '["building",42,"unknown"]'); expect(readCompletions()).toEqual(['building']);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readCompletions()).toEqual([]);
    expect(() => saveCompletion('eva')).not.toThrow();
  });
});
