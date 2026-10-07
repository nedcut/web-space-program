import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';

/**
 * Real Earth imagery (NASA Blue Marble Next Generation monthly colour, Black Marble night lights, the Blue
 * Marble cloud composite and a water mask), built by `scripts/earth-imagery/build.mjs` into
 * `public/earth/imagery/`. Levels 2k/4k are bundled (precached by the PWA, offline); 8k/16k are packs fetched
 * on demand and kept in Cache Storage. Every failure falls back to the next lower level, ultimately to the
 * procedural surface (`ready` stays false and shaders keep `uEarthImagery = 0`).
 *
 * Textures are shared between renderers by URL and reference counted. Shaders sample them with
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
const LEVEL_FOR: Record<EarthTextureQuality, string> = { low: '2k', medium: '4k', high: '8k', ultra: '16k' };
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

function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
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
interface Entry { refs: number; promise: Promise<THREE.Texture> }
const textures = new Map<string, Entry>();

/** URLs of a level's file(s) for one kind: several west→east tiles where the pattern has `{T}`. */
function urlsOf(level: ManifestLevel, kind: Kind, month: number): string[] {
  const pattern = level[kind];
  const tiles = pattern.includes('{T}') ? level.tiles : 1;
  const mm = String(month + 1).padStart(2, '0');
  return Array.from({ length: tiles }, (_, t) => root() + pattern.replace('{MM}', mm).replace('{T}', String(t)));
}

/** One decoded image as a texture, shared by URL between renderers (reference counted). */
function acquireTexture(url: string, kind: Kind): { key: string; promise: Promise<THREE.Texture> } {
  let entry = textures.get(url);
  if (!entry) {
    const persistent = url.includes('/packs/');
    const promise = fetchBlob(url, persistent).then(decode).then((image) => {
      const tex = new THREE.Texture(image as unknown as HTMLImageElement);
      tex.name = `earth:${kind}`;
      tex.flipY = false;
      tex.colorSpace = kind === 'day' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      // Single-channel masks upload as R8 (WebGL2 takes the red channel of an image source).
      if (kind !== 'day') tex.format = THREE.RedFormat;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      // Merge sources are sampled 1:1 (no mip chain to build); lights and clouds are minified.
      const sampled = kind === 'night' || kind === 'clouds';
      tex.minFilter = sampled ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      tex.generateMipmaps = sampled;
      // Isotropic for the cloud source: anisotropic taps keep the equirect polar streaks.
      tex.anisotropy = kind === 'clouds' ? 1 : 4;
      tex.needsUpdate = true;
      return tex;
    });
    entry = { refs: 0, promise };
    textures.set(url, entry);
    promise.catch(() => { if (textures.get(url) === entry) textures.delete(url); });
  }
  entry.refs++;
  return { key: url, promise: entry.promise };
}

function releaseTexture(key: string): void {
  const entry = textures.get(key);
  if (!entry || --entry.refs > 0) return;
  textures.delete(key);
  void entry.promise.then((t) => {
    t.dispose();
    (t.image as ImageBitmap | undefined)?.close?.();
  }, () => {});
}

