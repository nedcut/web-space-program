import { releaseRenderer } from '../../render/releaseRenderer';
import { enqueueIdle, waitForInputQuiet } from '../../util/idleQueue';
import * as THREE from 'three';
import { cachedThumbnail, persistThumbnail, preloadThumbnails } from './thumbnailCache';
import { StudioEnvironment } from '../../render/core/studioEnv';
import { contextIsLost, onContextRestored } from '../../render/core/contextRecovery';
import { partTexturesReady } from '../../render/parts/textures';
import type { PartDef } from '../../sim/vessel/types';
import { createPartMesh } from './partMesh';
import { engineShrouds } from '../../sim/vessel/shroud';
import { partMeshParams } from '../../render/parts';

/**
 * Part thumbnails: each part is rendered once into a small offscreen WebGL canvas and cached as a data URL
 * (module-level, so it survives leaving and re-entering the editor). Rendering is spread over animation
 * frames to keep the UI responsive.
 */
const SIZE = 160;
const cache = new Map<string, string>();
const queue: PartDef[] = [];
const queued = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const renderedParts = new Map<string, THREE.Object3D>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let envRT: StudioEnvironment | null = null;
let scheduled = false;
let craftRequests = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function getThumbnail(id: string): string | undefined {
  return cache.get(id) ?? cachedThumbnail(id);
}
export function thumbnailVersion() {
  return version;
}
export function subscribeThumbnails(l: () => void) {
  listeners.add(l);
  schedule();
  return () => void listeners.delete(l);
}

export function requestThumbnails(defs: PartDef[]) {
  for (const d of defs) {
    if (getThumbnail(d.id) !== undefined || queued.has(d.id)) continue;
    queued.add(d.id);
    queue.push(d);
  }
  schedule();
}

const texturesFinal = new Set<string>();

function schedule() {
  // No palette mounted (e.g. preparing a launch): leave the queue suspended until it returns.
  if (scheduled || !queue.length || !listeners.size) return;
  // Context lost: renders would fail or come back blank. The restore subscription (setup) resumes the queue.
  if (renderer && contextIsLost(renderer)) return;
  scheduled = true;
  // Storage and texture readiness never run mesh construction in a React effect.
  void preloadThumbnails().then(() => {
    notify();
    const run = async () => { await pump(); scheduled = false; schedule(); };
    enqueueIdle(run);
  });
}

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function watchTextures(def: PartDef) {
  if (texturesFinal.has(def.id)) return;
  void partTexturesReady().then(() => {
    texturesFinal.add(def.id);
    if (!queued.has(def.id)) { queued.add(def.id); queue.push(def); }
    schedule();
  });
}

function setup() {
  if (renderer) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.debug.checkShaderErrors = !!import.meta.env?.DEV;
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  onContextRestored(renderer, schedule);
  scene = new THREE.Scene();
  const target = scene;
  envRT = new StudioEnvironment(renderer, { variant: 'thumbnail' }, (rt) => { target.environment = rt.texture; });
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
}

function teardown() {
  if (renderer) {
    const resources = new THREE.Group();
    for (const obj of renderedParts.values()) resources.add(obj);
    releaseRenderer(renderer, resources);
    renderedParts.clear();
  }
  envRT?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  envRT = null;
}

async function renderOne(def: PartDef): Promise<Blob> {
  if (idleTimer) clearTimeout(idleTimer);
  setup();
  const obj = createPartMesh(def);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  holder.add(obj);
  obj.position.sub(centre);
  // Radial parts look best seen from their outer face, three-quarter view.
  holder.rotation.y = def.attachNodes.some((n) => n.id === 'srf') ? -Math.PI * 0.8 : -Math.PI / 6;
  scene!.add(holder);
  const radius = Math.max(size.length() / 2, 0.05);
  const fov = (camera!.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fov / 2)) * 0.92;
  const dir = new THREE.Vector3(1, 0.55, 1.5).normalize();
  camera!.position.copy(dir.multiplyScalar(dist));
  camera!.near = dist / 50;
  camera!.far = dist * 4;
  camera!.updateProjectionMatrix();
  camera!.lookAt(0, 0, 0);
  try {
    // Shader preparation and PNG encoding can yield instead of blocking the next UI paint.
    await renderer!.compileAsync(scene!, camera!);
    await waitForInputQuiet();
    renderer!.render(scene!, camera!);
    return await new Promise<Blob>((resolve, reject) => renderer!.domElement.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error('Thumbnail encoding failed'));
    }, 'image/png'));
  } finally { scene!.remove(holder); renderedParts.set(def.id, holder); }
}

async function pump() {
  // Leaving the editor (palette unmounted) suspends the queue; it resumes on the next subscription.
  if (!listeners.size) return;
  // At most one mesh/render/readback per idle slice: the old 24 ms batch exceeded a 120 Hz frame.
  const d = queue.shift();
  if (d) {
    queued.delete(d.id);
    if (!cachedThumbnail(d.id)) {
      try {
        const blob = await renderOne(d);
        if (renderer && contextIsLost(renderer)) throw new Error('context lost');
        const previous = cache.get(d.id);
        cache.set(d.id, URL.createObjectURL(blob));
        if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
        watchTextures(d);
        // Canvas encoding is asynchronous; only final images enter persistent storage.
        if (texturesFinal.has(d.id)) void persistThumbnail(d.id, blob);
      } catch (e) {
        if (renderer && contextIsLost(renderer)) {
          // Not the part's fault: try again after the restore instead of caching a failure for the session.
          queued.add(d.id);
          queue.unshift(d);
          return;
        }
        console.warn('thumbnail failed', d.id, e);
        cache.set(d.id, '');
      }
    }
  }
  notify();
  scheduleTeardown();
}

