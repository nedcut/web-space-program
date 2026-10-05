import { game } from '../../game/store';
import * as THREE from 'three';
import type { EngineModule } from '../../sim/vessel/types';

/**
 * Engine exhaust plume, rendered as a cheap analytic volume.
 *
 *  - Main volume: one convex cone-frustum hull drawn with back faces. The fragment shader intersects the
 *    view ray with the hull (in plume-local space) and integrates an axisymmetric emission field over a
 *    small fixed number of jittered steps: a hot potential core, a turbulent temperature-ramped envelope
 *    (with soot streaks for kerolox, billowy edges for solids) and shock-diamond knots with crisp Mach discs.
 *  - Haze shell: a soft facing-based shell around the upper plume (hot-gas glow), very cheap.
 *  Sea level: tight, slightly necked column with decaying diamonds. Falling ambient pressure grows the
 *  diamond spacing, adds an underexpanded bulge, and finally opens into a wide, long, faint vacuum bell.
 *  Throttle scales length, brightness, core length and diamond spacing; low throttle flickers more.
 * Attach `plume.object` to a part's 'exhaustAnchor' (plume extends along the anchor's -Y).
 * Output is linear HDR (additive; works with bloom); log-depth compatible. Two draw calls per plume,
 * shared geometry, no per-frame allocations.
 */

export type PlumeType = EngineModule['plume'];

export interface PlumeOptions {
  type: PlumeType;
  /** Nozzle exit radius, m. */
  exitRadius: number;
  /** Plume length at full throttle at sea level, m (default scales with exit radius and type). */
  length?: number;
  seed?: number;
}

export interface PlumeParams {
  /** 0..1 */
  throttle: number;
  /** Ambient static pressure, Pa (101325 = sea level). */
  ambientPressure: number;
  /** Seconds, for animation. */
  time: number;
}

export interface Plume {
  object: THREE.Group;
  update(p: PlumeParams): void;
  dispose(): void;
}

type RGB = readonly [number, number, number];

interface Style {
  /** Linear-RGB temperature ramp: hot core -> mid envelope -> cool edge; `tail` tints far downstream. */
  hot: RGB; mid: RGB; cool: RGB; tail: RGB; diamond: RGB;
  /** Sea-level full-throttle length in exit radii; vacuum length multiplier. */
  lengthFactor: number; vacLength: number;
  /** Radius profile (exit radii): vacuum expansion, sea-level necking and downstream spreading. */
  expandVac: number; neck: number; spread: number;
  /** Core: amplitude, radius (exit radii), length (fraction of plume). */
  coreAmp: number; coreR: number; coreLen: number;
  /** Envelope: amplitude, radial sharpness, cooling rate along the plume, tail tint amount. */
  envAmp: number; envK: number; ring: number; coolRate: number; tailAmt: number;
  /** Turbulent edge displacement, noise frequency (per exit radius), scroll speed, soot streak strength. */
  turb: number; noiseFreq: number; scroll: number; soot: number;
  /** Shock diamonds: amplitude, spacing (exit radii), per-cell decay, knot radius (fraction of plume radius). */
  diaAmp: number; diaSpacing: number; diaDecay: number; diaWidth: number;
  /** Brightness multiplier in vacuum; haze shell strength. */
  vacDim: number; haze: number;
  pressureSensitive: boolean;
}

