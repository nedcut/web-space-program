import type * as THREE from 'three';

/**
 * WebGL context loss (GPU switch on a Mac, sleep/wake, memory pressure) frees every GPU object. three.js re-creates
 * what it can derive from CPU data (programs, geometry, textures backed by an image or typed array), but anything
 * whose contents only ever existed on the GPU comes back blank: baked render targets, PMREM environments and
 * textures filled through `copyTextureToTexture`. Owners of such resources subscribe here and rebuild them.
 *
 * Callbacks run from `webglcontextrestored`, after three's own listener (registered in the renderer constructor)
 * has re-initialised its state. They should only reset bookkeeping and queue work: the heavy part belongs to the
 * normal budgeted per-frame paths. Nothing here runs per frame.
 */
const subscribers = new WeakMap<THREE.WebGLRenderer, Set<() => void>>();

/** Call `callback` after each context restore of `renderer`. Returns the unsubscribe function. */
export function onContextRestored(renderer: THREE.WebGLRenderer, callback: () => void): () => void {
  let set = subscribers.get(renderer);
  if (!set) {
    const callbacks = (set = new Set());
    subscribers.set(renderer, set);
    renderer.domElement.addEventListener('webglcontextrestored', () => { for (const cb of [...callbacks]) cb(); });
  }
  set.add(callback);
  return () => { set.delete(callback); };
}

/**
 * Subscription to whichever renderer is seen first in a material callback (`onBeforeRender`), for owners that never
 * receive the renderer directly. Re-attaching the same renderer is a reference comparison.
 */
export class RestoreHook {
  private renderer: THREE.WebGLRenderer | null = null;
  private off: (() => void) | null = null;
  constructor(private readonly callback: () => void) {}

  attach(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.off?.();
    this.renderer = renderer;
    this.off = onContextRestored(renderer, this.callback);
  }

  dispose(): void {
    this.off?.();
    this.off = this.renderer = null;
  }
}

/** True while the renderer's context is lost (GPU work is silently dropped, so progress must not be counted). */
export function contextIsLost(renderer: THREE.WebGLRenderer): boolean {
  return renderer.getContext().isContextLost();
}
