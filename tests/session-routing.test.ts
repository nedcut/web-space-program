import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { game, enterFlight, programCraftKey, DEFAULT_START_UT } from '../src/game/store';
import { resumeSave, serializeWorld } from '../src/game/persistence';
import { startProgram } from '../src/game/program';
import type { SaveSlot } from '../src/game/saveSlots';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import { startLesson, endTutorial, getTutorial } from '../src/tutorial/runtime';
import { startScenario, endScenario, getScenarioRun } from '../src/scenarios/runtime';
import { leaveTracking, persistTracking } from '../src/ui/tracking/leave';
import { UnsupportedScreen } from '../src/ui/Unsupported';

const original = game.get();
function memoryStorage() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); values.set(k, v); }, removeItem: (k: string) => void values.delete(k) });
  return { values, writes };
}
afterEach(() => { endTutorial(); endScenario(); game.set(original); vi.unstubAllGlobals(); });

const world = () => new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
const program = { saveId: 'sandbox-1', scene: 'spaceCenter' as const, craft: null, multiplayer: null };

/** Click a button of a rendered element tree by its label (the screen has no hooks, so calling it renders it). */
function click(node: ReactNode, label: string): boolean {
  if (Array.isArray(node)) return node.some(n => click(n, label));
  if (!node || typeof node !== 'object' || !('props' in node)) return false;
  const { props, type } = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (type === 'button' && props.children === label) { props.onClick!(); return true; }
  return click(props.children, label);
}

describe('one session at a time', () => {
  it('starting a lesson ends a challenge in progress, and ending the lesson restores the program', () => {
    memoryStorage();
    game.set(program);
    startScenario('ring-skimmer');
    startLesson('plane');
    expect(getScenarioRun()).toBeNull();
    expect(game.get().session).toBe('training');
    endTutorial();
    expect(game.get()).toMatchObject({ session: 'program', saveId: 'sandbox-1', scene: 'training' });
  });

  it.each(['Main menu', 'Back to Space Center'])('the no-WebGL screen\'s "%s" ends a lesson and a multiplayer room', label => {
    memoryStorage();
    game.set(program);
    startLesson('first-flight');
    expect(click(UnsupportedScreen(), label)).toBe(true);
    expect(getTutorial()).toBeNull();
    expect(game.get()).toMatchObject({ session: 'program', saveId: 'sandbox-1' });

    enterFlight({ join: { url: 'ws://localhost:8787', room: '', name: 'Pilot' } });
    click(UnsupportedScreen(), label);
    expect(game.get().multiplayer).toBeNull();
    expect(game.get().scene).toBe(label === 'Main menu' ? 'menu' : 'spaceCenter');
  });

  it('a new program or a loaded save after an unfinished lesson saves editor drafts again', () => {
    const { values } = memoryStorage();
    startLesson('building');
    startProgram('sandbox', 'standard');
    expect(getTutorial()).toBeNull();
    const craft = buildSoundingRocket();
    game.set({ craft });
    expect(values.get(programCraftKey(game.get().saveId))).toBe(JSON.stringify(craft));

    startScenario('ring-skimmer');
    const slot: SaveSlot = { id: 'sandbox-2:manual', programId: 'sandbox-2', name: 'Two', kind: 'manual', savedAt: 1, data: serializeWorld(world()), craft: null, scene: 'spaceCenter' };
    resumeSave(slot);
    expect(getScenarioRun()).toBeNull();
    game.set({ craft: buildSoundingRocket() });
    expect(values.get(programCraftKey('sandbox-2'))).toBe(JSON.stringify(game.get().craft));
  });

  it('joining a multiplayer room never launches a stale pad craft', () => {
    game.set({ ...program, craft: buildSoundingRocket(), launchPending: true });
    enterFlight({ join: { url: 'ws://localhost:8787', room: 'ABCD', name: 'Pilot' } });
    expect(game.get()).toMatchObject({ scene: 'flight', launchPending: false, multiplayer: { room: 'ABCD' } });
  });
});

describe('Fleet Tracking exits', () => {
  it('Back/Fly saves once; the unmount handoff still saves other exits', () => {
    const { writes } = memoryStorage();
    game.set({ ...program, scene: 'tracking' });
    const w = world();
    w.launch(buildSoundingRocket());
    leaveTracking(w, 'flight');
    persistTracking(w); // the scene unmounts after the switch
    expect(writes.filter(k => k === 'wsp.world.v1.autosave')).toHaveLength(1);
    const other = world();
    persistTracking(other); // e.g. a facility tab in the header
    expect(writes.filter(k => k === 'wsp.world.v1.autosave')).toHaveLength(2);
  });
});
