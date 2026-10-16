import { PART_CATALOG } from '../data/parts';
import { preflightChecks } from './checks';
import type { CraftDef } from '../sim/vessel/types';
import type { StageStats } from './ui/dv';
import type { HomeAir } from './descent';
self.onmessage = (event: MessageEvent<{ craft: CraftDef; first?: StageStats; home?: HomeAir }>) => {
  self.postMessage(preflightChecks(event.data.craft, PART_CATALOG, event.data.first, event.data.home));
};
