import * as THREE from 'three';
import { GLSL_NOISE, GLSL_LOGDEPTH_FRAG, GLSL_LOGDEPTH_FRAG_PARS, GLSL_LOGDEPTH_VERT, GLSL_LOGDEPTH_VERT_PARS } from '../core/glsl';
import { GLSL_ATMOSPHERE, GLSL_RING_SHADOW } from './shaders/atmosphere.glsl';
import type { PlanetUniforms } from './uniforms';
import type { QualitySettings } from '../core/quality';
import { siteShadowUniforms, GLSL_SITE_SHADOW } from '../site/shadows';
import { getDetailTexture } from './textures';
import { GLSL_CUTOUT, type TerrainCutoutUniforms } from './cutout';
import { GLSL_EARTH_IMAGERY, type EarthImageryUniforms } from './earthImagery';

/** Surface lighting shared by terrain / far sphere: Lambert ↔ Lommel–Seeliger (airless regolith). */
const GLSL_SHADE = /* glsl */ `
#ifdef EARTH_DETAILS
${GLSL_NOISE}
#endif
vec3 earthEmission(vec3 n, float height, float sunAltitude) {
  #ifdef EARTH_DETAILS
    if (height <= 2.0 || abs(n.z) > 0.92) return vec3(0.0);
    float night = 1.0 - smoothstep(-0.18, 0.02, sunAltitude);
    // Daylight: the lights below are multiplied by zero; skip five simplex evaluations per land pixel.
    if (night <= 0.0) return vec3(0.0);
    float coast = exp(-height / (uPlanetRadius * 0.0012));
    float population = smoothstep(-0.1, 0.45, fbm3(n * 18.0 + 7.1, 3));
    float metro = smoothstep(0.35, 0.78, snoise(n * 240.0));
    float towns = smoothstep(0.52, 0.85, snoise(n * 750.0));
    // Fine street networks inside settlements, wider diffuse glow around urban cores.
    vec2 streets = vec2(atan(n.y, n.x), asin(clamp(n.z, -1.0, 1.0))) * 3200.0;
    vec2 footprint = fwidth(streets);
    vec2 grid = abs(fract(streets) - 0.5);
    float roads = mix(0.16, 1.0 - smoothstep(0.035, 0.10, min(grid.x, grid.y)),
      1.0 - smoothstep(0.2, 1.0, max(footprint.x, footprint.y)));
    float lights = towns * (0.18 + roads * 0.82) + metro * 0.16;
    return vec3(1.0, 0.60, 0.27) * night * coast * population * lights * 2.4;
  #else
    return vec3(0.0);
  #endif
}
uniform float uAirless;
uniform float uAmbientFloor;
vec3 shadeSurface(vec3 albedo, vec3 N, vec3 V, vec3 rel) {
  vec3 L = uSunDir;
  float mu0 = max(dot(N, L), 0.0);
  float mu = max(dot(N, V), 0.02);
  float ls = 2.0 * mu0 / (mu0 + mu);
  float f = mix(mu0, ls, uAirless) / ATMO_PI;
  vec3 up = normalize(rel);
  float geo = smoothstep(-0.03, 0.03, dot(up, L));
  vec3 sunT = (uHasAtmo > 0.5 ? sunTransmittance(rel) : vec3(geo)) * ringShadow(rel) * cloudShadow(rel);
  vec3 direct = uSunColor * sunT * f;
  vec3 amb = skyAmbient(rel, N) / ATMO_PI;
  vec3 planetshine = uPlanetshineColor * max(dot(N, uPlanetshineDir), 0.0) / ATMO_PI;
  return albedo * (direct + amb + planetshine + uAmbientFloor);
}
`;

/** Shadows of the baked cloud layer on surfaces (one blurred cube-map fetch along the sun ray). */
const GLSL_CLOUD_SHADOW = /* glsl */ `
#ifdef CLOUD_SHADOWS
uniform samplerCube uCloudMap;
uniform mat3 uCloudRot;
uniform float uCloudShell;
float cloudShadow(vec3 rel) {
  if (uCloudShell <= 0.0) return 1.0;
  float r = length(rel);
  float mu = dot(rel, uSunDir) / r;
  if (mu <= 0.0) return 1.0;
  // Thin shell: flat-layer distance along the sun ray (no float32 |p|²−R² cancellation).
  vec3 p = rel + uSunDir * (max(uCloudShell - r, 0.0) / max(mu, 0.08));
  float d = texture(uCloudMap, uCloudRot * p, 1.0).r;
  return 1.0 - 0.78 * smoothstep(0.05, 0.85, d);
}
/** Blurred cloud cover straight above a point (weather proxy for wind; diffuses night lights). */
float cloudCover(vec3 rel) {
  if (uCloudShell <= 0.0) return 0.0;
  return texture(uCloudMap, uCloudRot * rel, 3.0).r;
}
#else
float cloudShadow(vec3 rel) { return 1.0; }
float cloudCover(vec3 rel) { return 0.0; }
#endif
`;

/**
 * Water as seen from altitude: Cox–Munk sea-surface slopes as GGX roughness (sun glint widens with wind),
 * Schlick Fresnel capped at grazing for unresolved facets, sky reflection and a lit water body.
 */
const GLSL_WATER = /* glsl */ `
float waterGGX(float NdH, float a) {
  float a2 = a * a;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (ATMO_PI * d * d);
}
/** Cox & Munk (1954): mean square slope 0.003 + 5.12e-3·W (wind m/s at 12.5 m) → GGX alpha ≈ rms slope. */
float coxMunkAlpha(float wind) { return sqrt(0.003 + 0.00512 * wind); }
/** Wind speed (m/s): doldrums, trades and westerlies by latitude; cloudy weather systems are windier. */
float seaWind(vec3 nBF, vec3 rel) {
  float s = abs(nBF.z);
  float w = mix(4.0, 7.0, smoothstep(0.05, 0.3, s)) + 3.5 * exp(-((s - 0.76) * (s - 0.76)) / 0.02) - 2.0 * smoothstep(0.9, 0.98, s);
  #if OCEAN_QUALITY >= 2
    w += 5.0 * smoothstep(0.25, 0.9, cloudCover(rel));
  #endif
  return w;
}
/** Cheap sky radiance seen in flat water: diffuse sky, brightening towards the horizon at grazing view. */
vec3 earthSkyReflApprox(vec3 skyAmb, vec3 up, vec3 V) {
  float mu = 1.0 - max(dot(up, V), 0.0);
  mu *= mu;
  return skyAmb / ATMO_PI * (1.0 + 1.5 * mu * mu);
}
vec3 shadeWater(vec3 bodyAlbedo, vec3 up, vec3 N, vec3 V, vec3 rel, vec3 skyRefl, float alpha, vec3 sunT, vec3 skyAmb) {
  vec3 L = uSunDir;
  float NdV = max(dot(N, V), 1e-3);
  float NdL = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0);
  float VdH = max(dot(V, H), 0.0);
  float k = alpha * 0.5;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  float Fs = 0.02 + 0.98 * pow(1.0 - VdH, 5.0);
  vec3 spec = min(uSunColor * sunT * waterGGX(NdH, alpha) * G * Fs / (4.0 * NdV), vec3(200.0));
  // Rough-surface Schlick: unresolved wave facets cap grazing reflectance of the sky.
  float F = 0.02 + 0.53 * pow(1.0 - NdV, 5.0);
  vec3 lightIn = uSunColor * sunT * max(dot(up, L), 0.0) / ATMO_PI + skyAmb / ATMO_PI;
  return mix(bodyAlbedo * lightIn, skyRefl, F) + spec;
}
`;


/**
 * Aerial perspective evaluated per vertex: in-scattering and transmittance vary smoothly along view
 * rays, so interpolating them across terrain/ocean triangles is visually equivalent to the per-pixel
 * march while costing per vertex instead of per (Retina) pixel.
 */
