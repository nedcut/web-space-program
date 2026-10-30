import { expect, it } from 'vitest';
import { generate, replay } from '../scripts/fuzz/core';
it('fixed randomized flights preserve invariants and replay deterministically', () => {
  for (const seed of [1, 2, 4, 7, 11, 18]) {
    const actions = generate(seed, 30);
    expect(replay(seed, actions), `seed=${seed}`).toBe(replay(seed, actions));
  }
}, 45000);
