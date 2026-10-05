import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { game } from '../src/game/store';
import { EditorSession } from '../src/editor/session';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { deserializeCraft, serializeCraft } from '../src/editor/core';
import { PART_CATALOG } from '../src/data/parts';
import { activateNextStage, buildVessel, computeStageDeltaV } from '../src/sim/vessel';

const initial = game.get();
beforeEach(() => {
  vi.useFakeTimers();
  game.set({ mode: 'sandbox', scalePreset: 'standard', scene: 'editor', launchPending: false });
});
afterEach(() => {
  game.set(initial);
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('retains stock provenance through rename/save and warns once per design and game scale', () => {
  const stock = STOCK_CRAFTS.find(s => s.id === 'stock-meridian-real')!;
  const craft = deserializeCraft(serializeCraft({ ...stock.build(), name: 'My expedition' }), PART_CATALOG);
  expect(craft.stockId).toBe(stock.id);
  const session = new EditorSession(craft);
  try {
    session.launch();
    expect(game.get().scene).toBe('editor');
    expect(session.getSnapshot().toasts.at(-1)?.text).toContain('designed for real scale; this program uses standard');
    session.launch();
    expect(game.get().scene).toBe('flight');
    game.set({ scene: 'editor' });
    session.load(craft, false);
    session.launch();
    expect(game.get().scene).toBe('flight');
    game.set({ scene: 'editor', scalePreset: 'challenging' });
    session.launch();
    expect(game.get().scene).toBe('editor');
    expect(session.getSnapshot().toasts.at(-1)?.text).toContain('this program uses challenging');
  } finally { session.dispose(); }
});

it('launches immediately at the design scale and does not attribute custom craft by name', () => {
  const stock = STOCK_CRAFTS.find(s => s.id === 'stock-meridian-real')!;
  game.set({ scalePreset: 'real' });
  const session = new EditorSession(stock.build());
  try {
    session.launch();
    expect(game.get().scene).toBe('flight');
    game.set({ scene: 'editor', scalePreset: 'standard' });
    session.load({ ...stock.build(), stockId: undefined }, false);
    session.launch();
    expect(game.get().scene).toBe('flight');
  } finally { session.dispose(); }
});

it('Selene Real clears 1.2 liftoff TWR without burning its core reserve', () => {
  const craft = STOCK_CRAFTS.find(s => s.id === 'stock-selene-real')!.build();
  const vessel = buildVessel(craft, PART_CATALOG);
  const stats = computeStageDeltaV(vessel, 101325, 9.82022);
  expect(stats[0].twrStart).toBeGreaterThanOrEqual(1.2);
  expect(stats.reduce((sum, stage) => sum + stage.dvVac, 0)).toBeGreaterThan(20000);
  activateNextStage(vessel);
  const core = vessel.parts.find(p => p.def.id === 'eng-monsoon' && p.position.x === 0 && p.position.z === 0)!;
  expect(core.engine?.ignited).toBe(false);
  expect(vessel.parts.filter(p => p.def.id === 'srb-thunderclap' && p.engine?.ignited)).toHaveLength(8);
  expect(vessel.parts.filter(p => p.def.id === 'eng-monsoon' && p.engine?.ignited)).toHaveLength(8);
});
