import { useSyncExternalStore } from 'react';
import { game, beginPractice, endSession } from '../game/store';
import { serializeWorld } from '../game/persistence';
import type { World } from '../game/world';
import { SCENARIOS, setupScenario, type Setup, type Scenario } from './catalog';
import { evaluateMission, initialMission, observeWorld, scoreMission, type MissionState, type Result } from './evaluation';
import { saveBest } from './records';
export interface ScenarioRun { scenario: Scenario; setup: Setup; state: MissionState; epoch: number; originalParts: number; result?: Result; personalBest: boolean }
let run: ScenarioRun | null = null, epoch = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
// The store owns the session: whatever ends it (a lesson, a new program, any exit) ends the challenge too.
game.subscribe(() => { if (run && game.get().session !== 'scenario') { run = null; emit(); } });
export function getScenarioRun() { return run; }
export function useScenarioRun() { return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, getScenarioRun); }
export function startScenario(id: string) {
  const scenario = SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error(`Unknown mission: ${id}`);
  const setup = setupScenario(scenario);
  const state = initialMission(setup.world.ut), originalParts = setup.world.active!.state.parts.length;
  state.previous = observeWorld(setup, originalParts);
  state.visited = [state.previous.body];
  run = { scenario, setup, state, epoch: ++epoch, originalParts, personalBest: false };
  beginPractice('scenario', { mode: 'sandbox', scalePreset: 'standard', ut: setup.world.ut, craft: setup.craft, resumeWorld: serializeWorld(setup.world), scene: 'flight' });
  emit();
}
/** Bind to the mounted flight World (including a graphics-settings reconstruction). */
export function attachScenarioWorld(world: World, pause: () => void): () => void {
  if (!run) return () => {};
  run.setup.world = world;
  let lastEmit = world.ut;
  const observer = (dt: number, dv: number) => {
    if (!run || run.setup.world !== world || run.state.status !== 'flying') return;
    const state = evaluateMission(run.scenario.id, run.state, observeWorld(run.setup, run.originalParts), dt, dv);
    run = { ...run, state };
    if (state.status !== 'flying') {
      const result = scoreMission(run.scenario, state);
      run = { ...run, result, personalBest: saveBest(run.scenario.id, result) };
      pause(); emit();
    } else if (world.ut - lastEmit >= 0.25) { lastEmit = world.ut; emit(); }
  };
  world.onSimulationStep = observer;
  if (run.result) pause();
  return () => { if (world.onSimulationStep === observer) world.onSimulationStep = null; };
}
/** Leave the challenge for the Challenges menu, restoring the program it interrupted. */
export function endScenario() {
  if (game.get().session === 'scenario') endSession('scenarios');
  else if (run) { run = null; emit(); }
}
