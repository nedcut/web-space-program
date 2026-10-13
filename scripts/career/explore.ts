import '../earth-data/register';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG, PART_DEFS } from '../../src/data/parts';
import { TECH_NODES } from '../../src/data/technology';
import { DEFAULT_START_UT } from '../../src/game/store';
for (const preset of ['standard', 'challenging', 'real'] as const) {
  const w = new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT, 'career');
  console.log(preset, 'funds', w.progression.funds, 'contracts', w.progression.contracts.map(c => `${c.title} adv ${c.advance} rew ${c.reward}`));
}
for (const n of TECH_NODES) console.log(n.id, n.name, n.cost, n.parts.map(id => PART_CATALOG.get(id)?.name + `(${id})`).join(', '));
void PART_DEFS;