const STYLES: Record<PlumeType, Style> = {
  // Kerosene: yellow-white core, sooty orange envelope with dark streaks, bright pale diamonds.
  kerolox: {
    hot: [1.0, 0.78, 0.45], mid: [1.0, 0.42, 0.09], cool: [0.55, 0.1, 0.015], tail: [0.75, 0.16, 0.03], diamond: [1.0, 0.88, 0.62],
    lengthFactor: 12, vacLength: 1.7, expandVac: 4.2, neck: 0.12, spread: 0.9,
    coreAmp: 2.6, coreR: 0.34, coreLen: 0.3, envAmp: 1.15, envK: 2.4, ring: 0.55, coolRate: 1.6, tailAmt: 0.45,
    turb: 0.45, noiseFreq: 0.5, scroll: 9, soot: 0.85,
    diaAmp: 1.8, diaSpacing: 2.0, diaDecay: 0.42, diaWidth: 0.5,
    vacDim: 0.35, haze: 0.1, pressureSensitive: true,
  },
  // Hydrogen: nearly transparent pale blue/violet with pinkish diamonds.
  hydrolox: {
    hot: [0.62, 0.68, 1.0], mid: [0.32, 0.3, 0.95], cool: [0.22, 0.1, 0.5], tail: [0.45, 0.2, 0.6], diamond: [1.0, 0.45, 0.78],
    lengthFactor: 11, vacLength: 1.8, expandVac: 5.0, neck: 0.1, spread: 0.7,
    coreAmp: 1.4, coreR: 0.34, coreLen: 0.22, envAmp: 0.16, envK: 2.4, ring: 0.3, coolRate: 2.0, tailAmt: 0.2,
    turb: 0.25, noiseFreq: 0.55, scroll: 12, soot: 0,
    diaAmp: 1.5, diaSpacing: 2.2, diaDecay: 0.36, diaWidth: 0.42,
    vacDim: 0.4, haze: 0.08, pressureSensitive: true,
  },
  // Methane: blue-violet core, orange tint downstream.
  methalox: {
    hot: [0.5, 0.56, 1.0], mid: [0.32, 0.26, 1.0], cool: [0.35, 0.12, 0.45], tail: [1.0, 0.36, 0.08], diamond: [0.85, 0.7, 1.0],
    lengthFactor: 12, vacLength: 1.75, expandVac: 4.6, neck: 0.11, spread: 0.8,
    coreAmp: 1.8, coreR: 0.34, coreLen: 0.26, envAmp: 0.36, envK: 2.2, ring: 0.45, coolRate: 1.8, tailAmt: 0.85,
    turb: 0.35, noiseFreq: 0.5, scroll: 10, soot: 0,
    diaAmp: 1.6, diaSpacing: 2.3, diaDecay: 0.38, diaWidth: 0.48,
    vacDim: 0.35, haze: 0.12, pressureSensitive: true,
  },
  // Solid motor: very bright, thick white-orange core with billowy smoky turbulent edges.
  solid: {
    hot: [1.0, 0.86, 0.62], mid: [1.0, 0.55, 0.2], cool: [0.62, 0.24, 0.07], tail: [0.55, 0.3, 0.16], diamond: [1.0, 0.95, 0.85],
    lengthFactor: 30, vacLength: 1.5, expandVac: 5, neck: -1.2, spread: 2.8,
    coreAmp: 3.6, coreR: 0.9, coreLen: 0.45, envAmp: 2.0, envK: 1.5, ring: 0.15, coolRate: 1.2, tailAmt: 0.35,
    turb: 0.7, noiseFreq: 0.4, scroll: 7, soot: 0.25,
    diaAmp: 0, diaSpacing: 2.4, diaDecay: 0.45, diaWidth: 0.55,
    vacDim: 0.45, haze: 0.3, pressureSensitive: true,
  },
  // Ion: thin faint cyan-blue beam.
  ion: {
    hot: [0.45, 0.85, 1.0], mid: [0.18, 0.45, 1.0], cool: [0.06, 0.15, 0.7], tail: [0.1, 0.25, 0.9], diamond: [0.5, 0.9, 1.0],
    lengthFactor: 16, vacLength: 1, expandVac: 0.9, neck: 0, spread: 0.3,
    coreAmp: 0.55, coreR: 0.3, coreLen: 0.9, envAmp: 0.07, envK: 2.6, ring: 0, coolRate: 1.5, tailAmt: 0,
    turb: 0.05, noiseFreq: 0.4, scroll: 20, soot: 0,
    diaAmp: 0, diaSpacing: 2, diaDecay: 1, diaWidth: 0.5,
    vacDim: 1, haze: 0.05, pressureSensitive: false,
  },
  // Monopropellant: faint whitish puff.
  monoprop: {
    hot: [0.95, 0.95, 0.92], mid: [0.75, 0.77, 0.82], cool: [0.45, 0.47, 0.55], tail: [0.5, 0.5, 0.55], diamond: [1, 1, 1],
    lengthFactor: 6, vacLength: 1.3, expandVac: 2.6, neck: 0, spread: 1.2,
    coreAmp: 0.8, coreR: 0.5, coreLen: 0.3, envAmp: 0.35, envK: 1.6, ring: 0, coolRate: 1.5, tailAmt: 0,
    turb: 0.5, noiseFreq: 0.7, scroll: 8, soot: 0,
    diaAmp: 0, diaSpacing: 2, diaDecay: 1, diaWidth: 0.5,
    vacDim: 0.7, haze: 0, pressureSensitive: true,
  },
  // Turbofan: faint hot-gas glow.
  jet: {
    hot: [1.0, 0.62, 0.35], mid: [0.55, 0.3, 0.2], cool: [0.22, 0.12, 0.1], tail: [0.2, 0.12, 0.1], diamond: [1, 0.85, 0.7],
    lengthFactor: 5, vacLength: 1, expandVac: 1.0, neck: 0.05, spread: 0.6,
    coreAmp: 0.5, coreR: 0.5, coreLen: 0.4, envAmp: 0.18, envK: 2.2, ring: 0.2, coolRate: 2.5, tailAmt: 0,
    turb: 0.4, noiseFreq: 0.6, scroll: 8, soot: 0,
    diaAmp: 0, diaSpacing: 2, diaDecay: 1, diaWidth: 0.5,
    vacDim: 1, haze: 0.1, pressureSensitive: false,
  },
  // Afterburner: blue core, orange flame and shock diamonds.
  afterburner: {
    hot: [0.55, 0.62, 1.0], mid: [1.0, 0.45, 0.12], cool: [0.6, 0.18, 0.05], tail: [0.7, 0.22, 0.05], diamond: [1.0, 0.82, 0.55],
    lengthFactor: 8, vacLength: 1, expandVac: 1.0, neck: 0.12, spread: 0.6,
    coreAmp: 3.0, coreR: 0.42, coreLen: 0.3, envAmp: 0.9, envK: 2.2, ring: 0.45, coolRate: 1.8, tailAmt: 0.3,
    turb: 0.35, noiseFreq: 0.55, scroll: 11, soot: 0,
    diaAmp: 2.0, diaSpacing: 2.2, diaDecay: 0.32, diaWidth: 0.5,
    vacDim: 1, haze: 0.12, pressureSensitive: false,
  },
};

