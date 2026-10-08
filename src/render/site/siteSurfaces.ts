import * as THREE from 'three';

/**
 * One material for (almost) the whole launch complex.
 *
 * The site used to draw one merged mesh per material (~25 materials, plus decals, lamps and runway ends): about
 * 30 draw calls in the main pass and a dozen in the shadow pass, at a point where draw submission is the
 * frame's largest CPU cost. Here every surface carries its look in vertex attributes instead:
 * - `color` (linear RGB tint), and `aSite` = (texture layer or −1, roughness, metalness, flags);
 * - flags = emissive class (0 none, 1 lit windows, 2 work lamps, 3 aviation beacons) + 4 × "assembly building"
 *   (hub hover highlight);
 * - textures are layers of one 512² sRGB array, filled from the existing procedural canvases on the GPU
 *   (`copyTextureToTexture`, canvas → layer: no canvas read-back, which privacy modes blank).
 *
 * The site is drawn as two meshes with this material (shadow casters and ground-hugging non-casters) and
 * the pad deck keeps its own 2048² texture.
 */
export const SITE_LAYERS = [
  'concrete', 'apron', 'soot', 'cladding', 'door', 'windows', 'windowLight', 'crawler', 'road', 'runway', 'signs',
  'logo', 'flag', 'runway09', 'runway27', 'grating',
] as const;
export type SiteLayer = (typeof SITE_LAYERS)[number];
export const layerIndex = (l: SiteLayer | null): number => (l ? SITE_LAYERS.indexOf(l) : -1);

const SIZE = 512;

export interface SiteSurfaceUniforms {
  uSiteTex: { value: THREE.DataArrayTexture };
  uWindowGlow: { value: THREE.Color };
  uLampColor: { value: THREE.Color };
  uBeaconColor: { value: THREE.Color };
  uVabGlow: { value: THREE.Color };
}

/** Array texture whose layers are filled from canvases on first use (needs the renderer, see `fill`). */
export class SiteTextureArray {
  readonly texture: THREE.DataArrayTexture;
  private pending: Map<SiteLayer, CanvasImageSource & { width: number; height: number }> | null;

  constructor(sources: Record<SiteLayer, CanvasImageSource & { width: number; height: number }>) {
    const t = new THREE.DataArrayTexture(null, SIZE, SIZE, SITE_LAYERS.length);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    // Storage only: the layers arrive through copyTextureToTexture.
    t.source.dataReady = false;
    t.needsUpdate = true;
    this.texture = t;
    this.pending = new Map(Object.entries(sources) as [SiteLayer, CanvasImageSource & { width: number; height: number }][]);
  }

  get ready(): boolean { return this.pending === null; }

  /** Upload every layer (once). Sources are resized and flipped (v up) through one 2D canvas. */
  fill(renderer: THREE.WebGLRenderer): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const t = this.texture;
    renderer.initTexture(t);
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d')!;
    const src = new THREE.CanvasTexture(c);
    src.flipY = false;
    src.colorSpace = THREE.SRGBColorSpace;
    const at = new THREE.Vector3();
    let n = 0;
    for (const [layer, image] of pending) {
      g.setTransform(1, 0, 0, -1, 0, SIZE);
      g.clearRect(0, 0, SIZE, SIZE);
      g.drawImage(image, 0, 0, SIZE, SIZE);
      // Mipmaps once, after the last layer.
      t.generateMipmaps = ++n === pending.size;
      at.set(0, 0, layerIndex(layer));
      renderer.copyTextureToTexture(src, t, null, at);
    }
    t.generateMipmaps = true;
    src.dispose();
  }

  dispose(): void { this.texture.dispose(); this.pending = null; }
}

/**
 * Patch a site `MeshStandardMaterial` (vertexColors on, no maps) to read its texture, roughness, metalness and
 * emission from the per-vertex attributes above. Chains after any existing `onBeforeCompile`.
 */
export function withSiteSurfaces(mat: THREE.MeshStandardMaterial, u: SiteSurfaceUniforms): THREE.MeshStandardMaterial {
  const prev = mat.onBeforeCompile;
  const window = SITE_LAYERS.indexOf('windowLight').toFixed(1);
  mat.vertexColors = true;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec4 aSite;\nvarying vec4 vSite;\nvarying vec2 vSiteUv;\nvoid main() {\n  vSite = aSite;\n  vSiteUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform highp sampler2DArray uSiteTex;
uniform vec3 uWindowGlow;
uniform vec3 uLampColor;
uniform vec3 uBeaconColor;
uniform vec3 uVabGlow;
varying vec4 vSite;
varying vec2 vSiteUv;
void main() {`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vSite.x >= 0.0) {
          vec4 siteTexel = texture(uSiteTex, vec3(vSiteUv, vSite.x));
          // Painted decals (wordmarks, runway ends) are alpha-cut; every other layer is opaque.
          if (siteTexel.a < 0.5) discard;
          diffuseColor.rgb *= siteTexel.rgb;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSite.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSite.z;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float siteFlags = vSite.w + 0.5;
          float emissiveClass = mod(siteFlags, 4.0) - 0.5;
          if (emissiveClass > 2.5) totalEmissiveRadiance += uBeaconColor;
          else if (emissiveClass > 1.5) totalEmissiveRadiance += uLampColor;
          else if (emissiveClass > 0.5) totalEmissiveRadiance += texture(uSiteTex, vec3(vSiteUv, ${window})).rgb * uWindowGlow;
          if (siteFlags > 4.0) totalEmissiveRadiance += uVabGlow;
        }`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|site-surfaces-v1`;
  return mat;
}

export function siteSurfaceUniforms(texture: THREE.DataArrayTexture): SiteSurfaceUniforms {
  return {
    uSiteTex: { value: texture },
    uWindowGlow: { value: new THREE.Color(0, 0, 0) },
    uLampColor: { value: new THREE.Color(0.6, 0.49, 0.34) },
    uBeaconColor: { value: new THREE.Color(0.4, 0.03, 0.02) },
    uVabGlow: { value: new THREE.Color(0, 0, 0) },
  };
}

/** Per-vertex surface description. */
export interface SiteSurface {
  layer: SiteLayer | null;
  /** Tint (sRGB hex, converted to linear). */
  color: number;
  roughness: number;
  metalness: number;
  /** 0 none, 1 windows (window-light layer), 2 lamps, 3 beacons. */
  emissive?: 0 | 1 | 2 | 3;
  vab?: boolean;
}

/** Write `color` and `aSite` for every vertex of `g` (non-indexed or indexed). */
export function paintSurface(g: THREE.BufferGeometry, s: SiteSurface): void {
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(s.color);
  const color = new Float32Array(n * 3), site = new Float32Array(n * 4);
  const flags = (s.emissive ?? 0) + (s.vab ? 4 : 0), layer = layerIndex(s.layer);
  for (let i = 0; i < n; i++) {
    color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
    site[i * 4] = layer; site[i * 4 + 1] = s.roughness; site[i * 4 + 2] = s.metalness; site[i * 4 + 3] = flags;
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aSite', new THREE.BufferAttribute(site, 4));
}
