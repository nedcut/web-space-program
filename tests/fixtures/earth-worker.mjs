// Run the actual browser terrain-worker module in a separate Node isolate with a tiny host shim.
import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';
register();
globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
await import('../../src/render/planet/chunkWorker.ts');
const { createTerrain } = await import('../../src/sim/terrain/index.ts');
parentPort.on('message', data => {
  if (data.type === 'probe') {
    const terrain = createTerrain(data.body);
    parentPort.postMessage({ id: data.id, values: data.points.map(p => terrain.heightAt(...p)) });
  } else globalThis.self.onmessage({ data });
});
