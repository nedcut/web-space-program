import { installEarthData } from '../sim/terrain/earthData';
import { createTerrain } from '../sim/terrain';
import { buildBiomeMap } from '../sim/science/biomeMap';
import type { BiomeMapRequest, BiomeMapWorkerMessage } from './biomeMaps';

// The grid arrives first; requests wait for it (Earth's classifier samples it).
let earthReady: Promise<unknown> = Promise.resolve();
self.onmessage = (event: MessageEvent<BiomeMapWorkerMessage>) => {
  const data = event.data;
  if (data.type === 'earthData') {
    earthReady = data.blob ? data.blob.arrayBuffer().then(installEarthData).catch(() => {}) : Promise.resolve(installEarthData(data.buffer));
    return;
  }
  void earthReady.then(() => {
    const request: BiomeMapRequest = data;
    try {
      const map = buildBiomeMap(request.body, createTerrain(request.body));
      self.postMessage({ type: 'result', key: request.key, map }, { transfer: [map.cells.buffer] });
    } catch (e) {
      self.postMessage({ type: 'error', key: request.key, message: e instanceof Error ? e.message : String(e) });
    }
  });
};
