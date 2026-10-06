import type { TerrainHeightFn } from '../../sim/terrain/api';

/** Low-frequency geography for the one-time cloud bake; rows run south to north. */
export function cloudLandMask(heightAt: TerrainHeightFn, width = 128, height = 64): Uint8Array {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const lat = ((y + 0.5) / height - 0.5) * Math.PI;
    const cos = Math.cos(lat), z = Math.sin(lat);
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      data[y * width + x] = heightAt(cos * Math.cos(lon), cos * Math.sin(lon), z) > 0 ? 255 : 0;
    }
  }
  return data;
}
