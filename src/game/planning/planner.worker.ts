import { installEarthData } from '../../sim/terrain/earthData';
import { createPlannerHandler } from './handler';
import type { PlannerMessage } from './protocol';

type EarthMessage = { type: 'earthData'; blob: Blob; buffer?: never } | { type: 'earthData'; buffer: ArrayBufferLike; blob?: never };

const handle = createPlannerHandler(event => self.postMessage(event));
// A Blob grid is read asynchronously; requests (and their cancels, in order) wait for it. A failed read leaves
// the grid missing, which the handler reports per request.
let earthReady: Promise<unknown> = Promise.resolve();
self.onmessage = (event: MessageEvent<PlannerMessage | EarthMessage>) => {
  const data = event.data;
  if (data.type === 'earthData') {
    earthReady = data.blob ? data.blob.arrayBuffer().then(installEarthData).catch(() => {}) : Promise.resolve(installEarthData(data.buffer));
    return;
  }
  void earthReady.then(() => handle(data));
};
