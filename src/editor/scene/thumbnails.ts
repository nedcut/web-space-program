import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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

export function requestThumbnails(defs: PartDef[]) {
  for (const d of defs) {
    if (cache.has(d.id) || queued.has(d.id)) continue;
    queued.add(d.id);
    queue.push(d);
  }
  schedule();
}

function schedule() {
  if (scheduled || !queue.length) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    pump();
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
  const pmrem = new THREE.PMREMGenerator(renderer);
  envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();
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
