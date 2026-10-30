import { expect, it } from 'vitest';
import { invariant, random, replay, Failure, shrink } from '../scripts/fuzz/core';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildTender } from '../src/editor/stockCrafts';

it('detects corrupted state instead of hashing NaN as JSON null', () => {
  const w = new World(new Universe('standard'), PART_CATALOG, 0);
  w.launch(buildTender());
  w.active!.state.position.x = NaN;
  expect(() => invariant(w)).toThrow('finite');
  w.active!.state.position.x = 0;
  const p = w.active!.state.parts[0];
  p.parent = p.uid;
  expect(() => invariant(w)).toThrow(/part-(tree|root)/);
});

it('restores the identity clock even after a failing replay', () => {
  const now = Date.now;
  const actions = [{ kind: 'node' as const, value: NaN }];
  let failure: Failure | undefined;
  try { replay(1, actions); } catch (e) { if (e instanceof Failure) failure = e; else throw e; }
  expect(failure).toBeInstanceOf(Failure);
  expect(Date.now).toBe(now);
  const shortened = shrink(failure!, 3);
  expect(() => replay(1, shortened)).toThrow('finite');
  expect(Date.now).toBe(now);
});

it('uses reproducible independent PRNG streams including seed zero', () => {
  for (const seed of [0, 1, 0xffffffff]) {
    const a = random(seed), b = random(seed);
    expect(Array.from({ length: 50 }, a)).toEqual(Array.from({ length: 50 }, b));
  }
});

it('actually exercises coasting rails and both warp transitions', async () => {
  const { neutralInput } = await import('../src/sim/vessel');
  const stats = { frames: 0, railsChecks: 0, saves: 0, evas: 0, docks: 0, nodes: 0, targets: 0, maxRelativeEnergyError: 0, maxWarpJump: 0 };
  replay(1, [
    { kind: 'warp', mode: 'rails', index: 3 },
    { kind: 'fly', frames: 10, input: neutralInput() },
    { kind: 'warp', mode: 'physics', index: 0 },
    { kind: 'fly', frames: 10, input: neutralInput() },
  ], stats);
  expect(stats.railsChecks).toBe(10);
});

it('accepts documented body-fixed reconstruction noise after EVA on the pad', () => {
  expect(() => replay(288510278, [
    { kind: 'eva', value: 0 },
    { kind: 'save', value: 0 },
  ])).not.toThrow();
});
