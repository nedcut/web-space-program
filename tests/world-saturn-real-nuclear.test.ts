import { it } from 'vitest';
import { neutralInput } from '../src/sim/vessel';
import { burnEngineDry, launchRingrunnerUpperStages } from './helpers/ringrunner-upper';

// Burn the retained nuclear stage dry in deep space (~275k physics steps, the slowest test in the suite).
// Starts at the interstage separation, as the chemical stage has already been dropped by then; the chemical
// burn is covered by world-saturn-real.test.ts and runs in a parallel worker.
it('Ringrunner Real retains every upper-stage attachment through a complete nuclear burn', () => {
  const { world, vessel } = launchRingrunnerUpperStages(1);
  world.tick(0.02, neutralInput({ stage: true })); // Separate the chemical departure stage.
  burnEngineDry(world, vessel, 'eng-hearth', true);
}, 600_000); // ~50 s unloaded; headroom for concurrent worktree test runs.
