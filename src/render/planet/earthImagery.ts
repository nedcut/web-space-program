import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';
import { contextIsLost } from '../core/contextRecovery';
import { decodeImagery, releaseImagery } from './imageryDecode';
import type { ImageStrips as Strips } from './imageStrips';

/**
 * Real Earth imagery (NASA Blue Marble Next Generation monthly colour, Black Marble night lights, the Blue
 * Marble cloud composite and a water mask), built by `scripts/earth-imagery/build.mjs` into
 * `public/earth/imagery/`. Levels 2k/4k are bundled (precached by the PWA, offline); 8k/16k are packs fetched
 * on demand and kept in Cache Storage. Every failure falls back to the next lower level, ultimately to the
 * procedural surface (`ready` stays false and shaders keep `uEarthImagery = 0`).
 *
 * Decoded images are shared between renderers by URL (reference counted); GPU textures belong to one renderer and
 * are filled in small strips under a per-frame submission budget (individual driver calls can still stall).
 * Shaders sample them with
 * `GLSL_EARTH_IMAGERY` (u = lon/2π + 0.5, v = 0.5 − lat/π, rows north → south, uploaded without a flip).
 */
export type EarthTextureQuality = QualitySettings['earth']['textureQuality'];

interface ManifestLevel {
  id: string;
  width: number;
  height: number;
  tiles: number;
  bundled: boolean;
  optional?: boolean;
  day: string;
  water: string;
  night: string;
  clouds: string;
}
interface Manifest { version: number; levels: ManifestLevel[] }

const CACHE_NAME = 'wsp-earth-imagery-v1';
const LEVEL_FOR: Record<EarthTextureQuality, string> = { low: '2k', medium: '8k', high: '8k', ultra: '16k' };
const ANISOTROPY: Record<EarthTextureQuality, number> = { low: 1, medium: 2, high: 8, ultra: 8 };
/** Largest bundled level: shown first while a pack downloads. */
const BUNDLED_PREVIEW = '4k';

