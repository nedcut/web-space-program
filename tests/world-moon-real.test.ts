import { it } from 'vitest';
import { flyMoonMission } from './helpers/moon-mission';

// Separate files per preset so the two long missions run in parallel workers.
it('real: lands on the Moon, ascends and returns safely to Earth', () => flyMoonMission('real'), 600_000); // Long mission with structural checks; allow concurrent worktree test runs.
