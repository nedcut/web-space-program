import { expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { applyDeltas, vesselDeltas } from '../src/net/snapshots';

it('saves partial overload exposure and clears recovered fatigue across the JSON wire', () => {
  const server = new World(new Universe('standard'), PART_CATALOG, 0);
  server.launch(STOCK_CRAFTS.find(c => c.id === 'stock-kestrel')!.build());
  const part = server.active!.state.parts.find(p => p.parent !== null)!;
  part.structuralFatigue = .04;
  const client = deserializeWorld(serializeWorld(server), PART_CATALOG);
  const replica = client.active!.state.cache.byUid.get(part.uid)!;
  expect(replica.structuralFatigue).toBe(.04);
  part.structuralFatigue = .06;
  applyDeltas(client, server.ut, JSON.parse(JSON.stringify(vesselDeltas(server))));
  expect(replica.structuralFatigue).toBe(.06);
  delete part.structuralFatigue;
  applyDeltas(client, server.ut, JSON.parse(JSON.stringify(vesselDeltas(server))));
  expect(replica.structuralFatigue).toBeUndefined();
});