function root(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : base + '/'}earth/imagery/`;
}

let manifestPromise: Promise<Manifest> | null = null;
function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch(root() + 'manifest.json').then((r) => {
    if (!r.ok) throw new Error(`earth imagery manifest: HTTP ${r.status}`);
    return r.json() as Promise<Manifest>;
  }).catch((e) => { manifestPromise = null; throw e; });
  return manifestPromise;
}

/** Packs are cached explicitly (the service worker precaches only bundled levels). */
async function fetchBlob(url: string, persistent: boolean): Promise<Blob> {
  if (persistent && typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return await hit.blob();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      await cache.put(url, res.clone()).catch(() => {});
      return await res.blob();
    } catch (e) {
      if (e instanceof Error && /HTTP/.test(e.message)) throw e;
      // Cache Storage unavailable (private mode, quota): plain fetch below.
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.blob();
}

let maxTexture = 0;
/** MAX_TEXTURE_SIZE of this browser's WebGL2 (probed once; 8192 when unknown). */
function maxTextureSize(): number {
  if (maxTexture) return maxTexture;
  maxTexture = 8192;
  try {
    if (typeof document !== 'undefined') {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl) {
        maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  } catch { /* keep 8192 */ }
  return maxTexture;
}

type Kind = 'day' | 'water' | 'night' | 'clouds';
/** One unit of GPU streaming work; `heavy` units (allocation, mips, first render-target use) only start a frame. */
type Job = ((renderer: THREE.WebGLRenderer) => boolean) & { heavy?: () => boolean };

interface Entry { refs: number; promise: Promise<Strips> }
const decoded = new Map<string, Entry>();
/** Keep individual uploads small; the frame budget cannot interrupt a driver call. */
const STRIP_BYTES = 1 << 20;

/** URLs of a level's file(s) for one kind: several west→east tiles where the pattern has `{T}`. */
function urlsOf(level: ManifestLevel, kind: Kind, month: number): string[] {
  const pattern = level[kind];
  const tiles = pattern.includes('{T}') ? level.tiles : 1;
  const mm = String(month + 1).padStart(2, '0');
  return Array.from({ length: tiles }, (_, t) => root() + pattern.replace('{MM}', mm).replace('{T}', String(t)));
}

/** Decoded strips of one image, shared by URL between renderers (reference counted). */
function acquireStrips(url: string): { key: string; promise: Promise<Strips> } {
  let entry = decoded.get(url);
  if (!entry) {
    const promise = fetchBlob(url, url.includes('/packs/')).then(blob => decodeImagery(blob, STRIP_BYTES));
    entry = { refs: 0, promise };
    decoded.set(url, entry);
    promise.catch(() => { if (decoded.get(url) === entry) decoded.delete(url); });
  }
  entry.refs++;
  return { key: url, promise: entry.promise };
}

function releaseStrips(key: string): void {
  const entry = decoded.get(key);
  if (!entry || --entry.refs > 0) return;
  decoded.delete(key);
  void entry.promise.then(releaseImagery, () => {});
}

/** Preallocated texture filled one strip per `step()` through texSubImage2D (three's copyTextureToTexture). */
class StripUpload {
  readonly texture: THREE.DataTexture;
  private next = -1;
  private readonly at = new THREE.Vector2();
  constructor(private readonly src: Strips, kind: Kind) {
    const red = kind !== 'day';
    const mips = kind === 'night' || kind === 'clouds';
    const t = new THREE.DataTexture(null, src.width, src.height, red ? THREE.RedFormat : THREE.RGBAFormat, THREE.UnsignedByteType);
    t.source.dataReady = false; // storage only: strips fill it
    t.needsUpdate = true; // version 1, so initTexture allocates (version 0 textures are never uploaded)
    t.name = `earth:${kind}`;
    t.colorSpace = kind === 'day' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    // Merge sources are sampled 1:1; lights and the cloud source are minified (full chain allocated up front).
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.generateMipmaps = mips;
    // Isotropic for the cloud source: anisotropic taps keep the equirect polar streaks.
    t.anisotropy = kind === 'clouds' ? 1 : 4;
    this.texture = t;
  }
  get done(): boolean { return this.next >= this.src.strips.length; }
  /** The next step allocates storage or regenerates mips: driver work the frame budget cannot predict. */
  get heavy(): boolean { return this.next < 0 || (!!this.texture.userData.mips && this.next === this.src.strips.length - 1); }
  /** Allocate, then upload one strip per call; the last strip regenerates the mip chain. */
  step(renderer: THREE.WebGLRenderer): boolean {
    if (this.done) return true;
    const t = this.texture;
    if (this.next < 0) {
      const mips = t.generateMipmaps;
      renderer.initTexture(t);
      t.userData.mips = mips;
      this.next = 0;
      return false;
    }
    const strip = this.src.strips[this.next++];
    const source = new THREE.Texture(strip.bitmap as unknown as HTMLImageElement);
    t.generateMipmaps = !!t.userData.mips && this.done;
    renderer.copyTextureToTexture(source, t, null, this.at.set(0, strip.y));
    if (this.done) t.generateMipmaps = !!t.userData.mips;
    return this.done;
  }
}

/**
 * Colour (sRGB) + water mask → one RGBA8 sRGB render target with a hardware mip chain, so shaders take a
 * single fetch for both. Written in linear; the sRGB attachment re-encodes on store.
 */
const MERGE_VERT = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MERGE_FRAG = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uWater;
uniform vec4 uRect; // x0, width of this tile in the target (px), target size (px)
void main() {
  vec2 local = vec2((gl_FragCoord.x - uRect.x) / uRect.y, gl_FragCoord.y / uRect.w);
  vec2 global = gl_FragCoord.xy / uRect.zw;
  gl_FragColor = vec4(texture2D(uDay, local).rgb, texture2D(uWater, global).r);
}`;
/** Pixels merged per frame (a fraction of a millisecond of GPU time). */
const MERGE_PIXELS = 1 << 20;