const GLSL_AERIAL_VERT = /* glsl */ `
${GLSL_ATMOSPHERE}
varying vec3 vAerialL;
varying vec3 vAerialT;
void computeAerial(vec3 worldPos) {
  vAerialL = vec3(0.0);
  vAerialT = vec3(1.0);
  if (uHasAtmo < 0.5) return;
  vec3 toCam = cameraPosition - worldPos;
  float dist = length(toCam);
  vec3 rd = -toCam / max(dist, 1e-3);
  vec2 seg = cameraAtmoSegment(rd, dist);
  if (seg.y > seg.x) {
    int steps = AERIAL_STEPS * uStepScale;
    // Nearly level, short rays cross almost homogeneous air: the segment's exponential
    // integration is exact at constant density. Include the chord's sag so a long
    // horizon ray cannot take the shortcut just because its endpoints have equal height.
    float span = abs(length(worldPos - uPlanetCenter) - length(uCamRel))
               + dist * dist / (8.0 * uPlanetRadius);
    #ifdef ADAPTIVE_AERIAL
    // Keep the full budget around sunset/night, where sunlight varies sharply
    // even along level rays, and on the richer atmosphere presets.
    if (uStepScale == 1 && dot(uCamRel, uSunDir) > 0.1 * length(uCamRel)) {
      if (span < uHm * 0.2) steps = 1;
      else if (span < uHm * 0.6) steps = min(steps, 2);
    }
    #endif
    integrateScattering(uCamRel, rd, seg.x, seg.y, steps, vAerialL, vAerialT);
  }
}
`;
/** Sky seen in the (mean) reflected direction of flat water: smooth across the surface, so per vertex. */
const GLSL_SKY_REFL_VERT = /* glsl */ `
varying vec3 vSkyRefl;
void computeSkyRefl(vec3 worldPos, vec3 up) {
  vSkyRefl = vec3(0.0);
  if (uHasAtmo < 0.5) return;
  vec3 rel = worldPos - uPlanetCenter;
  vec3 V = normalize(cameraPosition - worldPos);
  vec3 R = reflect(-V, up);
  R = normalize(R + up * 0.17);
  if (dot(R, up) < 0.03) R = normalize(R + up * (0.03 - dot(R, up)));
  vec2 ta = raySphereC(dot(rel, R), dot(rel, rel) - uAtmoRadius * uAtmoRadius);
  vec3 tr;
  integrateScattering(rel, R, 0.0, max(ta.y, 0.0), OCEAN_QUALITY >= 3 ? 10 : 6, vSkyRefl, tr);
}
`;
const GLSL_AERIAL_FRAG = /* glsl */ `
varying vec3 vAerialL;
varying vec3 vAerialT;
`;

/** Packed chunk normal: Int16 normalised octahedral pair (chunkBuilder `octEncode`), body-fixed. */
const GLSL_OCT_DECODE = /* glsl */ `
attribute vec2 aNormalOct;
vec3 octDecode(vec2 e) {
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t);
  return normalize(n);
}
`;

/**
 * The chunk matrix is a floating-origin transform, exactly as on an ordinary Mesh. Positions are relative to the
 * chunk's 1024 m-aligned origin, so they are also the seamless detail-texture coordinate.
 */
const GLSL_CHUNK_POSITION = /* glsl */ `
  vec4 localPosition = vec4(position, 1.0);
  #ifdef USE_BATCHING
    localPosition = getBatchingMatrix(getIndirectIndex(gl_DrawID)) * localPosition;
  #endif
  vec4 wp = modelMatrix * localPosition;
`;

function baseHeader(): string {
  return GLSL_ATMOSPHERE + GLSL_RING_SHADOW + GLSL_CLOUD_SHADOW + GLSL_WATER + GLSL_IMAGERY_DECL;
}

/** Planets whose surface materials receive cloud shadows (decided before their materials are built). */
const cloudShadowed = new WeakSet<PlanetUniforms>();
export function enableCloudShadows(u: PlanetUniforms): void { cloudShadowed.add(u); }

/** Earth materials that sample real imagery (decided before their materials are built). */
const earthImagery = new WeakMap<PlanetUniforms, EarthImageryUniforms>();
export function enableEarthImagery(u: PlanetUniforms, imagery: EarthImageryUniforms): void { earthImagery.set(u, imagery); }
/** Imagery uniforms to spread into a surface material (empty for bodies without imagery). */
function imageryUniforms(u: PlanetUniforms): Partial<EarthImageryUniforms> { return earthImagery.get(u) ?? {}; }

const OCEAN_LEVEL = { low: 0, medium: 1, high: 2, ultra: 3 } as const;

function defines(q: QualitySettings, u?: PlanetUniforms): Record<string, string | number> {
  return { AERIAL_STEPS: q.atmosphere.aerialSteps, VIEW_STEPS: q.atmosphere.viewSteps, DETAIL_OCTAVES: q.planetDetails.gasOctaves,
    ...(q.atmosphere.aerialSteps <= 6 ? { ADAPTIVE_AERIAL: 1 } : {}),
    OCEAN_QUALITY: OCEAN_LEVEL[q.earth.oceanQuality],
    ...(u && cloudShadowed.has(u) ? { CLOUD_SHADOWS: 1 } : {}) };
}
/** Define + uniforms for the three Earth surface materials (terrain, ocean, far sphere). */
function imagery(u: PlanetUniforms, q: QualitySettings): { defines: Record<string, number>; uniforms: Partial<EarthImageryUniforms> } {
  if (!earthImagery.has(u)) return { defines: {}, uniforms: {} };
  // High/Ultra: bicubic magnification and marched sky reflection on coast water drawn by terrain.
  const rich = q.earth.textureQuality === 'high' || q.earth.textureQuality === 'ultra';
  return { defines: { EARTH_IMAGERY: 1, ...(rich ? { EARTH_RICH: 1 } : {}) }, uniforms: imageryUniforms(u) };
}

/** Imagery declarations: only Earth materials compile them. */
const GLSL_IMAGERY_DECL = /* glsl */ `
#ifdef EARTH_IMAGERY
${GLSL_EARTH_IMAGERY}
/**
 * Black Marble city lights: sRGB-encoded radiance, decoded and lifted to HDR. Sodium-orange in dim suburbs,
 * whiter in saturated cores; dimmed and spread under cloud. Close-up street texture comes from earthEmission.
 */
vec3 earthNightLights(EarthUV e, float sunAltitude, vec3 rel) {
  float night = 1.0 - smoothstep(-0.11, 0.025, sunAltitude);
  if (night <= 0.0 || uEarthNightOn < 0.5) return vec3(0.0);
  float s = textureGrad(uEarthNight, e.uv, e.dx, e.dy).r;
  float L = s * s * (0.35 + 0.65 * s);
  vec3 tint = mix(vec3(1.0, 0.52, 0.2), vec3(1.0, 0.8, 0.58), smoothstep(0.45, 1.0, s));
  return tint * L * night * 1.6 * (1.0 - 0.75 * smoothstep(0.2, 0.9, cloudCover(rel)));
}
#endif
`;

// ---------------------------------------------------------------- Terrain

export interface TerrainMaterialOptions {
  rockColor: [number, number, number];
  rockBlend: number;
  airless: number;
  detail: boolean;
  /** Body-fixed detail texture scale multiplier. */
  detailStrength: number;
  /** Optional ground cutouts (launch pad / flame trench) where terrain fragments are discarded. */
  cutout?: TerrainCutoutUniforms;
  duneRipples?: boolean;
}

