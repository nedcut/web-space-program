import * as THREE from 'three';
import { GLSL_NOISE, GLSL_LOGDEPTH_FRAG, GLSL_LOGDEPTH_FRAG_PARS, GLSL_LOGDEPTH_VERT, GLSL_LOGDEPTH_VERT_PARS } from '../core/glsl';
import { GLSL_ATMOSPHERE, GLSL_RING_SHADOW } from './shaders/atmosphere.glsl';
import type { PlanetUniforms } from './uniforms';
import type { QualitySettings } from '../core/quality';
import { getDetailTexture } from './textures';
import { GLSL_CUTOUT, type TerrainCutoutUniforms } from './cutout';

/** Surface lighting shared by terrain / far sphere: Lambert ↔ Lommel–Seeliger (airless regolith). */
const GLSL_SHADE = /* glsl */ `
#ifdef EARTH_DETAILS
${GLSL_NOISE}
#endif
vec3 earthEmission(vec3 n, float height, float sunAltitude) {
  #ifdef EARTH_DETAILS
    if (height <= 2.0 || abs(n.z) > 0.92) return vec3(0.0);
    float night = 1.0 - smoothstep(-0.18, 0.02, sunAltitude);
    float coast = exp(-height / (uPlanetRadius * 0.0012));
    float population = smoothstep(-0.1, 0.45, fbm3(n * 18.0 + 7.1, 3));
    float towns = smoothstep(0.60, 0.87, snoise(n * 750.0)) + 0.22 * smoothstep(0.4, 0.75, snoise(n * 240.0));
    return vec3(1.0, 0.53, 0.16) * night * coast * population * towns * 1.3;
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
  vec3 sunT = (uHasAtmo > 0.5 ? sunTransmittance(rel) : vec3(geo)) * ringShadow(rel);
  vec3 direct = uSunColor * sunT * f;
  vec3 amb = skyAmbient(rel, N) / ATMO_PI;
  vec3 planetshine = uPlanetshineColor * max(dot(N, uPlanetshineDir), 0.0) / ATMO_PI;
  return albedo * (direct + amb + planetshine + uAmbientFloor);
}
`;

function baseHeader(): string {
  return GLSL_ATMOSPHERE + GLSL_RING_SHADOW;
}

