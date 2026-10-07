import { releaseRenderer } from '../../render/releaseRenderer';
import { enqueueIdle, waitForInputQuiet } from '../../util/idleQueue';
import * as THREE from 'three';
import { cachedThumbnail, persistThumbnail, preloadThumbnails } from './thumbnailCache';
import { createStudioEnvironment } from '../../render/core/studioEnv';
import { partTexturesReady } from '../../render/parts/textures';
import type { PartDef } from '../../sim/vessel/types';
import { createPartMesh } from './partMesh';

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
let envRT: THREE.WebGLRenderTarget | null = null;
let scheduled = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function getThumbnail(id: string): string | undefined {
  return cache.get(id) ?? cachedThumbnail(id);
}
export function thumbnailVersion() {
  return version;
}
export function subscribeThumbnails(l: () => void) {
  listeners.add(l);
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
  if (scheduled || !queue.length) return;
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
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  envRT = createStudioEnvironment(renderer, { variant: 'thumbnail' });
  scene.environment = envRT.texture;
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
  // At most one mesh/render/readback per idle slice: the old 24 ms batch exceeded a 120 Hz frame.
  const d = queue.shift();
  if (d) {
    queued.delete(d.id);
    if (!cachedThumbnail(d.id)) {
      try {
        const blob = await renderOne(d);
        const previous = cache.get(d.id);
        cache.set(d.id, URL.createObjectURL(blob));
        if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
        watchTextures(d);
        // Canvas encoding is asynchronous; only final images enter persistent storage.
        if (texturesFinal.has(d.id)) void persistThumbnail(d.id, blob);
      } catch (e) {
        console.warn('thumbnail failed', d.id, e);
        cache.set(d.id, '');
      }
    }
  }
  notify();
  if (!queue.length) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => !queue.length && teardown(), 4000);
  }
}

/** Live encyclopedia thumbnail, using the same mesh, framing and lighting as catalogue thumbnails. */
export function mountPartTurntable(canvas: HTMLCanvasElement, def: PartDef, reducedMotion: () => boolean) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  r.setPixelRatio(1);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.15;
  const s = new THREE.Scene();
  const environment = createStudioEnvironment(r, { variant: 'thumbnail' });
  s.environment = environment.texture;
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

/** Whole-craft preview shares the catalogue renderer and cached mesh geometry. */
export function renderCraftThumbnail(craft: import('../../sim/vessel/types').CraftDef, catalog: ReadonlyMap<string, PartDef>): string {
  setup();
  const holder = new THREE.Group();
  for (const p of craft.parts) {
    const def = catalog.get(p.partId); if (!def) continue;
    const mesh = createPartMesh(def);
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
    return renderer!.domElement.toDataURL('image/png');
  } finally {
    scene!.remove(holder);
    renderedParts.set('craft', holder);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => !queue.length && teardown(), 4000);
  }
}
