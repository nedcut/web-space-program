import * as THREE from 'three';
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

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let envRT: THREE.WebGLRenderTarget | null = null;
let scheduled = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function getThumbnail(id: string): string | undefined {
  return cache.get(id);
}
export function thumbnailVersion() {
  return version;
}
export function subscribeThumbnails(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const byId = new Map<string, PartDef>();

export function requestThumbnails(defs: PartDef[]) {
  for (const d of defs) {
    byId.set(d.id, d);
    if (cache.has(d.id) || queued.has(d.id)) continue;
    queued.add(d.id);
    queue.push(d);
  }
  schedule();
}

let texturesFinal = false;
let refreshArmed = false;

function schedule() {
  if (scheduled || !queue.length) return;
  scheduled = true;
  // Build queued meshes first so their procedural textures are requested. Wait briefly for the
  // texture worker (instant on IndexedDB cache hits); on a slow first visit render anyway and
  // re-render everything once the final textures land, so placeholders never stick.
  for (const d of queue) createPartMesh(d);
  const ready = partTexturesReady();
  if (!refreshArmed) {
    refreshArmed = true;
    void ready.then(() => {
      refreshArmed = false;
      if (texturesFinal) return;
      texturesFinal = true;
      // Re-render in place: keep the provisional image visible until its replacement is ready.
      for (const id of cache.keys()) {
        const d = byId.get(id);
        if (!d || queued.has(id)) continue;
        queued.add(id);
        queue.push(d);
      }
      schedule();
    });
  }
  void Promise.race([ready, new Promise((r) => setTimeout(r, 2500))]).then(() =>
    requestAnimationFrame(() => {
      scheduled = false;
      pump();
    }),
  );
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
  renderer?.dispose();
  renderer?.forceContextLoss();
  envRT?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  envRT = null;
}

function renderOne(def: PartDef): string {
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
  renderer!.render(scene!, camera!);
  const url = renderer!.domElement.toDataURL('image/png');
  scene!.remove(holder);
  return url;
}

function pump() {
  const start = performance.now();
  // A few per frame, bounded by time.
  while (queue.length && performance.now() - start < 24) {
    const d = queue.shift()!;
    queued.delete(d.id);
    try {
      cache.set(d.id, renderOne(d));
    } catch (e) {
      console.warn('thumbnail failed', d.id, e);
      cache.set(d.id, '');
    }
  }
  version++;
  listeners.forEach((l) => l());
  if (queue.length) schedule();
  else {
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
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => !queue.length && teardown(), 4000);
  }
}
