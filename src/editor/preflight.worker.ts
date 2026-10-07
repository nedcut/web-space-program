import { PART_CATALOG } from '../data/parts';
import { preflightChecks } from './checks';
import type { CraftDef } from '../sim/vessel/types';
import type { StageStats } from './ui/dv';
self.onmessage = (event: MessageEvent<{ craft: CraftDef; first?: StageStats }>) => {
  self.postMessage(preflightChecks(event.data.craft, PART_CATALOG, event.data.first));
};
