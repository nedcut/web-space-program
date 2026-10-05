import { useSyncExternalStore } from 'react';
import { game, DEFAULT_START_UT, type GameState } from '../game/store';
import { World } from '../game/world';
import { Universe } from '../game/universe';
import { serializeWorld } from '../game/persistence';
import { PART_CATALOG } from '../data/parts';
import { LESSONS, type Lesson, type TutorialContext } from './lessons';

export const COMPLETION_KEY = 'wsp.training.v1';
export function readCompletions(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COMPLETION_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && LESSONS.some(l => l.id === id)) : [];
  } catch { return []; }
}
export function saveCompletion(id: string) {
  try { localStorage.setItem(COMPLETION_KEY, JSON.stringify([...new Set([...readCompletions(), id])])); } catch { /* optional storage */ }
}
export interface TutorialRun { lesson: Lesson; index: number; ready: boolean; skipped: boolean; finished: boolean; epoch: number }
let run: TutorialRun | null = null;
let prior: GameState | null = null;
let epoch = 0;
const listeners = new Set<() => void>();
export const tutorialContext: TutorialContext = {};
const emit = () => listeners.forEach(l => l());
export function getTutorial() { return run; }
export function useTutorial() { return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, getTutorial); }
export function startLesson(id: string) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) throw new Error(`Unknown lesson: ${id}`);
  if (!prior) prior = game.get();
  const craft = lesson.craft();
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  if (craft && lesson.scene === 'flight') { world.launch(craft); lesson.setup?.(world); }
  delete tutorialContext.world; delete tutorialContext.flight; delete tutorialContext.editor;
  run = { lesson, index: 0, ready: false, skipped: false, finished: false, epoch: ++epoch };
  game.set({ trainingActive: true, notice: null, saveId: null, scene: lesson.scene, craft, mode: 'sandbox', scalePreset: 'standard', ut: DEFAULT_START_UT, resumeWorld: craft && lesson.scene === 'flight' ? serializeWorld(world) : null, launchPending: false });
  emit();
}
/** Called once per animation frame; React only receives changes in tutorial status. */
export function tickTutorial(context = tutorialContext) {
  if (!run || run.ready || run.finished) return;
  if (run.lesson.steps[run.index].complete(context)) { run = { ...run, ready: true }; emit(); }
}
export function advanceTutorial(skip = false) {
  if (!run || run.finished || (!skip && !run.ready)) return;
  const skipped = run.skipped || skip;
  if (run.index === run.lesson.steps.length - 1) {
    if (!skipped) saveCompletion(run.lesson.id);
    run = { ...run, skipped, finished: true };
  } else run = { ...run, index: run.index + 1, ready: false, skipped };
  emit();
}
export function endTutorial() {
  run = null;
  delete tutorialContext.world; delete tutorialContext.flight; delete tutorialContext.editor;
  if (prior) game.set({ ...prior, settings: game.get().settings, scene: 'training' });
  prior = null;
  emit();
}
