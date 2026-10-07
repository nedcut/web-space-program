import type * as THREE from 'three';

/**
 * Full WebGLRenderer teardown for scene changes (flight, editor, Space Center, navball).
 *
 * three r186 registers a per-renderer `dispose` listener on every material, geometry and texture a renderer
 * draws, and keeps per-renderer GPU state for them in WeakMaps keyed by those objects. `renderer.dispose()`
 * removes neither. Objects that outlive the scene — the module-level DFG lookup texture shared by all standard
 * materials, the part material/template caches — therefore kept every renderer ever created reachable, with its
 * canvas, (lost) WebGL context and, through DOM listeners, whole scenes, Worlds and HUDs. Measured before this
 * fix: +1.9 MB heap, +1,100 DOM nodes and +560 listeners per menu→flight→map→editor→flight cycle.
 *
 * `releaseRenderer` finds the renderer's own listener functions (the one present on every object it drew) and
 * detaches them from everything reachable from its scene, then disposes the renderer and frees its context. The
 * shared DFG LUT is disposed outright: renderers that are still alive re-upload the 16×16 table on next use.
 */
let dfgLut: THREE.Texture | null = null;

type Dispatcher = THREE.EventDispatcher<{ dispose: object }> & { _listeners?: Record<string, ((e: unknown) => void)[]> };

/** Remember the shared DFG LUT from any material this renderer has drawn (call before disposing materials). */
export function noteDfgLut(renderer: THREE.WebGLRenderer, root?: THREE.Object3D | null): void {
  if (dfgLut || !root) return;
  root.traverse((o) => {
    if (dfgLut) return;
    for (const mat of materialsOf(o)) {
      const uniforms = (renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
      const v = uniforms?.dfgLUT?.value as THREE.Texture | undefined;
      if (v?.isTexture) { dfgLut = v; return; }
    }
  });
}

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material;
  return Array.isArray(m) ? m : m ? [m] : [];
}

/** Materials, geometries and textures reachable from `root` (including material texture uniforms/maps). */
function collect(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>(), geos = new Set<THREE.BufferGeometry>(), texs = new Set<THREE.Texture>();
  const tex = (v: unknown) => { if (v && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture); };
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g?.isBufferGeometry) geos.add(g);
    for (const m of materialsOf(o)) {
      mats.add(m);
      for (const v of Object.values(m)) tex(v);
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u) for (const k in u) tex(u[k]?.value);
    }
  });
  return { mats, geos, texs };
}

/**
 * The renderer's own dispose listener for one kind of object: present on (nearly) every object it drew, so it is
 * the most frequent listener. Only a strict winner is trusted; a tie (two renderers drew exactly the same shared
 * set) leaves the listeners alone.
 */
function ownListener(objs: Iterable<Dispatcher>): ((e: unknown) => void) | null {
  const counts = new Map<(e: unknown) => void, number>();
  for (const o of objs) for (const f of o._listeners?.dispose ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  let best: ((e: unknown) => void) | null = null, n = 0, second = 0;
  for (const [f, c] of counts) { if (c > n) { second = n; n = c; best = f; } else if (c > second) second = c; }
  return n > second ? best : null;
}

function detach(objs: Set<Dispatcher>) {
  const f = ownListener(objs);
  if (f) for (const o of objs) o.removeEventListener('dispose', f);
}

/** Dispose a renderer, detach it from shared resources and free its WebGL context immediately. */
export function releaseRenderer(renderer: THREE.WebGLRenderer, root?: THREE.Object3D | null): void {
  noteDfgLut(renderer, root);
  if (root) detachRenderer(root);
  finishRenderer(renderer);
}

/**
 * Last step of a teardown whose scenes were already detached (`noteDfgLut` + `detachRenderer` before their
 * contents were disposed): dispose the renderer, drop the shared DFG LUT and free the context now.
 */
export function finishRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  releaseSharedTextures();
  renderer.forceContextLoss();
}

/** Remove the scene's renderer listeners from shared materials/geometries/textures (call before disposal). */
export function detachRenderer(root: THREE.Object3D): void {
  const { mats, geos, texs } = collect(root);
  detach(mats as Set<unknown> as Set<Dispatcher>);
  detach(geos as Set<unknown> as Set<Dispatcher>);
  detach(texs as Set<unknown> as Set<Dispatcher>);
}

/** Drop every renderer's hold on the shared DFG LUT (after `renderer.dispose()`). */
export function releaseSharedTextures(): void {
  dfgLut?.dispose();
}
