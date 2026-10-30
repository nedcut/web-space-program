import '../earth-data/register';
/** Stable trace hashes for comparison against the parent commit; no renderer or wall clock. */
import { createHash } from 'node:crypto';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { DEFAULT_START_UT } from '../../src/game/store';
import { PART_CATALOG } from '../../src/data/parts';
import { STOCK_CRAFTS } from '../../src/editor/stockCrafts';
import { placeInCircularOrbit, placeOnSurface } from '../../src/game/scenarios';
import { neutralInput } from '../../src/sim/vessel';
import { serializeWorld } from '../../src/game/persistence';

export const TRACE_MODES = ['pad', 'atmosphere', 'vacuum', 'landed', 'rails'] as const;

/** Caller fixes Date.now (World IDs) so this is comparable across independent worlds/processes. */
export function traceHash(id: string, mode: typeof TRACE_MODES[number], ticks = 100): string {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  w.launch(STOCK_CRAFTS.find(c => c.id === id)!.build());
  if (mode === 'landed') placeOnSurface(w, w.active!, 'moon');
  else if (mode !== 'pad') placeInCircularOrbit(w, w.active!, 'earth', mode === 'atmosphere' ? 15000 : 2e6);
  if (mode === 'rails') w.warp = { mode: 'rails', index: 8 };
  const hash = createHash('sha256');
  for (let i = 0; i < ticks; i++) {
    w.tick(0.02, neutralInput({ throttle: mode === 'pad' ? 1 : 0, stage: mode === 'pad' && i === 0 }));
    hash.update(JSON.stringify(serializeWorld(w)));
  }
  return hash.digest('hex');
}

if (process.argv[1]?.endsWith('determinism.ts')) {
  Date.now = () => 1_700_000_000_000;
  for (const id of ['stock-kestrel', 'stock-selene']) for (const mode of TRACE_MODES)
    console.log(`${id}/${mode} ${traceHash(id, mode)}`);
}
