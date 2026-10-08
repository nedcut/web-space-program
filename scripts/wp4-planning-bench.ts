// node --import tsx --import ./scripts/earth-data/register.ts scripts/wp4-planning-bench.ts
// Isolates the steady clock path; no browser/GPU or trajectory search is involved.
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
world.launch(buildOrbiter());
world.addNode(world.ut + 1000).prograde = 100;
for (let i = 0; i < 199; i++) world.alarmClock.add(world.activeId!, 'Reminder', world.ut + 10000 + i);
world.alarmClock.sync(world);
for (let i = 0; i < 10000; i++) { world.alarmClock.sync(world); world.alarmClock.fire(world); }
const count = 1000000, start = performance.now();
for (let i = 0; i < count; i++) { world.alarmClock.sync(world); world.alarmClock.fire(world); }
console.log(JSON.stringify({ clockSyncAndFireMs: (performance.now() - start) / count, alarms: world.alarmClock.alarms.length, nodes: world.nodes.length, iterations: count }));