/** Month index 0–11 for the Sun's ecliptic longitude seen from Earth (seasons follow the orbit, not UT). */
export function seasonMonth(sunEclipticLongitude: number): number {
  // Day of year ≈ 79.5 at the March equinox (λ = 0); the tropical year spans 2π.
  const lambda = ((sunEclipticLongitude % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const doy = (79.5 + (lambda / (2 * Math.PI)) * 365.2422) % 365.2422;
  return Math.min(11, Math.floor(doy / (365.2422 / 12)));
}

let dummyDay: THREE.DataTexture | null = null;
let dummyBlack: THREE.DataTexture | null = null;
function placeholder(day: boolean): THREE.DataTexture {
  const make = (rgba: number[]) => {
    const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
    t.needsUpdate = true;
    return t;
  };
  if (day) return (dummyDay ??= make([128, 128, 128, 0]));
  return (dummyBlack ??= make([0, 0, 0, 255]));
}

export interface EarthImageryUniforms {
  /** RGB = sRGB colour, A = water fraction (merged on the GPU). */
  uEarthDay: THREE.IUniform<THREE.Texture>;
  uEarthNight: THREE.IUniform<THREE.Texture>;
  /** 1 once real imagery is bound. */
  uEarthImagery: THREE.IUniform<number>;
  /** 1 when night-light imagery is bound and enabled. */
  uEarthNightOn: THREE.IUniform<number>;
  /** Distance range (m) over which close-up terrain colour hands over to imagery (texel-size driven). */
  uEarthBlend: THREE.IUniform<THREE.Vector2>;
}

export interface EarthImageryOptions {
  quality: EarthTextureQuality;
  nightLights: boolean;
  /** Body radius (m) in the playable universe: sets the terrain → imagery hand-over distances. */
  radius: number;
  /** Cap for map/portrait renderers that only show a small globe. */
  maxLevel?: string;
  /** Load the cloud composite for the cloud-field bake. */
  clouds?: boolean;
}

/**
 * Per-renderer imagery binding: picks the level for the quality, shows the bundled 4k first when the target is
 * a pack, follows the season month and exposes uniforms. Decoding happens off the frame; GPU work (one tile
 * upload or one merge pass) is spread one step per frame through `step(renderer)`.
 */
export class EarthImagery {
  readonly uniforms: EarthImageryUniforms;
  private levels: ManifestLevel[] = [];
  private target: ManifestLevel | null = null;
  private shown: { level: ManifestLevel; month: number; rt: THREE.WebGLRenderTarget; night: THREE.Texture | null } | null = null;
  private loading = false;
  /** GPU work for the next level/month: one unit per frame; null when idle. */
  private jobs: Job[] | null = null;
  private wantedMonth = -1;
  private disposed = false;
  private settled = false;
  private held: string[] = [];
  private cloudKey: string | null = null;
  private cloudJob: StripUpload | null = null;
  /** Bumped per cloud load so a superseded load (context restore) cannot install its upload. */
  private cloudLoad = 0;
  private failedLevels = new Set<string>();
  private mergeScene: THREE.Scene | null = null;
  private mergeMat: THREE.ShaderMaterial | null = null;
  private readonly mergeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private pendingTextures: THREE.Texture[] = [];
  private pendingTarget: THREE.WebGLRenderTarget | null = null;
  /** Equirect cloud reflectance for the cloud-field bake (R8), or null while loading / unavailable. */
  cloudSource: THREE.Texture | null = null;
  cloudSourceSettled = false;

  constructor(private readonly opts: EarthImageryOptions) {
    this.uniforms = {
      uEarthDay: { value: placeholder(true) },
      uEarthNight: { value: placeholder(false) },
      uEarthImagery: { value: 0 },
      uEarthNightOn: { value: 0 },
      uEarthBlend: { value: new THREE.Vector2(1e9, 2e9) },
    };
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') { this.settled = this.cloudSourceSettled = true; return; }
    loadManifest().then((m) => {
      if (this.disposed) return;
      const cap = Math.min(maxTextureSize(), opts.maxLevel ? (m.levels.find((x) => x.id === opts.maxLevel)?.width ?? Infinity) : Infinity);
      this.levels = m.levels.filter((l) => l.width <= cap).sort((a, b) => a.width - b.width);
      const want = m.levels.find((l) => l.id === LEVEL_FOR[opts.quality]);
      this.target = [...this.levels].reverse().find((l) => !want || l.width <= want.width) ?? this.levels[0] ?? null;
      if (!this.target) { this.settled = this.cloudSourceSettled = true; return; }
      if (opts.clouds) this.loadClouds();
      else this.cloudSourceSettled = true;
      this.pump();
    }).catch(() => { this.settled = this.cloudSourceSettled = true; });
  }

  /** True once the target level (or its fallback) is shown, or loading has given up. */
  get ready(): boolean { return this.settled; }
  /** True once any level is on screen (packs keep streaming afterwards), or loading has given up. */
  get presentable(): boolean { return this.settled || !!this.shown; }
  /** Diagnostics: GPU steps run and the longest main-thread time spent in one frame's `step()` (ms). */
  readonly stats = { units: 0, maxFrameMs: 0 };
  get levelId(): string | null { return this.shown?.level.id ?? null; }

  /** Feed the season (month 0–11). Starts a load when the month or the level to show changes. */
  update(month: number): void {
    if (month !== this.wantedMonth) { this.wantedMonth = month; this.pump(); }
  }

  /** The next level to show: the target, or the bundled preview while a pack loads, skipping failures. */
  private nextLevel(): ManifestLevel | null {
    const candidates = this.levels.filter((l) => l.width <= (this.target?.width ?? 0) && !this.failedLevels.has(l.id));
    const best = candidates[candidates.length - 1] ?? null;
    if (!best) return null;
    if (!this.shown && !best.bundled) {
      // Something on screen quickly: the bundled preview first, then the pack.
      return candidates.filter((l) => l.bundled && l.width <= (candidates.find((c) => c.id === BUNDLED_PREVIEW)?.width ?? Infinity)).pop() ?? best;
    }
    return best;
  }

  private pump(): void {
    if (this.loading || this.jobs || this.disposed || !this.target || this.wantedMonth < 0) return;
    const level = this.nextLevel();
    if (!level) { this.settled = true; return; }
    if (this.shown && this.shown.level === level && this.shown.month === this.wantedMonth) { this.settled = true; return; }
    this.loading = true;
    const month = this.wantedMonth;
    // Water masks above 8k cost more memory than they add: Ultra pairs 16k colour with the 8k mask.
    const waterLevel = level.width > 8192 ? (this.levels.filter((l) => l.width <= 8192).pop() ?? level) : level;
    const day = urlsOf(level, 'day', month).map(acquireStrips);
    const water = acquireStrips(urlsOf(waterLevel, 'water', month)[0]);
    const night = this.opts.nightLights ? acquireStrips(urlsOf(level, 'night', month)[0]) : null;
    const parts = [...day, water, ...(night ? [night] : [])];
    const keys = parts.map((p) => p.key);
    Promise.all([Promise.all(day.map((p) => p.promise)), water.promise, night?.promise ?? null]).then(([dayS, waterS, nightS]) => {
      this.loading = false;
      if (this.disposed) { keys.forEach(releaseStrips); return; }
      this.held = keys;
      this.jobs = this.buildJobs(level, month, dayS, waterS, nightS);
    }, () => {
      this.loading = false;
      keys.forEach(releaseStrips);
      if (this.disposed) return;
      this.failedLevels.add(level.id);
      this.pump();
    });
  }

  /** Upload water and lights, then per tile: upload colour strips and merge them into the target in strips. */
  private buildJobs(level: ManifestLevel, month: number, day: Strips[], water: Strips, night: Strips | null): Job[] {
    const jobs: Job[] = [];
    const waterUp = new StripUpload(water, 'water');
    const nightUp = night ? new StripUpload(night, 'night') : null;
    this.pendingTextures = [waterUp.texture, ...(nightUp ? [nightUp.texture] : [])];
    const rt = new THREE.WebGLRenderTarget(level.width, level.height, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
      // Orbit views are oblique: anisotropic taps are a real cost, so they scale with the tier.
      anisotropy: ANISOTROPY[this.opts.quality],
    });
    rt.texture.name = `earth:day+water:${level.id}`;
    this.pendingTarget = rt;
    jobs.push(Object.assign((r: THREE.WebGLRenderer) => waterUp.step(r), { heavy: () => waterUp.heavy }));
    if (nightUp) jobs.push(Object.assign((r: THREE.WebGLRenderer) => nightUp.step(r), { heavy: () => nightUp.heavy }));
    const tw = level.width / day.length;
    const rows = Math.max(64, Math.min(level.height, Math.floor(MERGE_PIXELS / tw)));
    day.forEach((tile, t) => {
      const up = new StripUpload(tile, 'day');
      this.pendingTextures.push(up.texture);
      jobs.push(Object.assign((r: THREE.WebGLRenderer) => up.step(r), { heavy: () => up.heavy }));
      let y = 0;
      jobs.push(Object.assign((r: THREE.WebGLRenderer) => {
        const last = t === day.length - 1 && y + rows >= level.height;
        this.mergeStrip(r, rt, up.texture, waterUp.texture, t, day.length, y, Math.min(rows, level.height - y), last);
        y += rows;
        if (y < level.height) return false;
        up.texture.dispose(); // this tile is merged; its source upload is no longer needed
        return true;
      }, { heavy: () => y === 0 || (t === day.length - 1 && y + rows >= level.height) }));
    });
    jobs.push(() => {
      // Swap in the merged texture; keep only the lights.
      const previous = this.shown;
      this.shown = { level, month, rt, night: nightUp?.texture ?? null };
      this.uniforms.uEarthDay.value = rt.texture;
      if (nightUp) this.uniforms.uEarthNight.value = nightUp.texture;
      this.uniforms.uEarthNightOn.value = nightUp ? 1 : 0;
      this.uniforms.uEarthImagery.value = 1;
      // Imagery dominates once a texel is a few pixels on screen; the close-up palette takes over below.
      const texel = (2 * Math.PI * this.opts.radius) / level.width;
      this.uniforms.uEarthBlend.value.set(texel * 8, texel * 80);
      waterUp.texture.dispose();
      this.held.forEach(releaseStrips);
      this.held = [];
      this.pendingTextures = [];
      this.pendingTarget = null;
      if (previous) { previous.rt.dispose(); previous.night?.dispose(); }
      return true;
    });
    return jobs;
  }

  /**
   * Stream for about 6% of the measured frame interval, 1–3 ms: a slow (or throttled) machine gets the same number
   * of frames' worth of work, so streaming time does not grow as the frame rate drops, while 120 Hz frames spend
   * about a millisecond. The next unit starts only if its predicted cost fits (one unit always runs). A single
   * allocation or mip generation can still exceed the budget; diagnostics retain the actual maximum.
   */
  private lastStep = 0;
  private frameMs = 16.7;
  private unitMs = 0.5;
  step(renderer: THREE.WebGLRenderer): void {
    if (this.disposed) return;
    // Uploads and merges are dropped while the context is lost: wait for the restore (which resets the work).
    if ((this.jobs || this.cloudJob) && contextIsLost(renderer)) return;
    const timed = typeof performance !== 'undefined';
    const t0 = timed ? performance.now() : 0;
    if (this.lastStep) this.frameMs += (Math.min(100, Math.max(4, t0 - this.lastStep)) - this.frameMs) * 0.2;
    this.lastStep = t0;
    const limit = Math.min(3, Math.max(1, this.frameMs * 0.06));
    let units = 0;
    const budget = (heavy = false) => !timed || units === 0 || (!heavy && performance.now() - t0 + this.unitMs <= limit);
    /** Run one unit and fold its duration into the estimate used to admit the next one. */
    const unit = (work: () => boolean): boolean => {
      const start = timed ? performance.now() : 0;
      const done = work();
      if (timed) this.unitMs += (performance.now() - start - this.unitMs) * 0.25;
      this.stats.units++; units++;
      return done;
    };
    // Put the bundled surface preview on screen before spending frames on the cloud source.
    while (this.jobs && budget(this.jobs[0].heavy?.())) {
      const jobs = this.jobs;
      if (unit(() => jobs[0](renderer))) jobs.shift();
      if (!jobs.length) { this.jobs = null; this.pump(); }
    }
    while (this.cloudJob && budget(this.cloudJob.heavy)) {
      const job = this.cloudJob;
      if (unit(() => job.step(renderer))) {
        this.cloudSource = this.cloudJob.texture;
        this.cloudSourceSettled = true;
        this.cloudJob = null;
        if (this.cloudKey) { releaseStrips(this.cloudKey); this.cloudKey = null; }
      }
    }
    if (typeof performance !== 'undefined') this.stats.maxFrameMs = Math.max(this.stats.maxFrameMs, performance.now() - t0);
  }

  private mergeStrip(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, day: THREE.Texture, water: THREE.Texture,
    t: number, tiles: number, y: number, rows: number, last: boolean): void {
    if (!this.mergeMat) {
      this.mergeMat = new THREE.ShaderMaterial({
        uniforms: { uDay: { value: null }, uWater: { value: null }, uRect: { value: new THREE.Vector4() } },
        vertexShader: MERGE_VERT, fragmentShader: MERGE_FRAG, depthTest: false, depthWrite: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mergeMat);
      quad.frustumCulled = false;
      this.mergeScene = new THREE.Scene();
      this.mergeScene.add(quad);
    }
    const tw = rt.width / tiles;
    const u = this.mergeMat.uniforms;
    u.uDay.value = day;
    u.uWater.value = water;
    u.uRect.value.set(t * tw, tw, rt.width, rt.height);
    // Only the final strip builds the mip chain.
    rt.texture.generateMipmaps = last;
    rt.viewport.set(t * tw, y, tw, rows);
    rt.scissor.copy(rt.viewport);
    rt.scissorTest = true;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.render(this.mergeScene!, this.mergeCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    rt.viewport.set(0, 0, rt.width, rt.height);
    rt.scissor.copy(rt.viewport);
    rt.scissorTest = false;
  }

  private loadClouds(): void {
    const level = this.target!;
    const lv = this.levels.filter((l) => l.width <= Math.min(level.width, 8192)).pop() ?? level;
    const part = acquireStrips(urlsOf(lv, 'clouds', 0)[0]);
    this.cloudKey = part.key;
    const load = ++this.cloudLoad;
    part.promise.then((s) => {
      if (this.disposed || load !== this.cloudLoad) return;
      this.cloudJob = new StripUpload(s, 'clouds');
    }, () => { if (load === this.cloudLoad) this.cloudSourceSettled = true; });
  }

  /**
   * The cloud source was lost with the GPU context (or is about to be needed again for a re-bake): upload it again.
   * The decoded image is shared by URL, so it is only fetched again when nothing else still holds it.
   */
  reloadClouds(): void {
    if (this.disposed || !this.opts.clouds || !this.target) return;
    const previous = this.cloudKey;
    this.cloudJob?.texture.dispose();
    this.cloudJob = null;
    this.cloudSource?.dispose();
    this.cloudSource = null;
    this.cloudSourceSettled = false;
    this.loadClouds(); // acquires before the old reference is released, so a held image is not decoded twice
    if (previous) releaseStrips(previous);
  }

  /**
   * The GPU context was restored: every texture and render target this binding owns is blank (they were filled by
   * strip uploads and merge passes, so three.js has no CPU copy to re-send). Drop them and stream the level again.
   * Decoded strips still held (or shared with another renderer) are reused; otherwise they come back from Cache
   * Storage / the service worker, never the network when they were cached. The bundled preview goes first, as at start.
   */
  restoreContext(): void {
    if (this.disposed) return;
    const held = this.held;
    this.held = [];
    this.jobs = null;
    this.pendingTextures.forEach((t) => t.dispose());
    this.pendingTextures = [];
    this.pendingTarget?.dispose();
    this.pendingTarget = null;
    if (this.shown) { this.shown.rt.dispose(); this.shown.night?.dispose(); this.shown = null; }
    const u = this.uniforms;
    u.uEarthDay.value = placeholder(true);
    u.uEarthNight.value = placeholder(false);
    u.uEarthImagery.value = 0;
    u.uEarthNightOn.value = 0;
    this.settled = false;
    this.mergeMat?.dispose(); // recompiled on the next merge; keeps program state tied to the new context
    this.mergeMat = null;
    this.mergeScene?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mergeScene = null;
    // Re-acquire first (pump) so images in `held` that are still decoded are shared rather than released and re-fetched.
    this.pump();
    held.forEach(releaseStrips);
  }

  /** The cloud source is only needed for the one-time cube bake. */
  releaseCloudSource(): void {
    if (this.cloudKey) releaseStrips(this.cloudKey);
    this.cloudKey = null;
    this.cloudSource?.dispose();
    this.cloudSource = null;
    this.cloudJob?.texture.dispose();
    this.cloudJob = null;
  }

  dispose(): void {
    this.disposed = true;
    this.jobs = null;
    this.held.forEach(releaseStrips);
    this.held = [];
    this.pendingTextures.forEach((t) => t.dispose());
    this.pendingTarget?.dispose();
    if (this.shown) { this.shown.rt.dispose(); this.shown.night?.dispose(); this.shown = null; }
    this.mergeMat?.dispose();
    this.mergeScene?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.releaseCloudSource();
  }
}

/**
 * Equirect lookup shared by Earth surface materials. Derivatives are taken in uniform control flow and
 * swapped to the wrapped copy across the antimeridian so the seam keeps its mip level.
 */
export const GLSL_EARTH_IMAGERY = /* glsl */ `
uniform sampler2D uEarthDay;
uniform sampler2D uEarthNight;
uniform float uEarthImagery;
uniform float uEarthNightOn;
uniform vec2 uEarthBlend;
struct EarthUV { vec2 uv; vec2 dx; vec2 dy; };
/**
 * Lookup coordinates from a unit body-fixed direction and its screen derivatives (taken by the caller in
 * uniform control flow, e.g. dFdx(n)). Analytic UV derivatives have no antimeridian seam, and the trig can sit
 * inside branches.
 */
EarthUV earthUVd(vec3 n, vec3 ndx, vec3 ndy) {
  EarthUV e;
  float r2 = max(n.x * n.x + n.y * n.y, 1e-8);
  e.uv = vec2(atan(n.y, n.x) * (0.5 / ATMO_PI) + 0.5, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / ATMO_PI);
  float invC = inversesqrt(r2);
  e.dx = vec2((n.x * ndx.y - n.y * ndx.x) / r2 * (0.5 / ATMO_PI), -ndx.z * invC / ATMO_PI);
  e.dy = vec2((n.x * ndy.y - n.y * ndy.x) / r2 * (0.5 / ATMO_PI), -ndy.z * invC / ATMO_PI);
  return e;
}
EarthUV earthUV(vec3 n) { return earthUVd(n, dFdx(n), dFdy(n)); }
/**
 * Bicubic B-spline lookup from four bilinear taps (Sigg & Hadwiger 2005) while the texture is magnified, so a
 * texel spread over several screen pixels reads as smooth relief instead of a bilinear staircase.
 */
vec4 earthTex(sampler2D t, EarthUV e) {
  #ifndef EARTH_RICH
    return textureGrad(t, e.uv, e.dx, e.dy);
  #endif
  vec2 size = vec2(textureSize(t, 0));
  vec2 fp = max(abs(e.dx) + abs(e.dy), vec2(1e-9)) * size;
  if (max(fp.x, fp.y) > 0.7) return textureGrad(t, e.uv, e.dx, e.dy);
  vec2 st = e.uv * size - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f * f - 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size, h1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureLod(t, vec2(h0.x, h0.y), 0.0) + g1.x * textureLod(t, vec2(h1.x, h0.y), 0.0))
       + g1.y * (g0.x * textureLod(t, vec2(h0.x, h1.y), 0.0) + g1.x * textureLod(t, vec2(h1.x, h1.y), 0.0));
}
/**
 * Blue Marble colour → plausible surface reflectance. The published imagery is contrast-stretched for display:
 * forests are too dark and deserts too bright as albedo. This curve maps forest green to ≈ 0.05, bright desert
 * to ≈ 0.5 and fresh snow to ≈ 0.85 (linear), close to MODIS surface albedo.
 */
vec3 earthAlbedo(vec3 c) {
  // The curve acts on luminance only, so hue and saturation (ochre deserts, green forest) are preserved.
  float y = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  float f = pow(y, 0.62) * (0.62 + 0.26 * y);
  return min(c * (f / y), vec3(1.0));
}
/**
 * Water-leaving reflectance. Blue Marble fills the open ocean with one flat colour (2, 5, 20); only what
 * exceeds it is real signal (shallow banks, sediment, blooms). Taking the excess keeps compression noise in the
 * dark fill from being amplified into visible blocks.
 */
vec3 earthWaterAlbedo(vec3 c) {
  vec3 excess = max(c - vec3(0.0011, 0.0026, 0.0105), vec3(0.0));
  // A faint excess is mostly chroma noise from lossy compression beside bright banks; the albedo curve would
  // turn it into purple and red specks in open water, so it keeps only its brightness.
  float ey = dot(excess, vec3(0.2126, 0.7152, 0.0722));
  excess = mix(vec3(ey), excess, smoothstep(0.002, 0.02, ey));
  return vec3(0.0035, 0.0105, 0.027) + earthAlbedo(excess) * 0.85;
}
float earthHash(vec2 i) {
  uvec2 q = uvec2(ivec2(i));
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h *= 0x9E3779B9u ^ (h >> 15);
  return float(h >> 8) * (1.0 / 16777216.0);
}
/** Value noise on the imagery texel grid; x wraps every "period" cells so the antimeridian has no seam. */
float earthNoise(vec2 p, float period) {
  vec2 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float x1 = mod(i.x + 1.0, period);
  i.x = mod(i.x, period);
  return mix(mix(earthHash(i), earthHash(vec2(x1, i.y)), f.x),
             mix(earthHash(i + vec2(0.0, 1.0)), earthHash(vec2(x1, i.y + 1.0)), f.x), f.y);
}
/**
 * Water weight with a crisp coastline. While a mask texel covers many pixels (low orbit on the scaled Earth),
 * the filtered mask is a soft, blocky ramp; sub-texel noise breaks the texel grid into an organic shore and the
 * edge stays about a pixel wide. Unmagnified, the filtered mask is returned unchanged.
 */
float earthCoast(float water, EarthUV e) {
  if (water <= 0.0 || water >= 1.0) return water;
  vec2 size = vec2(textureSize(uEarthDay, 0));
  vec2 fp2 = (abs(e.dx) + abs(e.dy)) * size;
  float fp = max(max(fp2.x, fp2.y), 1e-6);
  float mag = 1.0 - smoothstep(0.35, 1.0, fp);
  if (mag <= 0.0) return water;
  vec2 p = e.uv * size;
  float n = earthNoise(p * 2.0, size.x * 2.0) * 0.65 + earthNoise(p * 5.0 + 17.0, size.x * 5.0) * 0.35;
  float edge = clamp(fp * 0.5, 0.03, 0.5);
  return mix(water, smoothstep(0.5 - edge, 0.5 + edge, water + (n - 0.5) * 0.5), mag);
}
/** Water fraction; bright pixels (snow on frozen lakes, sea ice, ice shelves) are never specular water. */
float earthWater(float mask, vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mask * (1.0 - smoothstep(0.14, 0.30, luma));
}
`;
