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
Date.now = () => 1_700_000_000_000; // World IDs use wall clock; fix it for cross-process traces.
for (const id of ['stock-kestrel', 'stock-selene']) for (const mode of ['pad', 'atmosphere', 'vacuum', 'landed', 'rails']) {
 const w=new World(new Universe('standard'),PART_CATALOG,DEFAULT_START_UT);w.launch(STOCK_CRAFTS.find(c=>c.id===id)!.build());
 if(mode==='landed') placeOnSurface(w,w.active!,'moon');
 else if(mode!=='pad') placeInCircularOrbit(w,w.active!,'earth',mode==='atmosphere'?15000:2e6);
 if(mode==='rails')w.warp={mode:'rails',index:8};
 const hash=createHash('sha256');
 for(let i=0;i<100;i++) {w.tick(.02,neutralInput({throttle:mode==='pad'?1:0,stage:mode==='pad'&&i===0}));hash.update(JSON.stringify(serializeWorld(w)));}
 console.log(`${id}/${mode} ${hash.digest('hex')}`);
}
