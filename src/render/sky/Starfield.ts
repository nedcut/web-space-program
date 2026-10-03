import * as THREE from 'three';
import { mulberry32 } from '../../sim/terrain/noise';
import { GLSL_NOISE } from '../core/glsl';
import { blackbodyLinear, GALACTIC_CENTER, GALACTIC_NORTH, LMC, SMC } from './astro';

export interface StarfieldOptions {
  count: number;
  milkyWay: boolean;
  seed?: number;
  /** Overall brightness multiplier (HDR). */
  brightness?: number;
}

/**
 * Procedural night sky: thousands of point stars (power-law magnitudes, blackbody colours, concentrated
 * towards the galactic plane) plus a Milky Way band / Magellanic clouds background shader.
 * Both are drawn first with depth test off at infinite distance, so they work with any near/far.
 * Add `group` to the scene and call `update(camera)` each frame (keeps it centred on the camera).
 */
export class Starfield {
  readonly group = new THREE.Group();
  private stars: THREE.Points;
  private milky: THREE.Mesh | null = null;
  private starMat: THREE.ShaderMaterial;
  private milkyMat: THREE.ShaderMaterial | null = null;

  constructor(opts: StarfieldOptions) {
    const rnd = mulberry32(opts.seed ?? 20260703);
    const n = opts.count;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const gn = GALACTIC_NORTH;
    // Orthonormal galactic basis
    const gc = GALACTIC_CENTER;
    const gy = [gn[1] * gc[2] - gn[2] * gc[1], gn[2] * gc[0] - gn[0] * gc[2], gn[0] * gc[1] - gn[1] * gc[0]];
    for (let i = 0; i < n; i++) {
      // Magnitude: N(<m) ∝ 10^(0.5 m) → m = mLim + 2 log10(u)
      const u = Math.max(rnd(), 1e-6);
      const m = Math.max(-1.5, 7.0 + 2.0 * Math.log10(u));
      // Direction: faint stars concentrate to the galactic plane.
      let x: number, y: number, z: number;
      const disc = rnd() < (m > 4 ? 0.55 : 0.25);
      if (disc) {
        const l = rnd() * Math.PI * 2;
        // Gaussian latitude (Box–Muller), σ ≈ 12°
        const g = Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
        const b = g * 0.21;
        const cb = Math.cos(b), sb = Math.sin(b);
        const cl = Math.cos(l), sl = Math.sin(l);
        x = gc[0] * cb * cl + gy[0] * cb * sl + gn[0] * sb;
        y = gc[1] * cb * cl + gy[1] * cb * sl + gn[1] * sb;
        z = gc[2] * cb * cl + gy[2] * cb * sl + gn[2] * sb;
      } else {
        const uu = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - uu * uu);
        x = s * Math.cos(t); y = s * Math.sin(t); z = uu;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      // Temperature distribution: mostly K/G, some M, bright ones skew hot (O/B/A dominate naked-eye bright stars).
      const r = rnd();
      let T: number;
      if (m < 2 && rnd() < 0.45) T = 9000 + rnd() * 16000;
      else if (r < 0.12) T = 3000 + rnd() * 700;
      else if (r < 0.55) T = 3800 + rnd() * 1500;
      else if (r < 0.85) T = 5200 + rnd() * 1500;
      else T = 6700 + rnd() * 6000;
      const c = blackbodyLinear(T);
      // Saturation is perceptually low for stars; desaturate a little.
      const flux = 4 * Math.pow(10, -0.4 * (m - 1.0)) * (opts.brightness ?? 1);
      for (let k = 0; k < 3; k++) col[i * 3 + k] = (0.45 + 0.55 * c[k]) * flux;
      size[i] = m < 1 ? 3.2 : m < 3 ? 2.4 : 1.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPixelRatio;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vec3 d = mat3(viewMatrix) * position;
          gl_Position = projectionMatrix * vec4(d, 0.0);
          gl_Position.z = gl_Position.w * 0.99999;
          // Faint stars are kept at minimum size and dimmed instead (avoids sub-pixel shimmer).
          float s = aSize * uPixelRatio;
          gl_PointSize = s;
          vColor = aColor * uScale;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          float a = exp(-r2 * 4.0);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a * 1.6, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1000;
    this.group.add(this.stars);

    if (opts.milkyWay) {
      this.milkyMat = new THREE.ShaderMaterial({
        uniforms: {
          uGN: { value: new THREE.Vector3(...GALACTIC_NORTH) },
          uGC: { value: new THREE.Vector3(...GALACTIC_CENTER) },
          uLMC: { value: new THREE.Vector3(...LMC) },
          uSMC: { value: new THREE.Vector3(...SMC) },
          uIntensity: { value: 0.035 * (opts.brightness ?? 1) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec3 d = mat3(viewMatrix) * position;
            gl_Position = projectionMatrix * vec4(d, 0.0);
            gl_Position.z = gl_Position.w * 0.99999;
          }`,
        fragmentShader: /* glsl */ `
          ${GLSL_NOISE}
          uniform vec3 uGN, uGC, uLMC, uSMC;
          uniform float uIntensity;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float sb = dot(d, uGN);
            float b = asin(clamp(sb, -1.0, 1.0));
            vec3 gy = normalize(cross(uGN, uGC));
            float l = atan(dot(d, gy), dot(d, uGC));
            // Band thickness bulges toward the galactic centre.
            float core = exp(-pow(l / 0.6, 2.0));
            float width = 0.11 + 0.12 * core;
            float band = exp(-pow(b / width, 2.0));
            float n = fbm3(d * 6.0, 6) * 0.5 + 0.5;
            float n2 = fbm3(d * 18.0 + 3.0, 5) * 0.5 + 0.5;
            float glow = band * (0.35 + 0.9 * n) * (0.6 + 1.1 * core);
            glow += exp(-pow(b / 0.04, 2.0)) * n2 * 0.4 * (0.4 + core);
            // Dust lanes (Great Rift): dark filaments near the plane.
            float dust = smoothstep(0.45, 0.75, fbm3(d * 9.0 + 11.0, 5) * 0.5 + 0.5) * exp(-pow((b + 0.02) / 0.06, 2.0));
            glow *= 1.0 - 0.85 * dust;
            glow += exp(-pow(acos(clamp(dot(d, uGC), -1.0, 1.0)) / 0.18, 2.0)) * 0.8;
            vec3 col = mix(vec3(0.62, 0.7, 1.0), vec3(1.0, 0.88, 0.7), core * 0.7 + 0.15);
            // Magellanic clouds
            float lmc = exp(-pow(acos(clamp(dot(d, uLMC), -1.0, 1.0)) / 0.06, 2.0)) * (0.5 + n2);
            float smc = exp(-pow(acos(clamp(dot(d, uSMC), -1.0, 1.0)) / 0.04, 2.0)) * (0.5 + n2);
            vec3 c = col * glow + vec3(0.8, 0.85, 1.0) * (lmc * 0.45 + smc * 0.3);
            // Faint zodiacal/airglow floor so space is not pure black.
            c += vec3(0.02, 0.022, 0.03) * 0.15;
            gl_FragColor = vec4(c * uIntensity, 1.0);
          }`,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
      });
      this.milky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.milkyMat);
      this.milky.frustumCulled = false;
      this.milky.renderOrder = -1001;
      this.group.add(this.milky);
    }
  }

  /** Brightness multiplier (e.g. reduce when the camera is in daylight to mimic eye adaptation). */
  setBrightness(scale: number): void {
    this.starMat.uniforms.uScale.value = scale;
    if (this.milkyMat) this.milkyMat.uniforms.uIntensity.value = 0.035 * scale;
  }

  update(camera: THREE.Camera, pixelRatio = 1): void {
    // Geometry is rendered as directions (w = 0) so its position does not matter; keep transforms identity.
    this.starMat.uniforms.uPixelRatio.value = pixelRatio;
    void camera;
  }

  dispose(): void {
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.milky?.geometry.dispose();
    this.milkyMat?.dispose();
  }
}
