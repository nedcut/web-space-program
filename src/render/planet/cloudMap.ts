import * as THREE from 'three';
import { GLSL_NOISE } from '../core/glsl';
import { ProceduralCubeMap } from '../core/proceduralCube';

/**
 * Earth's cloud field, baked once on the GPU into a body-fixed cube map (R = cloud density,
 * G = fair-weather cumulus potential). Evaluating ~60 simplex-noise octaves per pixel per frame cost
 * 2–17 ms at Retina resolution; the bake moves that work into strips spread over the first frames,
 * so the per-pixel cloud shader becomes two texture fetches plus distance-faded detail noise.
 * The same map also casts cloud shadows on terrain and ocean.
 */
export class CloudMap extends ProceduralCubeMap {
  constructor(size: number) {
    // Highest fbm octave should span ≥ 3 texels: 1024² → det 4 / fine 2 octaves.
    const extra = Math.max(0, Math.round(Math.log2(size / 1024)));
    super(size, GLSL_CLOUD_BAKE, { format: THREE.RGFormat, defines: { DET_OCT: Math.max(3, 4 + extra), FINE_OCT: Math.max(1, 2 + extra) } });
  }
}

const GLSL_CLOUD_BAKE = /* glsl */ `
${GLSL_NOISE}
vec3 swirl(vec3 p, vec3 c, float radius, float strength) {
  float d = length(p - c);
  float a = strength * exp(-((d / radius) * (d / radius)));
  float ca = cos(a), sa = sin(a);
  return p * ca + cross(c, p) * sa + c * dot(c, p) * (1.0 - ca);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
/** Cellular (Worley F1) noise: cumulus "popcorn" cells. */
float cells(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + hash33(i + o) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
vec4 bake(vec3 pBF) {
  float lat = asin(clamp(pBF.z, -1.0, 1.0));
  float alat = abs(lat);
  // Mid-latitude cyclones (counter-rotating per hemisphere) and a tropical storm.
  vec3 jit = vec3(fbm3(pBF * 3.0 + 1.7, 4), fbm3(pBF * 3.0 - 4.1, 4), fbm3(pBF * 3.0 + 8.3, 4)) * 0.045;
  vec3 p = swirl(pBF + jit, normalize(vec3(0.45, -0.55, 0.70)), 0.22, 1.2);
  p = swirl(p, normalize(vec3(0.2, 0.75, -0.63)), 0.18, -1.4);
  p = swirl(p, normalize(vec3(-0.55, -0.35, 0.76)), 0.16, 1.1);
  p = swirl(p, normalize(vec3(0.85, 0.45, 0.27)), 0.05, 4.0);
  // Large weather systems.
  float cov = fbm3(p * 3.1 + vec3(13.0, 8.0, -4.0), 5) * 0.5 + 0.5;
  // Warped mid-scale structure, sheared along latitude (jet streams).
  vec3 q = p * 4.5;
  vec3 w = vec3(fbm3(q, 4), fbm3(q + 5.2, 4), fbm3(q - 3.7, 4));
  vec3 qs = (p + w * 0.12) * vec3(9.0, 9.0, 18.0);
  // Octaves stop at the bake's resolution (finer detail is added per pixel at runtime).
  float det = fbm3(qs, DET_OCT) * 0.5 + 0.5;
  // Latitudinal structure: ITCZ, subtropical clear belts, storm tracks, polar cloudiness.
  float zone = 0.14 * exp(-((lat / 0.1) * (lat / 0.1))) - 0.2 * exp(-(((alat - 0.4) / 0.13) * ((alat - 0.4) / 0.13))) + 0.14 * exp(-(((alat - 0.95) / 0.22) * ((alat - 0.95) / 0.22)));
  float c = cov * 0.74 + det * 0.60 + zone;
  float thr = 0.68;
  float d = smoothstep(thr, thr + 0.16, c);
  // Fine breakup near edges.
  float fine = fbm3(p * 80.0 + w * 2.0, FINE_OCT) * 0.5 + 0.5;
  d *= smoothstep(0.15, 0.55, fine + d * 0.6);
  // Fair-weather cumulus potential (G): moderate large-scale cover, strongest in the trade-wind belts.
  // The individual cells are far below this map's resolution; the cloud shader draws them per pixel.
  float cuZone = smoothstep(0.42, 0.62, cov * 0.74 + det * 0.6 + zone + 0.1) * (0.55 + 0.45 * exp(-(((alat - 0.3) / 0.22) * ((alat - 0.3) / 0.22))));
  float cumulus = cuZone * smoothstep(0.3, 0.6, det) * (1.0 - d);
  // One organized tropical cyclone: eye and spiral arms.
  vec3 center = normalize(vec3(0.82, -0.46, 0.34));
  vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), center));
  vec3 north = cross(center, east);
  vec2 sc = vec2(dot(pBF, east), dot(pBF, north));
  float radius = length(sc);
  float front = smoothstep(0.8, 0.95, dot(pBF, center));
  float arms = 0.5 + 0.5 * sin(atan(sc.y, sc.x) * 3.0 - radius * 130.0 + fbm3(pBF * 70.0, 4) * 1.8);
  float cyclone = exp(-radius * radius / 0.008) * smoothstep(0.012, 0.026, radius) * (0.55 + arms * 0.45);
  d = mix(d, max(d, cyclone), front);
  d *= 1.0 - front * (1.0 - smoothstep(0.008, 0.018, radius));
  cumulus *= 1.0 - front;
  return vec4(clamp(d, 0.0, 1.0), clamp(cumulus, 0.0, 1.0), 0.0, 1.0);
}
`;
