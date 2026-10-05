import { describe, it, expect, afterEach, vi } from 'vitest';
import { LESSONS, stableOrbit, type TutorialContext } from '../src/tutorial/lessons';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT, game } from '../src/game/store';
import { EditorSession } from '../src/editor/session';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { COMPLETION_KEY, startLesson, getTutorial, endTutorial, tickTutorial, advanceTutorial, readCompletions, saveCompletion } from '../src/tutorial/runtime';

function setup(id: string) {
  const lesson = LESSONS.find(l => l.id === id)!;
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
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
    flight.input.state.throttle = 0.8;
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
  it('starts EVA on terrain with a crewed cabin and supports going outside and boarding', () => {
    const world = setup('eva');
    expect(world.active!.body).toBe('moon');
    for (let i = 0; i < 50; i++) world.tick(0.02, neutralInput());
    expect(world.active!.state.destroyed).toBe(false);
    expect(world.goEva()).not.toBeNull();
    expect(predicate('eva', 'eva', { world })).toBe(true);
    expect(predicate('eva', 'board', { world })).toBe(false);
    expect(world.boardEva()).toBe(true);
    expect(predicate('eva', 'board', { world })).toBe(true);
  });
});
describe('training progression and storage', () => {
  function storage() {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
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
