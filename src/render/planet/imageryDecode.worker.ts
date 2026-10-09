import { cutImageStrips, stripTransfers } from './imageStrips';
self.onmessage = async (event: MessageEvent<{ id: number; blob: Blob; stripBytes: number; channels: 1 | 4 } | { type: 'release'; bitmaps: ImageBitmap[] }>) => {
  if ('type' in event.data) { for (const bitmap of event.data.bitmaps) bitmap.close(); return; }
  const { id, blob, stripBytes, channels } = event.data;
  try {
    const result = await cutImageStrips(blob, stripBytes, channels);
    self.postMessage({ id, result }, { transfer: stripTransfers(result) });
  } catch (error) { self.postMessage({ id, error: String(error) }); }
};
