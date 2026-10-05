import { afterEach, describe, expect, it, vi } from 'vitest';
import { game, DEFAULT_START_UT } from '../src/game/store';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { startLesson, endTutorial } from '../src/tutorial/runtime';
import { startScenario, endScenario, attachScenarioWorld, getScenarioRun } from '../src/scenarios/runtime';
import { neutralInput } from '../src/sim/vessel';
import { loadAchievements } from '../src/game/flightlog/storage';

const original = game.get();
afterEach(() => { endTutorial(); endScenario(); game.set(original); vi.unstubAllGlobals(); });
describe('practice recorder and program isolation', () => {
  it.each(['lesson', 'scenario'])('%s records flight and shares earned achievements while restoring the program', kind => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.launch(buildOrbiter()); world.discoveries = ['program-discovery'];
    const saved = serializeWorld(world);
    game.set({ resumeWorld: saved, saveId: 'qa-program', craft: buildOrbiter(), scene: 'spaceCenter' });
    const prior = game.get(), remembered = values.get('wsp.craft.v1');
    if (kind === 'lesson') startLesson('moon-landing'); else startScenario('moon-landing');
    const practice = deserializeWorld(game.get().resumeWorld!, PART_CATALOG);
    practice.tick(0.02, neutralInput());
    expect(practice.flightlog.records.some(r => r.bodies.includes('moon'))).toBe(true);
    expect(loadAchievements().unlocked['soi-moon']).toBeDefined();
    expect(values.get('wsp.craft.v1')).toBe(remembered);
    if (kind === 'lesson') endTutorial(); else endScenario();
    expect(game.get().resumeWorld).toEqual(prior.resumeWorld);
    expect(game.get().saveId).toBe('qa-program');
    expect(saved.flightlog!.records.some(r => r.bodies.includes('moon'))).toBe(false);
    expect(values.has('wsp.world.v1.autosave')).toBe(false);
  });
  it('stops a failed scenario once, records the loss, and restores step observation after reload', () => {
    startScenario('suicide-burn');
    const world = deserializeWorld(game.get().resumeWorld!, PART_CATALOG);
    const pause = vi.fn(); const detach = attachScenarioWorld(world, pause);
    for (let i = 0; i < 400 && !getScenarioRun()?.result; i++) world.tick(0.25, neutralInput());
    expect(getScenarioRun()?.result?.success).toBe(false);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(world.flightlog.records.some(r => r.outcome === 'lost')).toBe(true);
    detach(); expect(world.onSimulationStep).toBeNull();
    const loaded = deserializeWorld(serializeWorld(world), PART_CATALOG);
    const detachLoaded = attachScenarioWorld(loaded, pause);
    expect(pause).toHaveBeenCalledTimes(2); detachLoaded();
  });
});
