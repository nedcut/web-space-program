import * as THREE from 'three';
import type { TerrainWorkerPool } from './workerPool';
import { makeReleasable } from '../texturePixels';

interface Entry {
  refs: number;
  promise: Promise<{ texture: THREE.DataTexture; minHeight: number; maxHeight: number }>;
}
const pools = new WeakMap<TerrainWorkerPool, Map<string, Entry>>();

/** Reference-counted textures and in-flight bakes shared by flight, map and portraits. */
export function acquireSurfaceBake(pool: TerrainWorkerPool, terrainKey: string, width: number) {
  let cache = pools.get(pool);
  if (!cache) { cache = new Map(); pools.set(pool, cache); }
  const key = `${terrainKey}:${width}`;
  let entry = cache.get(key);
  if (!entry) {
    const promise = pool.bake(terrainKey, width).then(res => {
      const texture = new THREE.DataTexture(res.data, res.width, res.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      // Owners drop the pixels once uploaded (releasePixels); a later upload re-bakes them in a worker.
      makeReleasable(texture, () => pool.bake(terrainKey, width).then((r) => r.data));
      return { texture, minHeight: res.minHeight, maxHeight: res.maxHeight };
    });
    entry = { refs: 0, promise }; cache.set(key, entry);
  }
  entry.refs++;
  const owned = entry;
  let released = false;
  return { promise: entry.promise, release() {
    if (released) return;
    released = true;
    if (--owned.refs === 0) {
      cache!.delete(key);
      void owned.promise.then(res => res.texture.dispose(), () => {});
    }
  } };
}
