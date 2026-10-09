import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { length } from '../src/util/vec3';
import { neutralInput } from '../src/sim/vessel';

describe('targeting the body you orbit', () => {
  it('accepts the parent body and gives finite readouts', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
    placeInCircularOrbit(world, wv, 'moon', 30000);
    expect(world.setTarget('moon')).toBe(true);
    expect(world.targetKind()).toBe('body');
    const rel = world.targetRelativeState('moon', world.ut)!;
    expect(length(rel.position)).toBe(0);
    expect(world.closestApproach()).toBeNull();
    for (let i = 0; i < 60; i++) world.tick(1 / 60, neutralInput());
    expect(world.targetId).toBe('moon');
  });
});