const STEPS = 14;
/** Hull radius margin over the nominal plume radius (envelope + turbulence extend past it). */
const HULL_MARGIN = 1.42;

/** Shared radius profile (GLSL); JS mirror in `profile()` below must stay identical. */
const profileChunk = /* glsl */ `
  uniform float uAtm;
  uniform float uExpand;
  uniform float uNeck;
  uniform float uSpread;
  uniform float uBulge;
  uniform float uThrScale;
  /** Plume radius in exit radii at normalized distance v (0 nozzle .. 1 tail). */
  float profile(float v) {
    v = clamp(v, 0.0, 1.0);
    float sl = 1.0 - uNeck * smoothstep(0.0, 0.15, v) + uSpread * v * v;
    float vac = 1.0 + uExpand * pow(v, 0.55);
    float bulge = uBulge * smoothstep(0.0, 0.3, v) * (1.0 - 0.4 * smoothstep(0.3, 1.0, v));
    return (mix(vac, sl, uAtm) + bulge) * uThrScale;
  }
`;

const volumeVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uL;
  uniform float uRT;
  uniform float uRB;
  varying vec3 vLocal;
  varying vec3 vCam;
  void main() {
    float v = clamp(-position.y, 0.0, 1.0);
    float r = mix(uRT, uRB, v);
    vec3 pos = vec3(position.x * r, -v * uL, position.z * r);
    vLocal = pos;
    vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const volumeFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${profileChunk}
  uniform float uL;
  uniform float uRT;
  uniform float uRB;
  uniform float uRe;
  uniform float uTime;
  uniform float uSeed;
  uniform float uGain;
  uniform vec3 uHot;
  uniform vec3 uMid;
  uniform vec3 uCool;
  uniform vec3 uTail;
  uniform vec3 uDiamond;
  uniform float uCoreAmp;
  uniform float uCoreR;
  uniform float uCoreLen;
  uniform float uEnvAmp;
  uniform float uEnvK;
  uniform float uRing;
  uniform float uCoolRate;
  uniform float uTailAmt;
  uniform float uTurb;
  uniform float uNoiseFreq;
  uniform float uScroll;
  uniform float uSoot;
  uniform float uDiaAmp;
  uniform float uDS;
  uniform float uD0;
  uniform float uDiaDecay;
  uniform float uDiaWidth;
  varying vec3 vLocal;
  varying vec3 vCam;

  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  vec3 ramp(float T) {
    return T > 0.5 ? mix(uMid, uHot, (T - 0.5) * 2.0) : mix(uCool, uMid, T * 2.0);
  }

  vec3 emit(vec3 p) {
    float x = -p.y;
    float v = clamp(x / uL, 0.0, 1.0);
    float R = uRe * profile(v);
    float r = length(p.xz);
    float rn = r / R;
    if (rn > 1.45) return vec3(0.0);
    // turbulence: scrolls downstream, coarsens as the plume widens
    float n = vnoise(vec3(p.xz / R * 1.6, x / uRe * uNoiseFreq - uTime * uScroll) + uSeed);
    float tz = smoothstep(0.0, 0.3, v);
    float rnD = rn * (1.0 + uTurb * tz * (n - 0.5) * 1.6);
    float axial = pow(1.0 - v, 1.5) * mix(exp(-v * 2.5), 1.0, uAtm);
    // envelope: filled gaussian blended with a brighter shear-layer ring (afterburning at the edge)
    float ringD = (rnD - 0.72) * 2.6;
    float shape = mix(exp(-rnD * rnD * uEnvK), exp(-ringD * ringD), uRing);
    float env = shape * axial * smoothstep(1.42, 1.0, rn) * (uRe / R);
    float T = exp(-v * uCoolRate) * (1.0 - 0.6 * clamp(rnD, 0.0, 1.0));
    vec3 ec = mix(ramp(T), uTail, smoothstep(0.2, 0.85, v) * uTailAmt);
    float soot = 0.0;
    if (uSoot > 0.0) {
      float sn = vnoise(vec3(p.xz / R * 2.6, x / uRe * 0.14 - uTime * uScroll * 0.25) + uSeed * 1.7);
      soot = uSoot * smoothstep(0.42, 0.72, sn) * smoothstep(0.08, 0.35, v);
    }
    ec = mix(ec, uCool * 0.25, soot);
    vec3 e = ec * (env * uEnvAmp * mix(0.45, 1.0, uAtm) * (0.7 + 0.6 * n) * (1.0 - 0.7 * soot));
    return e;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = vCam;
    vec3 seg = vLocal - vCam;
    float tBack = length(seg);
    vec3 rd = seg / tBack;
    float t0 = 0.0;
    float t1 = tBack;
    // slab: nozzle plane (y=0) .. tail (y=-L)
    if (abs(rd.y) > 1e-6) {
      float ta = -ro.y / rd.y;
      float tb = (-uL - ro.y) / rd.y;
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    }
    // cone frustum: r(x) = uRT + s*x, x = -y
    float s = (uRB - uRT) / uL;
    float u = uRT - s * ro.y;
    float w = -s * rd.y;
    float A = dot(rd.xz, rd.xz) - w * w;
    float B = dot(ro.xz, rd.xz) - u * w;
    float C = dot(ro.xz, ro.xz) - u * u;
    float disc = B * B - A * C;
    if (abs(A) > 1e-7) {
      if (disc >= 0.0) {
        float sq = sqrt(disc);
        float r0 = (-B - sq) / A;
        float r1 = (-B + sq) / A;
        float lo = min(r0, r1);
        float hi = max(r0, r1);
        if (A > 0.0) {
          t0 = max(t0, lo);
          t1 = min(t1, hi);
        } else if (min(t1, lo) - t0 >= t1 - max(t0, hi)) {
          t1 = min(t1, lo);
        } else {
          t0 = max(t0, hi);
        }
      } else if (A > 0.0) {
        discard;
      }
    }
    if (t1 <= t0) discard;
    float dt = (t1 - t0) / float(${STEPS});
    float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${STEPS}; i++) {
      acc += emit(ro + rd * (t0 + (float(i) + jit) * dt));
    }
    acc *= dt;
    // potential core: thin gaussian column, integrated analytically at the ray's closest approach to the axis
    float axy = dot(rd.xz, rd.xz);
    float tc = clamp(axy > 1e-8 ? -dot(ro.xz, rd.xz) / axy : t0, t0, t1);
    vec3 pc = ro + rd * tc;
    float rcw = uRe * uCoreR * mix(1.7, 1.0, uAtm);
    float vc = -pc.y / uL;
    float b2 = dot(pc.xz, pc.xz) / (rcw * rcw);
    float chord = min(rcw * 1.121 / max(sqrt(axy), 1e-4), t1 - t0);
    acc += uHot * (uCoreAmp * exp(-2.5 * b2) * (1.0 - smoothstep(uCoreLen * 0.3, uCoreLen, vc)) * chord);
    // shock diamonds (also analytic at closest approach): rhombus knots with a crisp Mach disc at their
    // widest point, decaying downstream
    if (uDiaAmp > 0.0) {
      float ph = (-pc.y - uD0) / uDS;
      if (ph > 0.0) {
        float idx = floor(ph);
        float f = ph - idx;
        float tri = 1.0 - abs(2.0 * f - 1.0);
        float rd0 = uRe * (1.0 + 0.6 * (1.0 - uAtm)) * uThrScale;
        float bd = length(pc.xz);
        float invS = 1.0 / max(sqrt(axy), 1e-4);
        float span = t1 - t0;
        float wd = (0.06 + uDiaWidth * pow(tri, 0.8)) * rd0;
        float knot = exp(-1.6 * bd * bd / (wd * wd)) * (0.3 + 0.7 * tri) * min(wd * 1.4 * invS, span);
        float df = (f - 0.5) / 0.045;
        float rD = uDiaWidth * 0.9 * rd0;
        float disc = exp(-df * df) * min(2.0 * sqrt(max(rD * rD - bd * bd, 0.0)) * invS, span);
        acc += uDiamond * ((knot * 0.9 + disc * 1.0) * uDiaAmp * exp(-idx * uDiaDecay) * (1.0 - smoothstep(0.35, 0.75, -pc.y / uL)));
      }
    }
    gl_FragColor = vec4(acc * (uGain / uRe), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const hazeVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${profileChunk}
  uniform float uL;
  uniform float uRe;
  varying float vV;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float v = clamp(-position.y, 0.0, 1.0);
    float len = uL * 0.55;
    float vv = v * 0.55;
    float r = uRe * (profile(vv) * 1.55 + 0.25);
    float dr = (uRe * profile(min(vv + 0.01, 1.0)) * 1.55 + 0.25 * uRe - r) / (0.01 * uL);
    vec3 pos = vec3(position.x * r, -v * len, position.z * r);
    vV = v;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vView = mv.xyz;
    vN = normalize(normalMatrix * vec3(position.x, dr, position.z));
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const hazeFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uHaze;
  uniform vec3 uMid;
  uniform vec3 uHot;
  varying float vV;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    #include <logdepthbuf_fragment>
    float facing = abs(dot(normalize(vN), normalize(-vView)));
    float a = facing * facing * facing * pow(1.0 - vV, 2.0) * smoothstep(0.0, 0.08, vV);
    vec3 c = mix(uMid, uHot, 0.35) * (a * uHaze);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let hullGeo: THREE.BufferGeometry | null = null;
let hazeGeo: THREE.BufferGeometry | null = null;
/** Closed unit cylinder y=0 (nozzle) .. y=-1 (tail); reshaped into the cone-frustum hull in the shader. */
function hullGeometry(): THREE.BufferGeometry {
  if (!hullGeo) {
    hullGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, false);
    hullGeo.translate(0, -0.5, 0);
  }
  return hullGeo;
}
/** Open unit cylinder with rings packed toward the nozzle. */
function hazeGeometry(): THREE.BufferGeometry {
  if (!hazeGeo) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 24, 12, true);
    g.translate(0, -0.5, 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, -Math.pow(-p.getY(i), 1.4));
    hazeGeo = g;
  }
  return hazeGeo;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** JS mirror of the GLSL `profile()`. */
