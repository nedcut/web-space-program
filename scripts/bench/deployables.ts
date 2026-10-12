import '../earth-data/register';
/**
 * Physics-step cost on ascent for stock craft carrying retractable arrays/antennas (op/panels before/after).
 * Run with `npx tsx scripts/bench/deployables.ts`. Times World.tick for 30 simulated seconds after launch.
 */
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { buildRelayLauncher, buildTender, buildOrbiter } from '../../src/editor/stockCrafts';
import { neutralInput } from '../../src/sim/vessel';
import { DEFAULT_START_UT } from '../../src/game/store';

const crafts = { orbiter: buildOrbiter, relay: buildRelayLauncher, tender: buildTender };
for (const [name, build] of Object.entries(crafts)) {
  const runs: number[] = [];
  for (let r = 0; r < 7; r++) {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    w.launch(build());
    w.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist', stage: true }));
    for (let i = 0; i < 100; i++) w.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
    const start = performance.now();
    for (let i = 0; i < 1500; i++) w.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
    runs.push((performance.now() - start) / 1500 * 1000);
  }
  runs.sort((a, b) => a - b);
  console.log(`${name}: median ${runs[3].toFixed(1)} µs/step (min ${runs[0].toFixed(1)}, max ${runs[6].toFixed(1)})`);
}