function defines(q: QualitySettings): Record<string, string | number> {
  return { AERIAL_STEPS: q.atmosphere.aerialSteps, VIEW_STEPS: q.atmosphere.viewSteps, DETAIL_OCTAVES: q.planetDetails.gasOctaves };
}

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
  return new THREE.ShaderMaterial({
    defines: { ...defines(q), ...(o.detail ? { USE_DETAIL: 1 } : {}), ...(o.cutout ? { USE_CUTOUT: 1 } : {}) },
    uniforms: {
      ...u,
      ...(o.cutout ?? {}),
      uDetailTex: { value: getDetailTexture() },
      uRockColor: { value: new THREE.Vector3(...o.rockColor) },
      uRockBlend: { value: o.rockBlend },
      uAirless: { value: o.airless },
      uAmbientFloor: { value: 0.0015 },
      uDetailStrength: { value: o.detailStrength },
      uDuneRipples: { value: o.duneRipples ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      attribute vec3 aColor;
      attribute vec3 aDetail;
      varying vec3 vWorldPos;
      varying vec3 vNormalBF;
      varying vec3 vColor;
      varying vec3 vDetail;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalBF = normal;
        vColor = aColor * aColor; // stored gamma-2 encoded
        vDetail = aDetail;
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

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        #ifdef USE_CUTOUT
        applyCutout(vWorldPos);
        #endif
        vec3 rel = vWorldPos - uPlanetCenter;
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
          vec3 g = vec3(0.0);
          // Three octaves; the large one uses the decorrelated A channel (+swizzle) to hide tiling.
          if (f3 > 0.0) { vec4 s = triSample(vDetail.zxy, w.zxy, 1024.0); vec4 s2 = triSample(vDetail, w, 256.0); hd += ((s.a - 0.5) * 0.7 + (s2.a - 0.5) * 0.5) * f3; g += triGrad(vDetail, w, 256.0) * f3 * 0.35; }
          if (f2 > 0.0) { vec4 s = triSample(vDetail.yzx, w.yzx, 32.0); hd += (s.r - 0.5) * f2 * 0.6; g += triGrad(vDetail, w, 32.0) * f2 * 0.6; }
          if (f1 > 0.0) { vec4 s = triSample(vDetail, w, 4.0); hd += (s.r - 0.5) * f1 * 0.5; g += triGrad(vDetail, w, 4.0) * f1; }
          float microFade = 1.0 - smoothstep(15.0, 100.0, dist);
          if (microFade > 0.0) g += triGrad(vDetail, w, 0.5) * microFade * 0.35;
          // Shallow wind ripples, projected into the tangent plane below; no collision relief.
          g += vec3(cos(vDetail.x * 6.2831853 + sin(vDetail.y * 0.09817477)) * 0.12, 0.0, 0.0) * uDuneRipples * f1;
          albedo *= 1.0 + hd * 0.55 * uDetailStrength;
          rockT = clamp(rockT + hd * 0.4 * uRockBlend, 0.0, 1.0);
          vec3 gt = g - dot(g, nBF) * nBF;
          nBF = normalize(nBF - gt * 1.6 * uDetailStrength);
          N = normalize(uBodyRot * nBF);
        #endif
        albedo = mix(albedo, uRockColor * (0.85 + 0.3 * albedo / max(max(albedo.r, albedo.g), 0.05)), rockT);
        vec3 col = shadeSurface(albedo, N, V, rel);
        col += earthEmission(normalize(transpose(uBodyRot) * rel), length(rel) - uPlanetRadius, dot(up, uSunDir));
        col = applyAerialPerspective(col, -V, dist, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Instanced cell-local assets, using the same solar lighting and aerial perspective as terrain. */
export function createScatterMaterial(u: PlanetUniforms, q: QualitySettings, centers: THREE.DataTexture, color: number[], plant: boolean, radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: defines(q),
    uniforms: { ...u, uCenters: { value: centers }, uColor: { value: new THREE.Vector3(...color) }, uAirless: { value: plant ? 0 : 0.65 }, uAmbientFloor: { value: 0.0015 }, uRange: { value: radius } },
    side: plant ? THREE.DoubleSide : THREE.FrontSide,
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      uniform sampler2D uCenters;
      attribute float aCell;
      attribute vec3 color;
      varying vec3 vTint;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vTint = color;
        vec3 centre = texture2D(uCenters, vec2((aCell + 0.5) / 2048.0, 0.5)).xyz;
        vec4 local = instanceMatrix * vec4(position, 1.0);
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
  return new THREE.ShaderMaterial({
    defines: defines(q),
    uniforms: {
      ...u,
      uDetailTex: { value: getDetailTexture() },
      uSeabed: { value: new THREE.Vector3(...seabed) },
      uHydrocarbon: { value: hydrocarbon ? 1 : 0 },
      uDeep: { value: hydrocarbon ? new THREE.Vector3(0.003, 0.004, 0.002) : new THREE.Vector3(0.002, 0.011, 0.03) },
      uShallow: { value: new THREE.Vector3(0.01, 0.07, 0.075) },
    },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      attribute float aDepth;
      attribute vec3 aDetail;
      varying vec3 vWorldPos;
      varying vec3 vUpBF;
      varying float vDepth;
      varying vec3 vDetail;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vUpBF = normal;
        vDepth = aDepth;
        vDetail = aDetail;
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

      float ggx(float NdH, float a) {
        float a2 = a * a;
        float d = NdH * NdH * (a2 - 1.0) + 1.0;
        return a2 / (ATMO_PI * d * d);
      }

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        if (vDepth <= 0.0) discard;
        vec3 rel = vWorldPos - uPlanetCenter;
        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 upBF = normalize(vUpBF);
        vec3 w = abs(upBF); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);
        float t = uTime;
        float fade1 = 1.0 - smoothstep(200.0, 2000.0, dist);
        float fade2 = 1.0 - smoothstep(2000.0, 30000.0, dist);
        vec3 g = waveGrad(vDetail, w, 64.0, vec2(t * 1.3, t * 0.7)) * fade1
               + waveGrad(vDetail, w, 23.0, vec2(-t * 0.9, t * 1.6)) * fade1 * 0.7
               + waveGrad(vDetail, w, 512.0, vec2(t * 2.0, -t * 1.1)) * fade2 * 0.6;
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
        // Roughness grows with distance (unresolved waves widen the glint).
        float rough = clamp(0.05 + dist * 2e-7, 0.05, 0.2);
        // Rough-surface Schlick: unresolved wave facets cap grazing reflectance.
        float F = 0.02 + (0.55 - 0.02) * pow(1.0 - NdV, 5.0);
        vec3 sunT = sunTransmittance(rel) * ringShadow(rel);
        float k = rough * 0.5;
        float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
        vec3 spec = uSunColor * sunT * ggx(NdH, rough * rough) * G * F / (4.0 * NdV + 1e-4);
        spec = min(spec, vec3(200.0));
        // Sky reflection: march the reflected ray to the top of the atmosphere.
        vec3 R = reflect(-V, N);
        // Facet statistics: average reflected ray points higher into the (darker) sky.
        R = normalize(R + up * (0.12 + (1.0 - fade1) * 0.1));
        if (dot(R, up) < 0.03) R = normalize(R + up * (0.03 - dot(R, up)));
        vec3 skyL = vec3(0.0);
        if (uHasAtmo > 0.5) {
          float b = dot(rel, R);
          float c = dot(rel, rel) - uAtmoRadius * uAtmoRadius;
          vec2 ta = raySphereC(b, c);
          vec3 tr;
          integrateScattering(rel, R, 0.0, max(ta.y, 0.0), 6, skyL, tr);
        }
        // Water body colour: absorption with depth, lit by sun + sky.
        float depthT = 1.0 - exp(-vDepth / 18.0);
        vec3 water = mix(uShallow, uDeep, depthT);
        vec3 lightIn = uSunColor * sunT * max(dot(up, L), 0.0) / ATMO_PI + skyAmbient(rel, up) / ATMO_PI;
        vec3 body = water * lightIn;
        vec3 bed = uSeabed * lightIn * exp(-vDepth * vec3(0.45, 0.12, 0.06));
        body = mix(bed, body, smoothstep(0.0, 6.0, vDepth));
        vec3 col = mix(body, skyL, F) + spec;
        // foam at the very shoreline
        col += lightIn * 0.4 * (1.0 - uHydrocarbon) * (1.0 - smoothstep(0.0, 0.6, vDepth)) * fade1;
        col = applyAerialPerspective(col, -V, dist, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- Far sphere (baked texture)

export function createFarSphereMaterial(u: PlanetUniforms, q: QualitySettings, opts: { airless: number; ocean: boolean; minH: number; maxH: number; texWidth: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: defines(q),
    uniforms: {
      ...u,
      uMap: { value: null as THREE.Texture | null },
      uHasMap: { value: 0 },
      uFallback: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
      uAirless: { value: opts.airless },
      uAmbientFloor: { value: 0.0015 },
      uOcean: { value: opts.ocean ? 1 : 0 },
      uHRange: { value: new THREE.Vector2(opts.minH, opts.maxH) },
      uTexel: { value: new THREE.Vector2(2 / opts.texWidth, 4 / opts.texWidth) },
      uBump: { value: 3.0 },
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
      varying vec3 vWorldPos;
      varying vec3 vObj;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 n = normalize(vObj);
        float lon = atan(n.y, n.x);
        float lat = asin(clamp(n.z, -1.0, 1.0));
        vec2 uv = vec2(lon / (2.0 * ATMO_PI) + 0.5, lat / ATMO_PI + 0.5);
        vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
        vec2 dx = dFdx(uv), dy = dFdy(uv);
        vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
        if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
        vec3 albedo = uFallback;
        vec3 nBF = n;
        float h = 0.0;
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
        vec3 rel = normalize(uBodyRot * n) * (uPlanetRadius + max(h, 0.0));
        vec3 toCam = uCamRel - rel;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 N = normalize(uBodyRot * nBF);
        vec3 col;
        if (uOcean > 0.5 && h < 0.0) {
          vec3 up = normalize(rel);
          float depthT = 1.0 - exp(-(-h) / 18.0);
          vec3 water = mix(vec3(0.01, 0.07, 0.075), vec3(0.002, 0.011, 0.03), depthT);
          vec3 sunT = sunTransmittance(rel);
          col = water * (uSunColor * sunT * max(dot(up, uSunDir), 0.0) / ATMO_PI + skyAmbient(rel, up) / ATMO_PI);
          vec3 H = normalize(uSunDir + V);
          float NdV = max(dot(up, V), 0.001);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          float a2 = 0.09 * 0.09;
          float NdH = max(dot(up, H), 0.0);
          float d = NdH * NdH * (a2 - 1.0) + 1.0;
          col += uSunColor * sunT * (a2 / (ATMO_PI * d * d)) * F * max(dot(up, uSunDir), 0.0) / (4.0 * NdV);
        } else {
          col = shadeSurface(albedo, N, V, rel);
          col += earthEmission(n, h, dot(normalize(rel), uSunDir));
        }
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
          albedo = mix(albedo, vec3(0.63, 0.77, 0.88), exp(-pow((storm - 1.08) * 9.0, 2.0)) * 0.12 * smoothstep(-0.3, 0.8, d.y));
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
        if (uStyle > 1.5) albedo = mix(albedo, mix(uC1, uC2, 0.55), 0.22 + 0.35 * pow(1.0 - mu, 2.0));
        vec3 sunT = (uHasAtmo > 0.5 ? sunTransmittance(rel) : vec3(1.0)) * ringShadow(rel);
        vec3 col = albedo * uSunColor * sunT * minn / ATMO_PI;
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
      varying vec3 vWorldPos;
      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 rd = normalize(vWorldPos - cameraPosition);
        float b = dot(uCamRel, rd);
        vec2 ta = raySphereC(b, uCamCAtm);
        if (ta.y < 0.0) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tg = raySphereC(b, uCamCGround);
        bool hitGround = tg.x > 0.0 && tg.x < t1;
        if (hitGround) t1 = tg.x;
        vec3 L, T;
        integrateScattering(uCamRel, rd, t0, t1, min(VIEW_STEPS * uStepScale, 64), L, T);
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
    defines: defines(q),
    uniforms: {
      ...u,
      uCloudRadius: { value: cloudRadius },
      uCamCCloud: { value: 0 },
      uCoverage: { value: 0.44 },
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
      uniform float uCloudRadius;
      uniform float uCamCCloud;
      uniform float uCoverage;
      varying vec3 vWorldPos;

      vec3 swirl(vec3 p, vec3 c, float radius, float strength) {
        float d = length(p - c);
        float a = strength * exp(-pow(d / radius, 2.0));
        // Rodrigues rotation about axis c
        float ca = cos(a), sa = sin(a);
        return p * ca + cross(c, p) * sa + c * dot(c, p) * (1.0 - ca);
      }

      float cloudDensity(vec3 pBF, float lod) {
        float lat = asin(clamp(pBF.z, -1.0, 1.0));
        float alat = abs(lat);
        float drift = mod(uTime * 0.000015, 6.2831853);
        vec3 p = vec3(cos(drift) * pBF.x - sin(drift) * pBF.y, sin(drift) * pBF.x + cos(drift) * pBF.y, pBF.z);
        // Mid-latitude cyclones (counter-rotating per hemisphere) and a tropical storm.
        vec3 jit = vec3(fbm3(pBF * 3.0 + 1.7, 3), fbm3(pBF * 3.0 - 4.1, 3), fbm3(pBF * 3.0 + 8.3, 3)) * 0.04;
        p = swirl(p + jit, normalize(vec3(0.45, -0.55, 0.70)), 0.22, 1.3);
        p = swirl(p, normalize(vec3(0.2, 0.75, -0.63)), 0.18, -1.5);
        p = swirl(p, normalize(vec3(0.85, 0.45, 0.27)), 0.05, 4.0);
        // Large weather systems
        float cov = fbm3(p * 3.1 + vec3(13.0, 8.0, -4.0), 4) * 0.5 + 0.5;
        // Warped mid-scale structure, sheared along latitude (jet streams)
        vec3 q = p * 4.5;
        vec3 w = vec3(fbm3(q, 3), fbm3(q + 5.2, 3), fbm3(q - 3.7, 3));
        vec3 qs = (p + w * 0.12) * vec3(9.0, 9.0, 22.0);
        int oct = int(clamp(8.0 - lod, 3.0, 8.0));
        float det = fbm3(qs, oct) * 0.5 + 0.5;
        // Latitudinal structure: ITCZ, subtropical clear belts, storm tracks, polar cloudiness.
        float zone = 0.14 * exp(-pow(lat / 0.1, 2.0)) - 0.2 * exp(-pow((alat - 0.4) / 0.13, 2.0)) + 0.14 * exp(-pow((alat - 0.95) / 0.22, 2.0));
        float c = cov * 0.74 + det * 0.60 + zone;
        float thr = 1.12 - uCoverage;
        float d = smoothstep(thr, thr + 0.16, c);
        // Fine cumulus breakup near edges
        float fine = fbm3(p * 80.0, int(clamp(6.0 - lod, 2.0, 5.0))) * 0.5 + 0.5;
        d *= smoothstep(0.15, 0.55, fine + d * 0.6);
        // One organized tropical cyclone among irregular fronts; its eye and spiral arms are local.
        vec3 center = normalize(vec3(0.82, -0.46, 0.34));
        vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), center));
        vec3 north = cross(center, east);
        vec2 st = vec2(dot(pBF, east), dot(pBF, north));
        float radius = length(st);
        float front = smoothstep(0.8, 0.95, dot(pBF, center));
        float arms = 0.5 + 0.5 * sin(atan(st.y, st.x) * 3.0 - radius * 130.0 + fbm3(pBF * 70.0, 3) * 1.8);
        float cyclone = exp(-radius * radius / 0.008) * smoothstep(0.012, 0.026, radius) * (0.55 + arms * 0.45);
        d = mix(d, max(d, cyclone), front);
        d *= 1.0 - front * (1.0 - smoothstep(0.008, 0.018, radius));
        return d;
      }

      void main() {
        ${GLSL_LOGDEPTH_FRAG}
        vec3 rd = normalize(vWorldPos - cameraPosition);
        float b = dot(uCamRel, rd);
        vec2 tc = raySphereC(b, uCamCCloud);
        if (tc.y < 0.0) discard;
        float t = uCamCCloud < 0.0 ? tc.y : tc.x;
        if (t < 0.0) discard;
        vec2 tg = raySphereC(b, uCamCGround);
        if (tg.x > 0.0 && tg.x < t) discard;
        vec3 rel = uCamRel + rd * t;
        vec3 pBF = transpose(uBodyRot) * (rel / uCloudRadius);
        float lod = log2(max(t, 1.0) / 2000.0);
        float d = cloudDensity(pBF, lod);
        if (d < 0.01) discard;
        vec3 up = normalize(rel);
        float muS = dot(up, uSunDir);
        vec3 sunT = sunTransmittance(rel) * ringShadow(rel);
        // Fake self-shadowing: sample density towards the sun.
        float dS = cloudDensity(normalize(pBF + transpose(uBodyRot) * uSunDir * 0.004), lod + 1.0);
        float shadow = mix(1.0, 0.45, dS);
        float cosT = dot(rd, uSunDir);
        float phase = 0.6 + 0.6 * pow(max(cosT, 0.0), 8.0);
        vec3 albedo = vec3(0.92);
        vec3 col = albedo * uSunColor * sunT * shadow * phase * max(muS + 0.15, 0.0) / (ATMO_PI * 1.15);
        col += albedo * skyAmbient(rel, up) / ATMO_PI * 1.2;
        float a = clamp(d * 1.15, 0.0, 0.97);
        col = applyAerialPerspective(col, rd, t, AERIAL_STEPS * uStepScale);
        gl_FragColor = vec4(col * a, a);
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
        float planetSolidAngle = pow(uPlanetRadius / length(rel), 2.0);
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
