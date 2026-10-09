/** Browser image decoding/cropping, shared by the worker and the compatibility fallback. */
export interface ImageStrip {
  y: number;
  /** Rows in this strip. */
  rows: number;
  /** Cropped bitmap (Chrome, Safari): uploaded by the GPU process from its own copy. */
  bitmap?: ImageBitmap;
  /** Tightly packed rows, `channels` bytes per pixel (Firefox; see `stripsAsPixels`). */
  pixels?: Uint8Array;
}
export interface ImageStrips { width: number; height: number; channels: 1 | 4; strips: ImageStrip[] }

/**
 * Firefox (and forks such as Zen) needs plain pixels. It uploads a cropped ImageBitmap through texSubImage2D from
 * its source's first rows, ignoring the crop, and a bitmap copied through a 2D canvas is backed by the canvas'
 * (possibly GPU) surface, so every upload read it back synchronously: 5–16 ms per 1 MiB strip on Windows Firefox,
 * one strip per frame while imagery streamed. An ArrayBuffer goes to the GPU process as a plain shared-memory copy.
 */
function stripsAsPixels(): boolean {
  return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent) && typeof OffscreenCanvas !== 'undefined';
}

/**
 * Decode `blob` and cut it into strips of at most `stripBytes` uploaded bytes. `channels` is the texture's bytes per
 * pixel: single-channel masks keep only red when uploaded from pixels (a quarter of the bytes).
 */
export async function cutImageStrips(blob: Blob, stripBytes: number, channels: 1 | 4 = 4): Promise<ImageStrips> {
  const full = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const strips: ImageStrip[] = [];
  const pixels = stripsAsPixels();
  try {
    const width = full.width, height = full.height;
    const rows = Math.max(1, Math.min(height, Math.floor(stripBytes / (width * (pixels ? channels : 4)))));
    // A software canvas (willReadFrequently): getImageData must not read back from the GPU either.
    const ctx = pixels ? new OffscreenCanvas(width, rows).getContext('2d', { willReadFrequently: true }) : null;
    if (pixels && !ctx) throw new Error('2D canvas unavailable');
    for (let y = 0; y < height; y += rows) {
      // Yield even on the main-thread fallback: some browsers crop an ImageBitmap synchronously.
      if (y) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const h = Math.min(rows, height - y);
      if (ctx) {
        // Imagery is opaque, so the canvas' premultiplied round trip returns the decoded values unchanged.
        ctx.clearRect(0, 0, width, h);
        ctx.drawImage(full, 0, y, width, h, 0, 0, width, h);
        strips.push({ y, rows: h, pixels: packChannels(ctx.getImageData(0, 0, width, h).data, channels) });
      } else {
        const bitmap = await createImageBitmap(full, 0, y, width, h, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        strips.push({ y, rows: h, bitmap });
      }
    }
    return { width, height, channels, strips };
  } catch (error) {
    for (const strip of strips) strip.bitmap?.close();
    throw error;
  } finally { full.close(); }
}

/** RGBA → `channels` bytes per pixel (red only for single-channel textures). */
export function packChannels(rgba: Uint8ClampedArray, channels: 1 | 4): Uint8Array {
  if (channels === 4) return new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length);
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
  return out;
}

/** Objects to transfer with a strip set (bitmaps and pixel buffers). */
export function stripTransfers(source: ImageStrips): Transferable[] {
  return source.strips.map(s => s.bitmap ?? s.pixels!.buffer as ArrayBuffer);
}
