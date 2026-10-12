import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/tutorial/lessons';
import { LESSON_MINUTES, recommendedLesson } from '../src/tutorial/trainingProgress';
import { TECH_NODES } from '../src/data/technology';
import { defaultTechSelection } from '../src/ui/researchView';
import { contractCounts, visibleContracts } from '../src/ui/missionsView';
import { game } from '../src/game/store';
import { previousScene } from '../src/ui/nav/sceneHistory';

describe('Training progress', () => {
  it('recommends the first lesson not completed, in course order', () => {
    expect(recommendedLesson(LESSONS, [])?.id).toBe(LESSONS[0].id);
    expect(recommendedLesson(LESSONS, [LESSONS[0].id, LESSONS[2].id])?.id).toBe(LESSONS[1].id);
    expect(recommendedLesson(LESSONS, LESSONS.map(l => l.id))).toBeNull();
  });
  it('has a time estimate for every lesson', () => {
    for (const l of LESSONS) expect(LESSON_MINUTES[l.id], l.id).toBeGreaterThan(0);
  });
});

describe('Research Lab default selection', () => {
  it('opens on an affordable ready node, else a ready one, else the root', () => {
    const only = (ids: string[]) => (id: string) => ids.includes(id);
    const ready = TECH_NODES.filter(n => n.requires.length && n.requires.every(r => r === 'foundation'));
    const cheapest = Math.min(...ready.map(n => n.cost));
    expect(defaultTechSelection(TECH_NODES, only(['foundation']), cheapest)).toBe(ready.find(n => n.cost <= cheapest)!.id);
    expect(defaultTechSelection(TECH_NODES, only(['foundation']), 0)).toBe(ready[0].id);
    expect(defaultTechSelection(TECH_NODES, () => true, 1e9)).toBe(TECH_NODES[0].id);
  });
});

describe('Mission Control filters', () => {
  const contracts = [{ status: 'completed' }, { status: 'offered' }, { status: 'failed' }, { status: 'active' }, { status: 'offered' }] as const;
  it('shows open work first, active before offered', () => {
    expect(visibleContracts(contracts, 'open').map(c => c.status)).toEqual(['active', 'offered', 'offered']);
    expect(visibleContracts(contracts, 'all').map(c => c.status)).toEqual(['active', 'offered', 'offered', 'completed', 'failed']);
    expect(visibleContracts(contracts, 'completed')).toHaveLength(1);
  });
  it('counts each filter', () => {
    expect(contractCounts(contracts)).toEqual({ open: 3, all: 5, active: 1, offered: 2, completed: 1, failed: 1 });
  });
});

describe('scene history', () => {
  it('remembers the scene before the current one', () => {
    game.set({ scene: 'flight' });
    game.set({ scene: 'flightlog' });
    expect(previousScene()).toBe('flight');
    game.set({ notice: 'unrelated change' });
    expect(previousScene()).toBe('flight');
    game.set({ scene: 'research' });
    expect(previousScene()).toBe('flightlog');
  });
});