function profile(v: number, atm: number, st: Style, bulge: number, thrScale: number): number {
  const sl = 1 - st.neck * smoothstep(0, 0.15, v) + st.spread * v * v;
  const vac = 1 + st.expandVac * Math.pow(v, 0.55);
  const b = bulge * smoothstep(0, 0.3, v) * (1 - 0.4 * smoothstep(0.3, 1, v));
  return (vac + (sl - vac) * atm + b) * thrScale;
}

/** Normalized atmosphere factor 0 (vacuum) .. 1 (sea level), spread smoothly over 0..1 atm. */
export function plumeAtmosphere(ambientPressure: number): number {
  return smoothstep(0, 1, Math.sqrt(Math.max(0, ambientPressure) / 101325));
}

const vec = (c: RGB) => new THREE.Vector3(c[0], c[1], c[2]);

export function createPlume(opts: PlumeOptions): Plume {
  const st = STYLES[opts.type] ?? STYLES.kerolox;
  const re = Math.max(0.02, opts.exitRadius);
  const length = opts.length ?? re * st.lengthFactor + 0.5;
  const seed = opts.seed ?? Math.random() * 100;
  const seedOff = (seed * 7.31) % 97;
  const group = new THREE.Group();
  group.name = 'plume';

  // uniforms shared by both materials (one update per frame)
  const u = {
    uTime: { value: 0 },
    uSeed: { value: seedOff },
    uGain: { value: 1 },
    uAtm: { value: 1 },
    uExpand: { value: st.expandVac },
    uNeck: { value: st.neck },
    uSpread: { value: st.spread },
    uBulge: { value: 0 },
    uThrScale: { value: 1 },
    uL: { value: length },
    uRT: { value: re * HULL_MARGIN },
    uRB: { value: re * 2 },
    uRe: { value: re },
    uHot: { value: vec(st.hot) },
    uMid: { value: vec(st.mid) },
    uCool: { value: vec(st.cool) },
    uTail: { value: vec(st.tail) },
    uDiamond: { value: vec(st.diamond) },
    uCoreAmp: { value: st.coreAmp },
    uCoreR: { value: st.coreR },
    uCoreLen: { value: st.coreLen },
    uEnvAmp: { value: st.envAmp },
    uEnvK: { value: st.envK },
    uRing: { value: st.ring },
    uCoolRate: { value: st.coolRate },
    uTailAmt: { value: st.tailAmt },
    uTurb: { value: st.turb },
    uNoiseFreq: { value: st.noiseFreq },
    uScroll: { value: st.scroll },
    uSoot: { value: st.soot },
    uDiaAmp: { value: 0 },
    uDS: { value: re * st.diaSpacing },
    uD0: { value: 0 },
    uDiaDecay: { value: st.diaDecay },
    uDiaWidth: { value: st.diaWidth },
    uHaze: { value: 0 },
  };

  const volumeMat = new THREE.ShaderMaterial({
    vertexShader: volumeVertex,
    fragmentShader: volumeFragment,
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  const hazeMat = new THREE.ShaderMaterial({
    vertexShader: hazeVertex,
    fragmentShader: hazeFragment,
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const volume = new THREE.Mesh(hullGeometry(), volumeMat);
  volume.frustumCulled = false;
  volume.renderOrder = 10;
  group.add(volume);
  const haze = new THREE.Mesh(hazeGeometry(), hazeMat);
  haze.frustumCulled = false;
  haze.renderOrder = 9;
  haze.visible = st.haze > 0;
  group.add(haze);

  return {
    object: group,
    update({ throttle, ambientPressure, time }) {
      const thr = Math.max(0, Math.min(1, throttle));
      group.visible = thr > 0.001;
      if (!group.visible) return;
      const a = st.pressureSensitive ? plumeAtmosphere(ambientPressure) : 1;
      const still = game.get().settings.reduceMotion;
      const t = still ? 0 : time % 512;

      // flicker: stronger at low throttle; startup at very low throttle is subtle
      const flAmp = 0.06 + 0.3 * (1 - thr) * (1 - thr);
      const wob = still ? 0 : Math.sin(t * 41 + seed) * 0.5 + Math.sin(t * 67.3 + seed * 2.1) * 0.3 + Math.sin(t * 13.7 + seed * 0.7) * 0.2;
      const flick = 1 + flAmp * wob;
      const thrGain = smoothstep(0, 0.2, thr) * (0.3 + 0.7 * thr);

      const bulge = st.expandVac * 0.32 * 4 * a * (1 - a);
      const thrScale = 0.85 + 0.15 * thr;
      const L = length * (st.vacLength + (1 - st.vacLength) * a) * (0.3 + 0.7 * thr) * (1 + 0.04 * (flick - 1));

      // conservative convex cone hull around the radius profile
      let rMax = 0;
      for (let i = 0; i <= 16; i++) rMax = Math.max(rMax, profile(i / 16, a, st, bulge, thrScale));
      const rb = rMax * HULL_MARGIN * 1.03;
      let rt = profile(0, a, st, bulge, thrScale) * HULL_MARGIN;
      for (let i = 1; i < 16; i++) {
        const v = i / 16;
        rt = Math.max(rt, (profile(v, a, st, bulge, thrScale) * HULL_MARGIN * 1.03 - rb * v) / (1 - v));
      }

      u.uTime.value = t;
      u.uAtm.value = a;
      u.uBulge.value = bulge;
      u.uThrScale.value = thrScale;
      u.uL.value = L;
      u.uRT.value = rt * re;
      u.uRB.value = Math.max(rb, rt) * re;
      u.uGain.value = thrGain * flick * (st.vacDim + (1 - st.vacDim) * a);
      u.uCoreLen.value = st.coreLen * (0.45 + 0.55 * thr) * (0.6 + 0.4 * a) * (1 + 0.5 * (flick - 1));
      const ds = re * st.diaSpacing * (0.7 + 0.3 * thr) * (1.8 - 0.8 * a);
      u.uDS.value = ds;
      u.uD0.value = 0;
      u.uDiaAmp.value = st.diaAmp * smoothstep(0.3, 0.95, a) * (0.4 + 0.6 * thr);
      u.uDiaDecay.value = st.diaDecay * (1 + 1.5 * (1 - a));
      u.uHaze.value = st.haze * thrGain * flick * (0.35 + 0.65 * a);
    },
    dispose() {
      volumeMat.dispose();
      hazeMat.dispose();
    },
  };
}
