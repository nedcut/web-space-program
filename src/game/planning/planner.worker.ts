import { installEarthData } from '../../sim/terrain/earthData';
import { createPlannerHandler } from './handler';
import type { PlannerMessage } from './protocol';

const handle = createPlannerHandler(event => self.postMessage(event));
self.onmessage = (event: MessageEvent<PlannerMessage | { type: 'earthData'; buffer: ArrayBufferLike }>) => {
  if (event.data.type === 'earthData') { installEarthData(event.data.buffer); return; }
  void handle(event.data);
};
