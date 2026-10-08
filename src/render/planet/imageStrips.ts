/** Browser image decoding/cropping, shared by the worker and the compatibility fallback. */
export interface ImageStrips { width: number; height: number; strips: { y: number; bitmap: ImageBitmap }[] }

/**
 * Firefox (and forks such as Zen) uploads a cropped ImageBitmap through texSubImage2D from its source's first rows,
 * ignoring the crop, so every strip would repeat the polar rows. A 2D-canvas copy owns its pixels and uploads correctly.
 */
function cropsNeedCopy(): boolean {
  return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent) && typeof OffscreenCanvas !== 'undefined';
}
function ownPixels(bitmap: ImageBitmap): ImageBitmap {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.transferToImageBitmap();
}

export async function cutImageStrips(blob: Blob, stripBytes: number): Promise<ImageStrips> {
  const full = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const strips: ImageStrips['strips'] = [];
  const copy = cropsNeedCopy();
  try {
    const width = full.width, height = full.height;
    const rows = Math.max(1, Math.min(height, Math.floor(stripBytes / (width * 4))));
    for (let y = 0; y < height; y += rows) {
      // Yield even on the main-thread fallback: some browsers crop an ImageBitmap synchronously.
      if (y) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const bitmap = await createImageBitmap(full, 0, y, width, Math.min(rows, height - y), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      strips.push({ y, bitmap: copy ? ownPixels(bitmap) : bitmap });
    }
    return { width, height, strips };
  } catch (error) {
    for (const strip of strips) strip.bitmap.close();
    throw error;
  } finally { full.close(); }
}
