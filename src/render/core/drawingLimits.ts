import type * as THREE from 'three';

const edges = new WeakMap<THREE.WebGLRenderer, number>();

/**
 * Largest drawing-buffer edge this context can render to. Composer/MSAA targets are renderbuffers and
 * textures, so the smallest of those limits applies. Usually 8–16k; Firefox's resistFingerprinting reports
 * WebGL 2's 2048 minimum (with a spoofed devicePixelRatio of 2), and 6K displays can exceed 4096-px GPUs.
 */
export function maxDrawingEdge(renderer: THREE.WebGLRenderer): number {
  let edge = edges.get(renderer);
  if (edge === undefined) {
    try {
      const gl = renderer.getContext();
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
      edge = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), viewport?.[0] ?? Infinity, viewport?.[1] ?? Infinity);
    } catch { edge = Infinity; }
    if (!(edge > 0)) edge = Infinity;
    edges.set(renderer, edge);
  }
  return edge;
}

/** Lower a pixel ratio until a `width`×`height` CSS-px canvas fits within `maxEdge` device pixels. */
export function clampPixelRatio(pixelRatio: number, width: number, height: number, maxEdge: number): number {
  return Math.min(pixelRatio, maxEdge / Math.max(1, width, height));
}
