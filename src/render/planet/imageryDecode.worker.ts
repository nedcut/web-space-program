import { cutImageStrips } from './imageStrips';
self.onmessage = async (event: MessageEvent<{ id: number; blob: Blob; stripBytes: number } | { type: 'release'; bitmaps: ImageBitmap[] }>) => {
  if ('type' in event.data) { for (const bitmap of event.data.bitmaps) bitmap.close(); return; }
  const { id, blob, stripBytes } = event.data;
  try {
    const result = await cutImageStrips(blob, stripBytes);
    self.postMessage({ id, result }, { transfer: result.strips.map(s => s.bitmap) });
  } catch (error) { self.postMessage({ id, error: String(error) }); }
};