export function createTerrainMaterial(u: PlanetUniforms, q: QualitySettings, o: TerrainMaterialOptions): THREE.ShaderMaterial {
  const img = imagery(u, q);
  return new THREE.ShaderMaterial({
    defines: { ...defines(q, u), ...img.defines, ...(o.detail ? { USE_DETAIL: 1 } : {}), ...(o.cutout ? { USE_CUTOUT: 1 } : {}) },
    uniforms: {
      ...u,
      ...img.uniforms,
      ...(o.cutout ?? {}),
      ...siteShadowUniforms,
      uDetailTex: { value: getDetailTexture() },
      uRockColor: { value: new THREE.Vector3(...o.rockColor) },
      uRockBlend: { value: o.rockBlend },
      uAirless: { value: o.airless },
      uAmbientFloor: { value: 0.004 },
      uDetailStrength: { value: o.detailStrength },
      uDuneRipples: { value: o.duneRipples ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      attribute vec4 aColor;
      #include <batching_pars_vertex>
      ${GLSL_OCT_DECODE}
      varying vec3 vWorldPos;
      varying vec3 vNormalBF;
      varying vec3 vColor;
      varying vec3 vDetail;
      ${GLSL_AERIAL_VERT}
      #ifdef EARTH_RICH
      ${GLSL_SKY_REFL_VERT}
      #endif
      #ifdef EARTH_IMAGERY
      uniform mat3 uBodyRot;
      uniform sampler2D uEarthDay;
      uniform float uEarthImagery;
      varying float vCovered;
      #endif
      void main() {
        ${GLSL_CHUNK_POSITION}
        vWorldPos = wp.xyz;
        vNormalBF = octDecode(aNormalOct);
        vColor = aColor.rgb * aColor.rgb; // stored gamma-2 encoded
        vDetail = position;
        computeAerial(wp.xyz);
        #ifdef EARTH_IMAGERY
          // Imagery water drawn by terrain must match the ocean mesh beside it. Only vertices near the
          // datum with water nearby (coarse mip of the mask) can draw it.
          #ifdef EARTH_RICH
            vSkyRefl = vec3(0.0);
          #endif
          vCovered = 0.0;
          vec3 relV = wp.xyz - uPlanetCenter;
          float hV = length(relV) - uPlanetRadius;
          #ifdef EARTH_RICH
            const float COAST_TEST = 1200.0; // coast sky reflection needs the mask above the datum too
          #else
            const float COAST_TEST = -10.0;  // only the covered test: land vertices skip the lookup
          #endif
          if (uEarthImagery > 0.5 && hV < COAST_TEST) {
            vec3 nV = normalize(transpose(uBodyRot) * relV);
            vec2 uvV = vec2(atan(nV.y, nV.x) * (0.5 / ATMO_PI) + 0.5, 0.5 - asin(clamp(nV.z, -1.0, 1.0)) / ATMO_PI);
            vec4 coarse = textureLod(uEarthDay, uvV, 5.0);
            float waterNear = coarse.a;
            #ifdef EARTH_RICH
              if (hV > -200.0 && waterNear > 0.002) computeSkyRefl(wp.xyz, normalize(relV));
            #endif
            // Deep under open water: the opaque ocean mesh covers this vertex (mask agrees, no shore nearby).
            // Sea ice is bright: there the ocean steps aside and this terrain draws the ice.
            float iceV = dot(coarse.rgb, vec3(0.2126, 0.7152, 0.0722));
            // 10 m below the datum the ocean mesh's own depth exceeds its ±2 m shoreline noise, so it never
            // steps aside there (scaled relief puts most continental shelves only ~20 m down).
            vCovered = hV < -10.0 && waterNear > 0.995 && iceV < 0.1 ? 1.0 : 0.0;
          }
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      ${GLSL_SHADE}
      uniform mat3 uBodyRot;
      uniform sampler2D uDetailTex;
      uniform vec3 uRockColor;
      uniform float uRockBlend;
      uniform float uDetailStrength;
      uniform float uDuneRipples;
      ${GLSL_AERIAL_FRAG}
      ${GLSL_SITE_SHADOW}
      #ifdef EARTH_IMAGERY
      varying float vCovered;
      #endif
      #ifdef EARTH_RICH
      varying vec3 vSkyRefl;
      #endif
      varying vec3 vWorldPos;
      varying vec3 vNormalBF;
      varying vec3 vColor;
      varying vec3 vDetail;
      #ifdef USE_CUTOUT
      ${GLSL_CUTOUT}
      #endif

      vec4 triSample(vec3 p, vec3 w, float scale) {
        vec4 a = texture2D(uDetailTex, p.yz / scale);
        vec4 b = texture2D(uDetailTex, p.zx / scale);
        vec4 c = texture2D(uDetailTex, p.xy / scale);
        return a * w.x + b * w.y + c * w.z;
      }
      vec3 triGrad(vec3 p, vec3 w, float scale) {
        vec2 a = texture2D(uDetailTex, p.yz / scale).gb - 0.5;
        vec2 b = texture2D(uDetailTex, p.zx / scale).gb - 0.5;
        vec2 c = texture2D(uDetailTex, p.xy / scale).gb - 0.5;
        return vec3(0.0, a.x, a.y) * w.x + vec3(b.y, 0.0, b.x) * w.y + vec3(c.x, c.y, 0.0) * w.z;
      }
      // Colour/coverage and slope use the same triplanar coordinates. Share
      // their fetches while preserving the original cyclic accumulation order.
      vec4 triSampleGrad(vec3 p, vec3 w, float scale, bool cyclic, out vec3 grad) {
        vec4 a = texture2D(uDetailTex, p.yz / scale);
        vec4 b = texture2D(uDetailTex, p.zx / scale);
        vec4 c = texture2D(uDetailTex, p.xy / scale);
        vec2 ga = a.gb - 0.5, gb = b.gb - 0.5, gc = c.gb - 0.5;
        grad = vec3(0.0, ga.x, ga.y) * w.x + vec3(gb.y, 0.0, gb.x) * w.y + vec3(gc.x, gc.y, 0.0) * w.z;
        return cyclic ? b * w.y + c * w.z + a * w.x : a * w.x + b * w.y + c * w.z;
      }

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 rel = vWorldPos - uPlanetCenter;
        #ifdef EARTH_IMAGERY
          // Only distant or night-side terrain uses imagery. Both conditions are smooth across the screen, so
          // quads agree on the branch and the derivatives inside it stay well defined (taken before any discard).
          vec3 nDir = vec3(0.0, 0.0, 1.0), nDx = vec3(0.0), nDy = vec3(0.0);
          bool imgUsed = uEarthImagery > 0.5 && (length(cameraPosition - vWorldPos) > uEarthBlend.x * 0.9 || dot(rel, uSunDir) < 0.04 * length(rel));
          if (imgUsed) {
            nDir = normalize(transpose(uBodyRot) * rel);
            nDx = dFdx(nDir); nDy = dFdy(nDir);
          }
          EarthUV eUV;
        #endif
        #ifdef USE_CUTOUT
        applyCutout(vWorldPos);
        #endif
        #ifdef EARTH_IMAGERY
          // Under open water the opaque ocean mesh always draws over this fragment; log depth defeats early-Z,
          // so without this the full terrain shading would run and be overwritten.
          if (vCovered > 0.999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        #endif
        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 nBF = normalize(vNormalBF);
        vec3 N = normalize(uBodyRot * nBF);
        vec3 up = normalize(rel);
        float slope = 1.0 - dot(N, up);
        vec3 albedo = vColor;
        float rockT = smoothstep(0.18, 0.42, slope) * uRockBlend;
        #ifdef USE_DETAIL
          vec3 w = abs(nBF); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);
          float f1 = 1.0 - smoothstep(60.0, 400.0, dist);
          float f2 = 1.0 - smoothstep(500.0, 3000.0, dist);
          float f3 = 1.0 - smoothstep(6000.0, 40000.0, dist);
          float hd = 0.0;
          float cover = 0.5;
          vec3 g = vec3(0.0);
          // Three octaves; the large one uses the decorrelated A channel to hide tiling.
          vec3 grad;
          if (f3 > 0.0) { vec4 s = triSample(vDetail.zxy, w.zxy, 1024.0); vec4 s2 = triSampleGrad(vDetail, w, 256.0, false, grad); cover = s.a * 0.6 + s2.a * 0.4; hd += ((s.a - 0.5) * 0.7 + (s2.a - 0.5) * 0.5) * f3; g += grad * f3 * 0.35; }
          if (f2 > 0.0) { vec4 s = triSampleGrad(vDetail, w, 32.0, true, grad); hd += (s.r - 0.5) * f2 * 0.6; g += grad * f2 * 0.6; }
          if (f1 > 0.0) { vec4 s = triSampleGrad(vDetail, w, 4.0, false, grad); hd += (s.r - 0.5) * f1 * 0.5; g += grad * f1; }
          float microFade = 1.0 - smoothstep(15.0, 100.0, dist);
          if (microFade > 0.0) g += triGrad(vDetail, w, 0.5) * microFade * 0.35;
          // Shallow wind ripples, projected into the tangent plane below; no collision relief.
          g += vec3(cos(vDetail.x * 6.2831853 + sin(vDetail.y * 0.09817477)) * 0.12, 0.0, 0.0) * uDuneRipples * f1;
          // Muted grass, dry thatch and exposed sand share the existing octave fetches.
          // Large patch colours survive at 2 km; small grains fade before they can shimmer.
          #ifdef EARTH_DETAILS
            float green = smoothstep(1.05, 1.35, vColor.g / max(vColor.r, 0.001));
            float dry = smoothstep(0.48, 0.70, cover) * green * f3;
            albedo = mix(albedo, vec3(0.24, 0.205, 0.105), dry * 0.28);
            albedo *= 1.0 + hd * 0.85 * uDetailStrength;
          #else
            albedo *= 1.0 + hd * 0.95 * uDetailStrength;
          #endif
          rockT = clamp(rockT + hd * 0.4 * uRockBlend, 0.0, 1.0);
          vec3 gt = g - dot(g, nBF) * nBF;
          nBF = normalize(nBF - gt * 1.6 * uDetailStrength);
          N = normalize(uBodyRot * nBF);
        #endif
        albedo = mix(albedo, uRockColor * (0.85 + 0.3 * albedo / max(max(albedo.r, albedo.g), 0.05)), rockT);
        #ifdef EARTH_IMAGERY
          // Imagery owns the colour wherever a texel is small on screen; the close-up palette takes over below.
          float wImg = imgUsed ? smoothstep(uEarthBlend.x, uEarthBlend.y, dist) : 0.0;
          // Terrain well below the datum is always under the opaque ocean (log depth defeats early-Z, so
          // these hidden fragments would otherwise pay for the imagery too).
          float waterW = 0.0;
          if (wImg > 0.0) {
            eUV = earthUVd(nDir, nDx, nDy);
            vec4 dayW = earthTex(uEarthDay, eUV);
            vec3 c = dayW.rgb;
            vec3 img = earthAlbedo(c);
            #ifdef USE_DETAIL
              img *= 1.0 + hd * 0.6 * uDetailStrength;
            #endif
            waterW = earthCoast(earthWater(dayW.a, c), eUV) * wImg;
            albedo = mix(albedo, mix(img, earthWaterAlbedo(c), waterW), wImg);
          }
        #endif
        vec3 col = shadeSurface(albedo, N, V, rel);
        #ifdef EARTH_IMAGERY
          // Coasts follow the imagery from altitude: water the terrain mesh still has above its datum.
          if (waterW > 0.0) {
            vec3 sunT = sunTransmittance(rel) * cloudShadow(rel);
            vec3 skyAmb = skyAmbient(rel, up);
            #ifdef EARTH_RICH
              vec3 skyR = vSkyRefl;
            #else
              vec3 skyR = earthSkyReflApprox(skyAmb, up, V);
            #endif
            vec3 water = shadeWater(albedo, up, up, V, rel, skyR, coxMunkAlpha(seaWind(nDir, rel)), sunT, skyAmb);
            col = mix(col, water, waterW);
          }
        #endif
        #ifdef EARTH_DETAILS
          col *= mix(0.42, 1.0, siteShadow(vWorldPos));
        #endif
        #ifdef EARTH_IMAGERY
          float sunAlt = dot(up, uSunDir);
          vec3 lightsImg = vec3(0.0);
          if (imgUsed && sunAlt < 0.025) lightsImg = earthNightLights(earthUVd(nDir, nDx, nDy), sunAlt, rel);
          // Close up, the procedural street texture breaks the 3 km light pixels into streets.
          float streets = 1.0 - smoothstep(uEarthBlend.x * 0.5, uEarthBlend.x * 2.0, dist);
          col += lightsImg * (1.0 - streets) * (1.0 - waterW);
          if (streets > 0.0 && dot(lightsImg, lightsImg) > 0.0) col += earthEmission(nDir, length(rel) - uPlanetRadius, sunAlt) * streets * min(1.0, lightsImg.r * 3.0);
        #else
          col += earthEmission(normalize(transpose(uBodyRot) * rel), length(rel) - uPlanetRadius, dot(up, uSunDir));
        #endif
        col = col * vAerialT + vAerialL;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Instanced cell-local assets, using the same solar lighting and aerial perspective as terrain. */
export function createScatterMaterial(u: PlanetUniforms, q: QualitySettings, centers: THREE.DataTexture, color: number[], plant: boolean, radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { ...defines(q, u), ...(plant ? { PLANT_WIND: 1 } : {}) },
    uniforms: { ...u, uCenters: { value: centers }, uColor: { value: new THREE.Vector3(...color) }, uAirless: { value: plant ? 0 : 0.65 }, uAmbientFloor: { value: 0.004 }, uRange: { value: radius } },
    side: plant ? THREE.DoubleSide : THREE.FrontSide,
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      uniform sampler2D uCenters;
      uniform float uTime;
      attribute float aCell;
      attribute vec3 color;
      varying vec3 vTint;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vTint = color;
        vec3 centre = texture2D(uCenters, vec2((aCell + 0.5) / 2048.0, 0.5)).xyz;
        vec3 swaying = position;
        #ifdef PLANT_WIND
          swaying.x += sin(mod(uTime, 4096.0) + instanceMatrix[3].x + position.y * 2.0) * position.y * 0.025;
        #endif
        vec4 local = instanceMatrix * vec4(swaying, 1.0);
        vec4 wp = modelMatrix * vec4(local.xyz + centre, 1.0);
        vWorldPos = wp.xyz;
        // Inverse transpose for the non-uniform instance scale (rotation columns are orthogonal).
        mat3 basis = mat3(instanceMatrix);
        vec3 scaleSquared = vec3(dot(basis[0], basis[0]), dot(basis[1], basis[1]), dot(basis[2], basis[2]));
        vNormal = normalize(mat3(modelMatrix) * basis * (normal / max(scaleSquared, vec3(1e-12))));
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      ${GLSL_SHADE}
      uniform vec3 uColor;
      varying vec3 vTint;
      uniform float uRange;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 delta = cameraPosition - vWorldPos;
        float dist = length(delta);
        // Screen-door fade avoids sorting thousands of small silhouettes.
        float fade = 1.0 - smoothstep(uRange * 0.65, uRange, dist);
        float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
        if (grain > fade) discard;
        vec3 V = delta / max(dist, 0.001);
        vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 col = shadeSurface(uColor * vTint, N, V, vWorldPos - uPlanetCenter);
        col = applyAerialPerspective(col, -V, dist, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- Ocean

export function createOceanMaterial(u: PlanetUniforms, q: QualitySettings, seabed: [number, number, number], hydrocarbon = false): THREE.ShaderMaterial {
  const img = imagery(u, q);
  return new THREE.ShaderMaterial({
    defines: { ...defines(q, u), ...img.defines },
    uniforms: {
      ...u,
      ...img.uniforms,
      uDetailTex: { value: getDetailTexture() },
      uSeabed: { value: new THREE.Vector3(...seabed) },
      uHydrocarbon: { value: hydrocarbon ? 1 : 0 },
      uDeep: { value: hydrocarbon ? new THREE.Vector3(0.003, 0.004, 0.002) : new THREE.Vector3(0.002, 0.011, 0.03) },
      uShallow: { value: new THREE.Vector3(0.01, 0.07, 0.075) },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      attribute float aDepth;
      #include <batching_pars_vertex>
      ${GLSL_OCT_DECODE}
      varying vec3 vWorldPos;
      varying vec3 vUpBF;
      varying float vDepth;
      varying vec3 vDetail;
      uniform mat3 uBodyRot;
      #ifdef EARTH_IMAGERY
      uniform float uEarthImagery;
      uniform vec2 uEarthBlend;
      #endif
      ${GLSL_AERIAL_VERT}
      ${GLSL_SKY_REFL_VERT}
      void main() {
        ${GLSL_CHUNK_POSITION}
        vWorldPos = wp.xyz;
        vec3 upBF = octDecode(aNormalOct);
        vUpBF = upBF;
        vDepth = aDepth;
        vDetail = position;
        computeAerial(wp.xyz);
        #if defined(EARTH_IMAGERY) && !defined(EARTH_RICH)
          // From altitude Medium blends to the analytic reflection: only march where it is still visible.
          if (uEarthImagery < 0.5 || distance(cameraPosition, wp.xyz) < uEarthBlend.y) computeSkyRefl(wp.xyz, normalize(uBodyRot * upBF));
          else vSkyRefl = vec3(0.0);
        #else
          computeSkyRefl(wp.xyz, normalize(uBodyRot * upBF));
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      uniform mat3 uBodyRot;
      uniform sampler2D uDetailTex;
      uniform float uHydrocarbon;
      uniform vec3 uSeabed;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      ${GLSL_AERIAL_FRAG}
      varying vec3 vSkyRefl;
      varying vec3 vWorldPos;
      varying vec3 vUpBF;
      varying float vDepth;
      varying vec3 vDetail;

      vec3 waveGrad(vec3 p, vec3 w, float scale, vec2 drift) {
        vec2 a = texture2D(uDetailTex, (p.yz + drift) / scale).gb - 0.5;
        vec2 b = texture2D(uDetailTex, (p.zx + drift.yx) / scale).gb - 0.5;
        vec2 c = texture2D(uDetailTex, (p.xy - drift) / scale).gb - 0.5;
        return vec3(0.0, a.x, a.y) * w.x + vec3(b.y, 0.0, b.x) * w.y + vec3(c.x, c.y, 0.0) * w.z;
      }

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 upBF = normalize(vUpBF);
        #ifdef EARTH_IMAGERY
          vec3 nDx = dFdx(upBF), nDy = dFdy(upBF);
          EarthUV eUV;
        #endif
        vec3 w = abs(upBF); w = w * w; w *= w; w /= (w.x + w.y + w.z);
        // Flat coasts are tessellated coarsely (little geometric error), so the interpolated depth's zero
        // crossing would follow triangle edges. Perturb it with world-space noise (≈600 m and 90 m) for an
        // organic shoreline; only shallow water moves.
        float shore = 0.0;
        if (vDepth < 4.0) {
          float n1 = texture2D(uDetailTex, vDetail.yz / 600.0).a * w.x + texture2D(uDetailTex, vDetail.zx / 600.0).a * w.y + texture2D(uDetailTex, vDetail.xy / 600.0).a * w.z;
          float n2 = texture2D(uDetailTex, vDetail.yz / 90.0).r * w.x + texture2D(uDetailTex, vDetail.zx / 90.0).r * w.y + texture2D(uDetailTex, vDetail.xy / 90.0).r * w.z;
          shore = (n1 - 0.5) * 3.0 + (n2 - 0.5) * 1.0;
        }
        float depth = vDepth + shore;
        float meshDepth = depth;
        vec3 rel = vWorldPos - uPlanetCenter;
        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        #ifdef EARTH_IMAGERY
          // From altitude the coastline follows the imagery mask (the mesh follows the coarser relief grid);
          // land showing through reveals the terrain just below the datum, coloured by the same imagery.
          float wImg = uEarthImagery * smoothstep(uEarthBlend.x, uEarthBlend.y, dist);
          vec3 dayC = vec3(0.0);
          float maskW = 1.0;
          if (wImg > 0.0) {
            eUV = earthUVd(upBF, nDx, nDy);
            vec4 dayW = earthTex(uEarthDay, eUV);
            dayC = dayW.rgb;
            maskW = earthCoast(earthWater(dayW.a, dayC), eUV);
            depth = mix(depth, (maskW - 0.5) * 40.0, wImg);
          }
        #endif
        if (depth <= 0.0) discard;
        vec3 V = toCam / dist;
        float t = uTime;
        float fade1 = 1.0 - smoothstep(200.0, 2000.0, dist);
        float fade2 = 1.0 - smoothstep(2000.0, 30000.0, dist);
        #if OCEAN_QUALITY == 0
          vec3 g = vec3(0.0);
        #else
          // Faded octaves are skipped, not multiplied by zero: from orbit every water pixel is beyond both fades.
          vec3 g = vec3(0.0);
          if (fade1 > 0.0) g += waveGrad(vDetail, w, 64.0, vec2(t * 1.3, t * 0.7)) * fade1
                              + waveGrad(vDetail, w, 23.0, vec2(-t * 0.9, t * 1.6)) * fade1 * 0.7;
          if (fade2 > 0.0) g += waveGrad(vDetail, w, 512.0, vec2(t * 2.0, -t * 1.1)) * fade2 * 0.6;
        #endif
        if (uHydrocarbon > 0.5) {
          g *= 0.18;
          vec3 cell = fract(vDetail / 3.0) - 0.5;
          float rain = sin(length(cell) * 70.0 - t * 9.0) * exp(-length(cell)*7.0);
          g += cell * rain * 0.09 * fade1;
        }
        g -= dot(g, upBF) * upBF;
        vec3 nBF = normalize(upBF - g * 0.9);
        vec3 N = normalize(uBodyRot * nBF);
        vec3 up = normalize(uBodyRot * upBF);
        vec3 L = uSunDir;
        float NdV = max(dot(N, V), 0.001);
        float NdL = max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 0.0);
        // Rough-surface Schlick: unresolved wave facets cap grazing reflectance.
        float F = 0.02 + (0.55 - 0.02) * pow(1.0 - NdV, 5.0);
        if (uHydrocarbon > 0.5) {
          // The optically thick methane haze is dominated by diffuse light. A bounded
          // analytic sky reflection avoids an under-resolved six-step reflected-ray march.
          float day = smoothstep(-0.25, 0.2, dot(up, L));
          vec3 haze = vec3(0.34, 0.205, 0.085) * day;
          // Low omits volumetric detail. Integrate the broad, overcast sky lobe
          // analytically instead of multiplying all diffuse light by a 2% Fresnel
          // term. Keep solar elevation in the term so night remains dark.
          float diffuseReflection = 0.22 + 0.12 * (1.0 - NdV);
          float glint = pow(NdH, 800.0) * NdL * 0.12;
          vec3 hydro = uDeep * (0.15 + day) + haze * (diffuseReflection + F + glint);
          hydro = mix(hydro, haze * 0.55, 1.0-exp(-dist/16000.0));
          gl_FragColor = vec4(hydro, 1.0);
          return;
        }
        vec3 sunT = sunTransmittance(rel) * ringShadow(rel) * cloudShadow(rel);
        // Resolved waves up close; Cox–Munk slope statistics once individual waves are sub-pixel.
        float alpha = mix(0.07, coxMunkAlpha(seaWind(upBF, rel)), smoothstep(400.0, 25000.0, dist));
        vec3 skyAmb = skyAmbient(rel, up);
        // Water body colour: absorption with depth, lit by sun + sky.
        float depthT = 1.0 - exp(-depth / 18.0);
        vec3 water = mix(uShallow, uDeep, depthT);
        #ifdef EARTH_IMAGERY
          // Shallow banks, river plumes and lakes carry their real colour from altitude.
          if (wImg > 0.0) water = mix(water, earthWaterAlbedo(dayC), wImg);
        #endif
        vec3 skyR = vSkyRefl;
        #if defined(EARTH_IMAGERY) && !defined(EARTH_RICH)
          // Same reflection model as imagery water drawn by terrain beside it (no seam along mesh coasts).
          skyR = mix(skyR, earthSkyReflApprox(skyAmb, up, V), wImg);
        #endif
        vec3 col = shadeWater(water, up, N, V, rel, skyR, alpha, sunT, skyAmb);
        vec3 lightIn = uSunColor * sunT * max(dot(up, L), 0.0) / ATMO_PI + skyAmb / ATMO_PI;
        // Seabed and surf follow the mesh's own shoreline; from altitude the imagery carries the shallows.
        float shallowW = 1.0 - smoothstep(0.0, 6.0, max(meshDepth, 0.0));
        #ifdef EARTH_IMAGERY
          shallowW *= 1.0 - wImg;
        #endif
        vec3 bed = uSeabed * lightIn * exp(-max(meshDepth, 0.0) * vec3(0.45, 0.12, 0.06));
        col = mix(col, bed + vSkyRefl * F, shallowW);
        col += lightIn * 0.4 * (1.0 - uHydrocarbon) * (1.0 - smoothstep(0.0, 0.6, meshDepth)) * fade1;
        #ifdef EARTH_IMAGERY
          // Lit ships, platforms and coastal cities over water pixels of the light map.
          if (dot(up, uSunDir) < 0.025) col += earthNightLights(earthUVd(upBF, nDx, nDy), dot(up, uSunDir), rel) * 0.6;
        #endif
        col = col * vAerialT + vAerialL;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- Far sphere (baked texture)

export function createFarSphereMaterial(u: PlanetUniforms, q: QualitySettings, opts: { airless: number; ocean: boolean; minH: number; maxH: number; texWidth: number; irregular?: boolean }): THREE.ShaderMaterial {
  const img = imagery(u, q);
  return new THREE.ShaderMaterial({
    defines: { ...defines(q, u), ...img.defines },
    uniforms: {
      ...u,
      ...img.uniforms,
      uMap: { value: null as THREE.Texture | null },
      uHasMap: { value: 0 },
      uFallback: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
      uAirless: { value: opts.airless },
      uAmbientFloor: { value: 0.004 },
      uOcean: { value: opts.ocean ? 1 : 0 },
      uHRange: { value: new THREE.Vector2(opts.minH, opts.maxH) },
      uTexel: { value: new THREE.Vector2(2 / opts.texWidth, 4 / opts.texWidth) },
      uBump: { value: opts.irregular ? 1 : 3.0 },
      uIrregular: { value: opts.irregular ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorldPos;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      ${GLSL_SHADE}
      uniform mat3 uBodyRot;
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform vec3 uFallback;
      uniform float uOcean;
      uniform vec2 uHRange;
      uniform vec2 uTexel;
      uniform float uBump;
      uniform float uIrregular;
      varying vec3 vWorldPos;
      varying vec3 vObj;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 n = normalize(vObj);
        #ifdef EARTH_IMAGERY
          EarthUV eUV = earthUV(n);
        #endif
        float lon = atan(n.y, n.x);
        float lat = asin(clamp(n.z, -1.0, 1.0));
        vec2 uv = vec2(lon / (2.0 * ATMO_PI) + 0.5, lat / ATMO_PI + 0.5);
        vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
        vec2 dx = dFdx(uv), dy = dFdy(uv);
        vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
        if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
        vec3 albedo = uFallback;
        vec3 nBF = n;
        float h = uIrregular > 0.5 ? (length(vObj) - 1.0) * uPlanetRadius : 0.0;
        if (uHasMap > 0.5) {
          vec4 s = textureGrad(uMap, uv, dx, dy);
          albedo = s.rgb;
          h = mix(uHRange.x, uHRange.y, s.a);
          float he = mix(uHRange.x, uHRange.y, textureGrad(uMap, uv + vec2(uTexel.x, 0.0), dx, dy).a);
          float hn = mix(uHRange.x, uHRange.y, textureGrad(uMap, uv + vec2(0.0, uTexel.y), dx, dy).a);
          float cl = max(cos(lat), 0.05);
          vec3 east = vec3(-sin(lon), cos(lon), 0.0);
          vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
          float dE = (he - h) / (uTexel.x * 2.0 * ATMO_PI * uPlanetRadius * cl);
          float dN = (hn - h) / (uTexel.y * ATMO_PI * uPlanetRadius);
          bool water = uOcean > 0.5 && h < 0.0;
          if (!water) nBF = normalize(n - (east * dE + north * dN) * uBump);
        }
        // Exact-sphere position (see gas giant note on tessellation sag).
        vec3 rel = normalize(uBodyRot * n) * (uPlanetRadius + (uIrregular > 0.5 ? h : max(h, 0.0)));
        vec3 toCam = uCamRel - rel;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 N = normalize(uBodyRot * nBF);
        vec3 col;
        float waterW = uOcean > 0.5 && h < 0.0 ? 1.0 : 0.0;
        vec3 waterAlbedo = mix(vec3(0.01, 0.07, 0.075), vec3(0.002, 0.011, 0.03), 1.0 - exp(-(-h) / 18.0));
        #ifdef EARTH_IMAGERY
          if (uEarthImagery > 0.5) {
            vec4 dayW = earthTex(uEarthDay, eUV);
            vec3 c = dayW.rgb;
            albedo = earthAlbedo(c);
            waterAlbedo = earthWaterAlbedo(c);
            waterW = earthWater(dayW.a, c);
            // The relief bump comes from the coarse bake: keep it off imagery water.
            N = normalize(mix(N, normalize(uBodyRot * n), waterW));
          }
        #endif
        vec3 up = normalize(rel);
        col = waterW < 1.0 ? shadeSurface(albedo, N, V, rel) : vec3(0.0);
        if (waterW > 0.0) {
          vec3 sunT = sunTransmittance(rel) * cloudShadow(rel);
          vec3 skyAmb = skyAmbient(rel, up);
          col = mix(col, shadeWater(waterAlbedo, up, up, V, rel, earthSkyReflApprox(skyAmb, up, V), coxMunkAlpha(seaWind(n, rel)), sunT, skyAmb), waterW);
        }
        #ifdef EARTH_IMAGERY
          if (uEarthImagery > 0.5) col += earthNightLights(eUV, dot(up, uSunDir), rel);
          else col += earthEmission(n, h, dot(up, uSunDir));
        #else
          col += earthEmission(n, h, dot(up, uSunDir)) * (1.0 - waterW);
        #endif
        col = applyAerialPerspective(col, -V, dist, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- Gas giants

export interface GasGiantStyle {
  style: number; // 0 jupiter, 1 saturn, 2 uranus, 3 neptune
  colors: [number, number, number][];
  bandFreq: number;
  turbulence: number;
  contrast: number;
}

export function createGasGiantMaterial(u: PlanetUniforms, q: QualitySettings, s: GasGiantStyle): THREE.ShaderMaterial {
  const c = (i: number) => new THREE.Vector3(...(s.colors[Math.min(i, s.colors.length - 1)] ?? [0.5, 0.5, 0.5]));
  return new THREE.ShaderMaterial({
    defines: defines(q),
    uniforms: {
      ...u,
      uC0: { value: c(0) },
      uC1: { value: c(1) },
      uC2: { value: c(2) },
      uC3: { value: c(3) },
      uStyle: { value: s.style },
      uBandFreq: { value: s.bandFreq },
      uTurb: { value: s.turbulence },
      uContrast: { value: s.contrast },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorldPos;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      ${GLSL_NOISE}
      uniform mat3 uBodyRot;
      uniform vec3 uC0, uC1, uC2, uC3;
      uniform float uStyle, uBandFreq, uTurb, uContrast;
      varying vec3 vWorldPos;
      varying vec3 vObj;

      vec3 bandColor(float b, float lat) {
        // b in [0,1]: 0 dark belt → 1 bright zone
        vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.45, b));
        c = mix(c, uC2, smoothstep(0.45, 0.9, b));
        return c;
      }

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 n = normalize(vObj);
        float lat = asin(clamp(n.z, -1.0, 1.0));
        float lon = atan(n.y, n.x);
        float t = uTime;
        // Differential rotation: alternating jets shift longitudes per band.
        float jet = sin(lat * uBandFreq * 0.5) * 0.00012 * mod(t, 100000.0);
        float cl = cos(lat);
        vec3 pr = vec3(cl * cos(lon + jet), cl * sin(lon + jet), n.z);
        // Turbulent domain warp, stretched along latitude lines.
        vec3 q = pr * vec3(3.0, 3.0, 9.0);
        vec2 warp = vec2(fbm3(q + vec3(0.0, 0.0, mod(t * 0.00002, 100.0)), DETAIL_OCTAVES), fbm3(q * 1.7 + vec3(5.2, 1.3, -mod(t * 0.00003, 100.0)), DETAIL_OCTAVES));
        float eddy = snoise(pr * vec3(18.0, 18.0, 9.0) + warp.x * 2.0);
        float curl = sin(lon * 19.0 + warp.y * 8.0 + lat * 32.0);
        float latW = lat + uTurb * (warp.x * 0.085 + warp.y * 0.034 + eddy * curl * 0.016);
        // Band structure: irregular 1D profile in latitude (noise of several octaves, not a pure sine),
        // so belts and zones have varied widths and brightness like real cloud bands.
        float lb = latW * uBandFreq / 6.2832;
        float prof = snoise(vec3(lb * 1.0, 3.7, 1.1)) * 0.55 + snoise(vec3(lb * 2.1, -1.3, 7.7)) * 0.3 + snoise(vec3(lb * 4.3, 5.1, -2.2)) * 0.15;
        float b = 0.42 + 0.8 * prof;
        b = mix(0.55, b, uContrast);
        // Fine turbulent streaks (weak, mostly along latitude).
        float fine = fbm3(vec3(pr.xy * 5.0, latW * 48.0), DETAIL_OCTAVES);
        b = clamp(b + fine * 0.14 * uTurb, 0.0, 1.0);
        vec3 albedo = bandColor(b, lat);
        float polar = smoothstep(0.9, 1.35, abs(lat));
        if (uStyle < 0.5) {
          // Jupiter: Great Red Spot-like anticyclone at ~22°S + white ovals.
          vec2 gc = vec2(-0.384, 0.0);
          float dl = lon + jet - 1.2 + t * 0.0005;
          dl = mod(dl + ATMO_PI, 2.0 * ATMO_PI) - ATMO_PI;
          vec2 d = vec2(dl * cos(gc.x) / 0.21, (lat - gc.x) / 0.1);
          float r = length(d);
          if (r < 2.2) {
            float ang = (1.0 - smoothstep(0.0, 1.6, r)) * 5.0;
            vec2 sw = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
            float swirl = fbm3(vec3(sw * 2.5, 3.0), DETAIL_OCTAVES);
            float edge = r + snoise(vec3(sw * 4.0, 7.0)) * 0.085;
            vec3 red = uC3 * (0.9 + 0.3 * swirl);
            albedo = mix(albedo, red, 1.0 - smoothstep(0.72, 1.12, edge));
            float rim = smoothstep(0.85, 1.03, edge) * (1.0 - smoothstep(1.03, 1.42, edge));
            albedo = mix(albedo, uC2, rim * (0.20 + 0.18 * swirl));
          }
          float ov = snoise(vec3(pr.xy * 18.0, lat * 30.0));
          albedo = mix(albedo, uC2 * 1.1, smoothstep(0.75, 0.85, ov) * (1.0 - smoothstep(0.2, 0.5, abs(lat + 0.6))) * 0.7);
          albedo = mix(albedo, uC0 * 0.9, polar * 0.6);
        } else if (uStyle < 1.5) {
          // Saturn: subtle bands, north-polar hexagon.
          if (lat > 1.2) {
            float a = atan(n.y, n.x) + t * 0.0003;
            float hexR = cos(ATMO_PI / 6.0) / cos(mod(a, ATMO_PI / 3.0) - ATMO_PI / 6.0);
            float rr = (ATMO_PI * 0.5 - lat) / (ATMO_PI * 0.5 - 1.29) + snoise(n * 48.0) * 0.035;
            float edge = 1.0 - smoothstep(0.025, 0.14, abs(rr - hexR));
            albedo = mix(albedo, uC0 * 1.2, 0.5 * (1.0 - smoothstep(hexR - 0.035, hexR + 0.035, rr)));
            albedo = mix(albedo, vec3(0.39, 0.49, 0.45), edge * (0.24 + 0.10 * snoise(n * 75.0)));
            float eye = 1.0 - smoothstep(0.07, 0.22, rr);
            albedo = mix(albedo, vec3(0.075, 0.13, 0.14), eye * 0.8);
            float vortex = snoise(vec3(n.xy * 110.0, rr * 14.0 + sin(a * 8.0)));
            albedo *= 1.0 + vortex * 0.10 * (1.0 - smoothstep(0.2, 0.8, rr));
          }
          albedo = mix(albedo, mix(uC0, vec3(0.35, 0.42, 0.5), 0.5), polar * 0.5);
        } else if (uStyle < 2.5) {
          // Uranus: nearly featureless, bright polar cap.
          albedo = mix(albedo, uC2 * 1.1, smoothstep(0.7, 1.3, lat) * 0.5);
        } else {
          // Neptune: dark spot + bright cirrus streaks.
          float dl = mod(lon + jet + 2.0 + t * 0.001 + ATMO_PI, 2.0 * ATMO_PI) - ATMO_PI;
          vec2 d = vec2(dl * cos(-0.35) / 0.25, (lat + 0.35) / 0.1);
          float r = length(d);
          float storm = r + snoise(vec3(d * 4.0, 1.0)) * 0.09;
          albedo = mix(albedo, uC0 * (0.45 + 0.12 * snoise(vec3(d * 8.0, 4.0))), 1.0 - smoothstep(0.60, 1.05, storm));
          albedo = mix(albedo, vec3(0.63, 0.77, 0.88), exp(-(((storm - 1.08) * 9.0) * ((storm - 1.08) * 9.0))) * 0.12 * smoothstep(-0.3, 0.8, d.y));
          float streak = fbm3(vec3(pr.xy * 4.0, lat * 60.0), DETAIL_OCTAVES);
          albedo = mix(albedo, vec3(0.9), smoothstep(0.35, 0.6, streak) * 0.55 * (1.0 - smoothstep(0.9, 1.3, r)));
        }
        // Project onto the exact sphere: tessellated triangles sag below R (km at planetary scale),
        // which would alias altitude-dependent atmosphere terms along the mesh.
        vec3 N = normalize(uBodyRot * n);
        vec3 rel = N * (uPlanetRadius + uHr * 0.5);
        vec3 toCam = uCamRel - rel;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float mu0 = max(dot(N, uSunDir), 0.0);
        float mu = max(dot(N, V), 0.0);
        // Minnaert limb darkening (k≈0.85) for cloud decks.
        float minn = pow(mu0, 0.8) * pow(max(mu, 0.02), 0.18);
        // Upper methane haze softens ice-giant markings towards the limb.
        if (uStyle > 1.5) albedo = mix(albedo, mix(uC1, uC2, 0.55), 0.22 + 0.35 * ((1.0 - mu) * (1.0 - mu)));
        vec3 sunT = (uHasAtmo > 0.5 ? sunTransmittance(rel) : vec3(1.0)) * ringShadow(rel);
        vec3 col = albedo * (uSunColor * sunT * minn / ATMO_PI + vec3(0.004));
        col += albedo * (skyAmbient(rel, N) * 0.5 + uPlanetshineColor * max(dot(N, uPlanetshineDir), 0.0)) / ATMO_PI;
        col = applyAerialPerspective(col, -V, dist, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- Atmosphere shell (sky)

export function createSkyMaterial(u: PlanetUniforms, q: QualitySettings): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: defines(q),
    uniforms: {
      ...u,
      uSunAngularRadius: { value: 0.0047 },
      uSunRadiance: { value: 2000 },
      uSkyGroundC: { value: 0 },
      uSkyGroundEnabled: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      uniform float uSunAngularRadius;
      uniform float uSunRadiance;
      uniform float uSkyGroundC;
      uniform float uSkyGroundEnabled;
      varying vec3 vWorldPos;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 rd = normalize(vWorldPos - cameraPosition);
        float b = dot(uCamRel, rd);
        // Log-depth writes defeat early-Z. This inner sphere is wholly inside
        // Earth's opaque surface (including mesh sag), so these rays cannot show sky.
        if (uSkyGroundEnabled > 0.5 && b < 0.0 && b * b > uSkyGroundC) discard;
        vec2 ta = raySphereC(b, uCamCAtm);
        if (ta.y < 0.0) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tg = raySphereC(b, uCamCGround);
        bool hitGround = tg.x > 0.0 && tg.x < t1;
        if (hitGround) t1 = tg.x;
        vec3 L, T;
        // Rays that hit the ground sphere are covered by terrain, ocean or the far sphere, which apply their own
        // aerial perspective; the shell only shows there through gaps (streaming, cutouts). Log-depth fragment
        // writes defeat early-Z, so these hidden pixels would otherwise pay the full march: use a short one.
        int steps = min(VIEW_STEPS * uStepScale, 64);
        integrateScattering(uCamRel, rd, t0, t1, hitGround ? min(steps, 4) : steps, L, T);
        float meanT = dot(T, vec3(1.0 / 3.0));
        // Chromatic correction for the Sun disc behind the shell: blended result becomes T * sun.
        float cosA = dot(rd, uSunDir);
        float disc = smoothstep(cos(uSunAngularRadius * 1.15), cos(uSunAngularRadius * 0.85), cosA);
        if (!hitGround) L += (T - meanT) * uSunRadiance * disc;
        gl_FragColor = vec4(max(L, vec3(0.0)), hitGround ? 1.0 : 1.0 - meanT);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- Clouds (Earth)

export function createCloudMaterial(u: PlanetUniforms, q: QualitySettings, cloudRadius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { ...defines(q), CLOUD_DETAIL: q.earth.cloudQuality === 'ultra' ? 4 : q.earth.cloudQuality === 'high' ? 3 : q.earth.cloudQuality === 'medium' ? 2 : 1 },
    uniforms: {
      ...u,
      uCloudRadius: { value: cloudRadius },
      uCamCCloud: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      ${GLSL_NOISE}
      uniform mat3 uBodyRot;
      uniform samplerCube uCloudMap;
      uniform mat3 uCloudRot;
      uniform float uCloudShell;
      uniform float uCloudRadius;
      uniform float uCamCCloud;
      varying vec3 vWorldPos;

      /** Coverage is always the baked field. Detail cannot spawn clouds in clear sky. */
      float cloudAt(vec3 rel, float t, float bias) {
        vec3 dir = uCloudRot * rel;
        float d = texture(uCloudMap, dir, bias).r;
        vec3 p = normalize(dir) * (uCloudRadius / 2000.0);
        // Derivatives are evaluated outside branches; fade EACH octave before Nyquist.
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        float near = 1.0 - smoothstep(60000.0, 350000.0, t);
        float f1 = near * (1.0 - smoothstep(0.12, 0.4, footprint));
        float f2 = near * (1.0 - smoothstep(0.12, 0.4, footprint * 3.0));
        float f3 = near * (1.0 - smoothstep(0.12, 0.4, footprint * 9.0));
        #if CLOUD_DETAIL == 2
          // Detail multiplies coverage; zero remains zero. Keep derivatives
          // above this branch so neighboring cloud edges retain their footprint.
          if (d <= 0.0) return 0.0;
        #endif
        float n = 0.0;
        if (f1 > 0.0) n += snoise(p) * 0.24 * f1;
        #if CLOUD_DETAIL >= 2
          if (f2 > 0.0) n += snoise(p * 3.0 + 7.0) * 0.10 * f2;
        #endif
        #if CLOUD_DETAIL >= 3
          if (f3 > 0.0) n += snoise(p * 9.0 - 3.0) * 0.035 * f3;
        #endif
        return clamp(d * (1.0 + n), 0.0, 1.0);
      }

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        if (uCloudShell <= 0.0) discard;
        vec3 rd = normalize(vWorldPos - cameraPosition);
        float b = dot(uCamRel, rd);
        vec2 tc = raySphereC(b, uCamCCloud);
        if (tc.y < 0.0) discard;
        bool below = uCamCCloud < 0.0;
        float t = below ? tc.y : tc.x;
        if (t < 0.0) discard;
        vec2 tg = raySphereC(b, uCamCGround);
        if (tg.x > 0.0 && tg.x < t) discard;
        // Depth belongs to the analytic cloud hit, not the back of the proxy sphere.
        // This also works in the small gap between the true shell and its inflated mesh.
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          float viewDepth = max(0.0, -t * (viewMatrix * vec4(rd, 0.0)).z);
          gl_FragDepth = log2(1.0 + viewDepth) * logDepthBufFC * 0.5;
        #endif
        vec3 rel = uCamRel + rd * t;
        float d = cloudAt(rel, t, 0.0);
        if (d < 0.01) discard;
        vec3 up = normalize(rel);
        float muS = dot(up, uSunDir);
        vec3 sunT = sunTransmittance(rel) * ringShadow(rel);
        // Self-shadowing: blurred density a few tens of km towards the sun.
        float dS = texture(uCloudMap, uCloudRot * (up + uSunDir * 0.006), 2.5).r;
        float shadow = mix(1.0, below ? 0.4 : 0.72, smoothstep(0.1, 0.9, dS));
        float cosT = dot(rd, uSunDir);
        // Henyey–Greenstein forward lobe: thin edges glow when looking towards the sun.
        float g = 0.65;
        float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
        float phase = 0.62 + 0.09 * hg * (1.0 - 0.75 * d);
        // Seen from below, thick cores are grey (light has scattered out on the way through).
        float base = below ? mix(1.0, 0.38, smoothstep(0.25, 1.0, d)) : mix(1.0, 0.82, d * d);
        vec3 albedo = vec3(0.93);
        float lit = max(muS + 0.12, 0.0) / 1.12;
        #if CLOUD_DETAIL >= 3
          // Cloud-top relief: optically thick cores stand higher, so the density gradient tilts the top
          // towards or away from the sun (visible at low sun near the terminator).
          if (!below && t > 20000.0) {
            vec3 t1 = normalize(cross(up, abs(up.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
            vec3 t2 = cross(up, t1);
            float d0 = texture(uCloudMap, uCloudRot * up, 1.5).r;
            float d1 = texture(uCloudMap, uCloudRot * (up + t1 * 0.004), 1.5).r;
            float d2 = texture(uCloudMap, uCloudRot * (up + t2 * 0.004), 1.5).r;
            vec3 n = normalize(up - (t1 * (d1 - d0) + t2 * (d2 - d0)) * 1.2);
            lit *= clamp((dot(n, uSunDir) + 0.12) / max(muS + 0.12, 0.08), 0.6, 1.4);
          }
        #endif
        vec3 col = albedo * uSunColor * sunT * shadow * phase * lit * base / ATMO_PI;
        col += albedo * skyAmbient(rel, up) / ATMO_PI * (below ? 1.0 : 1.25);
        float a = clamp(d * 1.2, 0.0, 0.98);
        col = applyAerialPerspective(col, rd, t, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col * a, a);
      }`,
    // One rasterized hit from both outside and inside the proxy sphere.
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- Rings

export function createRingMaterial(u: PlanetUniforms, q: QualitySettings, profile: THREE.Texture, inner: number, outer: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: defines(q),
    uniforms: {
      ...u,
      uProfile: { value: profile },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOcclusion: { value: 1 },
      uParticleRange: { value: 0 },
      uRingDetail: { value: getDetailTexture() },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorldPos;
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${baseHeader()}
      uniform sampler2D uProfile;
      uniform float uInner, uOuter;
      uniform float uOcclusion;
      uniform float uParticleRange;
      uniform sampler2D uRingDetail;
      varying vec3 vWorldPos;
      varying vec2 vLocal;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        float r = length(vLocal);
        float uu = (r - uInner) / (uOuter - uInner);
        if (uu < 0.0 || uu > 1.0) discard;
        vec4 prof = texture2D(uProfile, vec2(uu, 0.5));
        float tau0 = prof.a;
        if (tau0 < 0.002) discard;
        vec3 rel = vWorldPos - uPlanetCenter;
        vec3 toCam = cameraPosition - vWorldPos;
        vec3 V = normalize(toCam);
        vec3 n = uRingNormal;
        float muV = abs(dot(V, n));
        float muS = dot(uSunDir, n);
        // Opacity grows at grazing view angles (longer slant path).
        float tau = -log(max(1.0 - tau0, 0.001));
        float alpha = 1.0 - exp(-tau / max(muV, 0.03));
        // Hand the local ring sheet to resolved chunks with a smooth radial/vertical overlap.
        float local = (1.0 - smoothstep(uParticleRange * 0.2, max(1.0, uParticleRange * 0.75), length(toCam)))
                    * (1.0 - smoothstep(50.0, 220.0, abs(dot(uCamRel, n))));
        alpha *= 1.0 - local * 0.96;
        float nearField = 1.0 - smoothstep(1500.0, 18000.0, length(toCam));
        float grains = texture2D(uRingDetail, vLocal / 2048.0).r;
        alpha *= mix(1.0, smoothstep(0.18, 0.72, grains), nearField * 0.65);
        // Planet shadow on the rings (soft edge, penumbra scaled by distance).
        float along = dot(rel, uSunDir);
        vec3 perp = rel - along * uSunDir;
        float sh = along < 0.0 ? smoothstep(uPlanetRadius * 0.985, uPlanetRadius * 1.015, length(perp)) : 1.0;
        bool litSide = sign(dot(V, n)) == sign(muS);
        float cosPhase = dot(-V, uSunDir); // 1 when looking towards the sun (forward scattering)
        float illum;
        vec3 albedo = prof.rgb; // ring profile already stores linear albedo
        if (litSide) {
          // Reflected light, mild backscatter brightening (opposition surge).
          illum = abs(muS) * (0.8 + 0.4 * pow(max(-cosPhase, 0.0), 4.0));
        } else {
          // Transmitted light through the ring: sparse regions glow, dense B ring stays dark.
          float trans = exp(-tau / max(abs(muS), 0.03));
          illum = abs(muS) * (1.0 - trans) * trans / max(1.0 - exp(-tau / max(muV, 0.03)), 0.05) * (0.7 + 3.0 * pow(max(cosPhase, 0.0), 6.0));
          illum = max(illum, 0.0);
        }
        vec3 col = albedo * uSunColor * illum * sh / ATMO_PI;
        // Planetshine faintly lights the night side of the rings.
        float planetPhase = 0.5 + 0.5 * dot(normalize(rel), uSunDir);
        float planetSolidAngle = ((uPlanetRadius / length(rel)) * (uPlanetRadius / length(rel)));
        col += albedo * uSunColor * vec3(1.0, 0.86, 0.65) * planetSolidAngle * planetPhase * 0.055;
        // The forward lobe remains visible on both sides for unresolved ice/dust in thinner rings.
        col += albedo * uSunColor * sh * pow(max(cosPhase, 0.0), 16.0) * exp(-tau * 2.0) * 0.14;
        gl_FragColor = vec4(col * alpha, alpha * uOcclusion);
      }`,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- Sun

export function createSunMaterial(colors: [number, number, number][], intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uCore: { value: new THREE.Vector3(...(colors[2] ?? [1, 0.97, 0.85])) },
      uLimb: { value: new THREE.Vector3(...(colors[0] ?? [1, 0.6, 0.2])) },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorldPos;
      varying vec3 vN;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${GLSL_NOISE}
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uCore, uLimb;
      varying vec3 vWorldPos;
      varying vec3 vN;
      varying vec3 vObj;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 V = normalize(cameraPosition - vWorldPos);
        float mu = clamp(dot(normalize(vN), V), 0.0, 1.0);
        // Quadratic limb darkening (visible-band coefficients).
        float ld = 1.0 - 0.47 * (1.0 - mu) - 0.23 * (1.0 - mu) * (1.0 - mu);
        vec3 p = normalize(vObj);
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        float cells = snoise(p * 240.0 + mod(uTime * 0.008, 100.0));
        float intergranular = smoothstep(-0.35, 0.35, cells);
        float gran = 0.65 + 0.35 * mix(0.55, intergranular, 1.0 - smoothstep(0.003, 0.012, footprint));
        gran += 0.06 * snoise(p * 65.0);
        float spots = smoothstep(0.72, 0.8, snoise(p * 6.0 + 11.0)) * (1.0 - smoothstep(0.2, 0.6, abs(p.z)));
        vec3 c = mix(uLimb, uCore, pow(mu, 0.5)) * ld * gran * (1.0 - spots * 0.6);
        gl_FragColor = vec4(c * uIntensity, 1.0);
      }`,
  });
}
