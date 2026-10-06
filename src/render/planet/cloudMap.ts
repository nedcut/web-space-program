import * as THREE from 'three';
import { GLSL_NOISE } from '../core/glsl';

/**
 * Earth's cloud field, baked once on the GPU into a body-fixed cube map (R = cloud density,
 * G = large-scale cover). Evaluating ~60 simplex-noise octaves per pixel per frame cost 2–17 ms
 * at Retina resolution; the bake moves that work into a few strips spread over the first frames,
 * so the per-pixel cloud shader becomes two texture fetches plus distance-faded detail noise.
 * The same map also casts cloud shadows on terrain and ocean.
 */
export class CloudMap {
  readonly target: THREE.WebGLCubeRenderTarget;
  private readonly size: number;
  private readonly strip: number;
  private next = 0;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  constructor(size: number) {
    this.size = size;
    // ~0.5–1 M texels per step keeps each bake step a fraction of a frame even on integrated GPUs.
    this.strip = Math.max(32, Math.min(size, Math.floor(786432 / size)));
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      format: THREE.RGFormat,
      type: THREE.UnsignedByteType,
      // Mip storage is allocated up front; three regenerates the chain after each strip (cheap).
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
    // Highest fbm octave should span ≥ 3 texels: 1024² → det 4 / fine 2 octaves.
    const extra = Math.max(0, Math.round(Math.log2(size / 1024)));
    this.material = new THREE.ShaderMaterial({
      defines: { DET_OCT: Math.max(3, 4 + extra), FINE_OCT: Math.max(1, 2 + extra) },
      uniforms: { uFace: { value: 0 }, uSize: { value: size } },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: GLSL_CLOUD_BAKE,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get done(): boolean { return this.next >= 6 * Math.ceil(this.size / this.strip); }

  /** Bake one strip of one face. Returns true once the whole map (with mipmaps) is ready. */
  step(renderer: THREE.WebGLRenderer): boolean {
    if (this.done) return true;
    const perFace = Math.ceil(this.size / this.strip);
    const face = Math.floor(this.next / perFace);
    const row = (this.next % perFace) * this.strip;
    this.next++;
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    const last = this.done;
    this.material.uniforms.uFace.value = face;
    this.target.viewport.set(0, row, this.size, Math.min(this.strip, this.size - row));
    this.target.scissor.copy(this.target.viewport);
    this.target.scissorTest = true;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target, face);
    renderer.render(this.scene, this.camera);
    if (last) {
      this.target.viewport.set(0, 0, this.size, this.size);
      this.target.scissor.copy(this.target.viewport);
      this.target.scissorTest = false;
    }
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.autoClear = prevAutoClear;
    return last;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/** Body-fixed cube direction for a texel of face `f` (OpenGL cube-map convention, s,t ∈ [-1, 1]). */
const GLSL_CUBE_DIR = /* glsl */ `
vec3 cubeDir(int f, vec2 st) {
  float s = st.x, t = st.y;
  if (f == 0) return vec3(1.0, -t, -s);
  if (f == 1) return vec3(-1.0, -t, s);
  if (f == 2) return vec3(s, 1.0, t);
  if (f == 3) return vec3(s, -1.0, -t);
  if (f == 4) return vec3(s, -t, 1.0);
  return vec3(-s, -t, -1.0);
}
`;

const GLSL_CLOUD_BAKE = /* glsl */ `
precision highp float;
uniform int uFace;
uniform float uSize;
${GLSL_NOISE}
${GLSL_CUBE_DIR}
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
void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 pBF = normalize(cubeDir(uFace, st));
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
  gl_FragColor = vec4(clamp(d, 0.0, 1.0), clamp(cumulus, 0.0, 1.0), 0.0, 1.0);
}
`;