/** Live encyclopedia thumbnail, using the same mesh, framing and lighting as catalogue thumbnails. */
export function mountPartTurntable(canvas: HTMLCanvasElement, def: PartDef, reducedMotion: () => boolean) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  r.debug.checkShaderErrors = !!import.meta.env?.DEV;
  r.setPixelRatio(1);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.15;
  const s = new THREE.Scene();
  const environment = new StudioEnvironment(r, { variant: 'thumbnail' }, (rt) => { s.environment = rt.texture; });
  s.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  s.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.2);
  rim.position.set(-4, 2, -3);
  s.add(rim);
  const obj = createPartMesh(def);
  const box = new THREE.Box3().setFromObject(obj);
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
  obj.position.sub(box.getCenter(new THREE.Vector3()));
  const holder = new THREE.Group();
  holder.add(obj);
  s.add(holder);
  const dist = radius / Math.sin(Math.PI / 12);
  const c = new THREE.PerspectiveCamera(30, 1, dist / 50, dist * 4);
  c.position.copy(new THREE.Vector3(1, 0.55, 1.5).normalize().multiplyScalar(dist));
  c.lookAt(0, 0, 0);
  let raf = 0, last = 0, visible = true;
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  visibility.observe(canvas);
  const resize = new ResizeObserver(() => {
    r.setSize(canvas.clientWidth, canvas.clientHeight, false);
    c.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    c.updateProjectionMatrix();
  });
  resize.observe(canvas);
  const frame = (now: number) => {
    if (!visible || now - last < 1000 / 30) { raf = requestAnimationFrame(frame); return; }
    if (last && !reducedMotion()) holder.rotation.y += Math.min((now - last) / 1000, 0.1) * 0.25;
    last = now;
    r.render(s, c);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); resize.disconnect(); visibility.disconnect(); environment.dispose(); r.dispose(); r.forceContextLoss(); };
}

/** Release the shared context only when neither thumbnail consumer is waiting on it. */
function scheduleTeardown() {
  if (queue.length || craftRequests) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!queue.length && !craftRequests) teardown(); }, 4000);
}

/** Whole-craft previews share the idle queue with parts, including retries after a context loss. */
export function requestCraftThumbnail(
  craft: import('../../sim/vessel/types').CraftDef, catalog: ReadonlyMap<string, PartDef>, ready: (image: string) => void,
): () => void {
  craftRequests++;
  if (idleTimer) clearTimeout(idleTimer);
  let cancelled = false;
  let cancelIdle: (() => void) | undefined;
  let offRestore: (() => void) | undefined;
  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    cancelIdle?.();
    offRestore?.();
    craftRequests--;
    scheduleTeardown();
  };
  const attempt = () => {
    if (cancelled) return;
    offRestore?.();
    offRestore = undefined;
    let image: string | undefined;
    try { image = renderCraftThumbnail(craft, catalog); }
    catch { if (!renderer || !contextIsLost(renderer)) image = ''; }
    if (image === undefined && renderer) {
      // Release the idle queue while waiting, so a lost thumbnail context cannot stall unrelated jobs.
      offRestore = onContextRestored(renderer, () => { cancelIdle = enqueueIdle(attempt); });
    } else {
      finish();
      ready(image ?? '');
    }
  };
  cancelIdle = enqueueIdle(attempt);
  return finish;
}

/** Synchronous draw/readback; never accept the canvas contents from a lost context. */
function renderCraftThumbnail(craft: import('../../sim/vessel/types').CraftDef, catalog: ReadonlyMap<string, PartDef>): string | undefined {
  setup();
  if (contextIsLost(renderer!)) return;
  const holder = new THREE.Group();
  const shrouds = engineShrouds(craft.parts, p => catalog.get(p.partId));
  for (const p of craft.parts) {
    const def = catalog.get(p.partId); if (!def) continue;
    // Instance variants (interstage skirts, fitted fairing shells), as the editor and flight draw them.
    const mesh = createPartMesh(def, partMeshParams(def, p.tweaks, shrouds.get(p.uid)));
    mesh.position.set(p.position.x, p.position.y, p.position.z);
    mesh.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
    holder.add(mesh);
  }
  const box = new THREE.Box3().setFromObject(holder);
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
  const dist = radius / Math.sin(camera!.fov * Math.PI / 360) * 1.1;
  holder.position.sub(box.getCenter(new THREE.Vector3()));
  scene!.add(holder);
  try {
    camera!.position.copy(new THREE.Vector3(1, 0.5, 1.5).normalize().multiplyScalar(dist));
    camera!.near = dist / 100; camera!.far = dist * 4;
    camera!.updateProjectionMatrix(); camera!.lookAt(0, 0, 0);
    renderer!.render(scene!, camera!);
    if (contextIsLost(renderer!)) return;
    const image = renderer!.domElement.toDataURL('image/png');
    return contextIsLost(renderer!) ? undefined : image;
  } finally {
    scene!.remove(holder);
    renderedParts.set('craft', holder);
  }
}
