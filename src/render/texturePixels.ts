import type * as THREE from 'three';

/**
 * Dropping the CPU pixels of uploaded DataTextures. Once a renderer holds a texture on the GPU, three never reads
 * `image.data` again unless the source must be uploaded anew: another renderer, a restored WebGL context, or a
 * texture object with different sampler parameters. Dropped pixels leave `source.dataReady` false, so such an
 * upload only allocates the (empty) GPU texture and calls `onUpdate`; `restore` then refills the pixels
 * asynchronously and re-uploads. Owners release only what their own renderer has uploaded.
 */

type Pixels = THREE.TypedArray;
interface Releasable { restore: () => Promise<Pixels | null>; restoring: boolean }
const releasable = new WeakMap<THREE.Texture["source"], Releasable>();

/** True when `renderer` holds the current version of `texture`'s pixels on the GPU. */
export function uploadedOn(renderer: THREE.WebGLRenderer, texture: THREE.Texture): boolean {
  const p = renderer.properties.get(texture.source) as { __version?: number };
  return p.__version === texture.source.version;
}

/**
 * Let `texture` (and every texture object sharing its source; pass them here or through `watchPixels`) refill
 * dropped pixels with `restore`. A null result leaves the texture empty.
 */
export function makeReleasable(texture: THREE.Texture, restore: () => Promise<Pixels | null>): void {
  releasable.set(texture.source, { restore, restoring: false });
  watchPixels(texture);
}

/** Watch another texture object that shares a releasable source (e.g. a clone with a different repeat). */
export function watchPixels(texture: THREE.Texture): void {
  texture.onUpdate = onUpdate;
}

function onUpdate(texture: THREE.Texture): void {
  const source = texture.source;
  if (source.dataReady) return;
  const r = releasable.get(source);
  if (!r || r.restoring) return;
  r.restoring = true;
  r.restore().then((pixels) => {
    r.restoring = false;
    if (!pixels || source.dataReady) return;
    (source.data as { data: Pixels | null }).data = pixels;
    source.dataReady = true;
    texture.needsUpdate = true;
  }, () => { r.restoring = false; });
}

/** Drop the CPU pixels if `renderer` already holds them. Returns the bytes freed. */
export function releasePixels(texture: THREE.Texture, renderer: THREE.WebGLRenderer): number {
  const source = texture.source;
  const image = source.data as { data?: Pixels | null } | null;
  if (!image?.data || !source.dataReady || !releasable.has(source) || !uploadedOn(renderer, texture)) return 0;
  const bytes = image.data.byteLength;
  image.data = null;
  source.dataReady = false;
  return bytes;
}
