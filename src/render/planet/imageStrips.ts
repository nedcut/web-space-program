/** Browser image decoding/cropping, shared by the worker and the compatibility fallback. */
export interface ImageStrips { width: number; height: number; strips: { y: number; bitmap: ImageBitmap }[] }
export async function cutImageStrips(blob: Blob, stripBytes: number): Promise<ImageStrips> {
  const full = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const strips: ImageStrips['strips'] = [];
  try {
    const width = full.width, height = full.height;
    const rows = Math.max(1, Math.min(height, Math.floor(stripBytes / (width * 4))));
    for (let y = 0; y < height; y += rows) {
      // Yield even on the main-thread fallback: some browsers crop an ImageBitmap synchronously.
      if (y) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const bitmap = await createImageBitmap(full, 0, y, width, Math.min(rows, height - y), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      strips.push({ y, bitmap });
    }
    return { width, height, strips };
  } catch (error) {
    for (const strip of strips) strip.bitmap.close();
    throw error;
  } finally { full.close(); }
}