/**
 * Colour (sRGB) + water mask → one RGBA8 sRGB render target with a hardware mip chain, so shaders take a
 * single (bicubic) fetch for both. Written in linear; the sRGB attachment re-encodes on store.
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

interface PendingMerge {
  level: ManifestLevel;
  month: number;
  day: THREE.Texture[];
  water: THREE.Texture;
  night: THREE.Texture | null;
  keys: string[];
  nightKey: string | null;
  target: THREE.WebGLRenderTarget | null;
  /** Next step: 2·tile uploads, 2·tile + 1 renders. */
  step: number;
}

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
  private shown: { level: ManifestLevel; month: number; rt: THREE.WebGLRenderTarget; nightKey: string | null } | null = null;
  private loading = false;
  private pending: PendingMerge | null = null;
  private wantedMonth = -1;
  private disposed = false;
  private settled = false;
  private cloudKey: string | null = null;
  private failedLevels = new Set<string>();
  private mergeScene: THREE.Scene | null = null;
  private mergeMat: THREE.ShaderMaterial | null = null;
  private readonly mergeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
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
    if (this.loading || this.pending || this.disposed || !this.target || this.wantedMonth < 0) return;
    const level = this.nextLevel();
    if (!level) { this.settled = true; return; }
    if (this.shown && this.shown.level === level && this.shown.month === this.wantedMonth) { this.settled = true; return; }
    this.loading = true;
    const month = this.wantedMonth;
    // Water masks above 8k cost more memory than they add: Ultra pairs 16k colour with the 8k mask.
    const waterLevel = level.width > 8192 ? (this.levels.filter((l) => l.width <= 8192).pop() ?? level) : level;
    const day = urlsOf(level, 'day', month).map((u) => acquireTexture(u, 'day'));
    const water = acquireTexture(urlsOf(waterLevel, 'water', month)[0], 'water');
    const night = this.opts.nightLights ? acquireTexture(urlsOf(level, 'night', month)[0], 'night') : null;
    const keys = [...day, water].map((p) => p.key);
    Promise.all([Promise.all(day.map((p) => p.promise)), water.promise, night?.promise ?? null]).then(([dayTex, waterTex, nightTex]) => {
      this.loading = false;
      if (this.disposed) { keys.forEach(releaseTexture); if (night) releaseTexture(night.key); return; }
      this.pending = { level, month, day: dayTex, water: waterTex, night: nightTex, keys, nightKey: night?.key ?? null, target: null, step: 0 };
    }, () => {
      this.loading = false;
      keys.forEach(releaseTexture);
      if (night) releaseTexture(night.key);
      if (this.disposed) return;
      this.failedLevels.add(level.id);
      this.pump();
    });
  }

  /** One GPU step per frame: upload a tile, or merge a tile into the RGBA target; then swap it in. */
  step(renderer: THREE.WebGLRenderer): void {
    const p = this.pending;
    if (!p || this.disposed) return;
    const tiles = p.day.length;
    if (p.step === 0) {
      // Allocation + the water mask upload.
      const w = p.level.width, h = p.level.height;
      p.target = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace,
        generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, anisotropy: 8,
      });
      p.target.texture.name = `earth:day+water:${p.level.id}`;
      renderer.initTexture(p.water);
    } else if (p.step <= 2 * tiles) {
      const t = Math.floor((p.step - 1) / 2);
      if ((p.step - 1) % 2 === 0) renderer.initTexture(p.day[t]);
      else this.mergeTile(renderer, p, t);
    }
    p.step++;
    if (p.step <= 2 * tiles) return;
    // Done: swap in the merged texture, keep only the lights.
    const previous = this.shown;
    this.shown = { level: p.level, month: p.month, rt: p.target!, nightKey: p.nightKey };
    this.uniforms.uEarthDay.value = p.target!.texture;
    if (p.night) this.uniforms.uEarthNight.value = p.night;
    this.uniforms.uEarthNightOn.value = p.night ? 1 : 0;
    this.uniforms.uEarthImagery.value = 1;
    // Imagery dominates once a texel is a few pixels on screen; the close-up palette takes over below.
    const texel = (2 * Math.PI * this.opts.radius) / p.level.width;
    this.uniforms.uEarthBlend.value.set(texel * 8, texel * 80);
    p.keys.forEach(releaseTexture);
    this.pending = null;
    if (previous) {
      previous.rt.dispose();
      if (previous.nightKey) releaseTexture(previous.nightKey);
    }
    this.pump();
  }

  private mergeTile(renderer: THREE.WebGLRenderer, p: PendingMerge, t: number): void {
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
    const rt = p.target!, tiles = p.day.length;
    const tw = rt.width / tiles;
    const u = this.mergeMat.uniforms;
    u.uDay.value = p.day[t];
    u.uWater.value = p.water;
    u.uRect.value.set(t * tw, tw, rt.width, rt.height);
    // Only the final tile regenerates the mip chain.
    rt.texture.generateMipmaps = t === tiles - 1;
    rt.viewport.set(t * tw, 0, tw, rt.height);
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
    const part = acquireTexture(urlsOf(lv, 'clouds', 0)[0], 'clouds');
    this.cloudKey = part.key;
    part.promise.then((t) => {
      if (this.disposed) return;
      this.cloudSource = t;
      this.cloudSourceSettled = true;
    }, () => { this.cloudSourceSettled = true; });
  }

  /** The cloud source is only needed for the one-time cube bake. */
  releaseCloudSource(): void {
    if (this.cloudKey) releaseTexture(this.cloudKey);
    this.cloudKey = null;
    this.cloudSource = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pending) {
      this.pending.keys.forEach(releaseTexture);
      if (this.pending.nightKey) releaseTexture(this.pending.nightKey);
      this.pending.target?.dispose();
      this.pending = null;
    }
    if (this.shown) {
      this.shown.rt.dispose();
      if (this.shown.nightKey) releaseTexture(this.shown.nightKey);
      this.shown = null;
    }
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
  return vec3(0.0035, 0.0105, 0.027) + earthAlbedo(excess) * 0.85;
}
/** Water fraction; bright pixels (snow on frozen lakes, sea ice, ice shelves) are never specular water. */
float earthWater(float mask, vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mask * (1.0 - smoothstep(0.14, 0.30, luma));
}
`;
