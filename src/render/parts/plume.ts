import * as THREE from 'three';
import type { EngineModule } from '../../sim/vessel/types';

/**
 * Engine exhaust plume: layered additive shells deformed in the vertex shader.
 *  - Near sea level the plume is narrow, slightly necked, with bright shock diamonds.
 *  - As ambient pressure drops it lengthens and balloons outward, dimming as it expands.
 *  - Noise-driven flicker scrolls down the plume; throttle scales length and brightness.
 * Attach `plume.object` to a part's 'exhaustAnchor' (plume extends along the anchor's -Y).
 * Output is linear HDR (works with bloom); log-depth compatible.
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

interface Style {
  core: number;
  edge: number;
  diamond: number;
  intensity: number;
  lengthFactor: number;
  expandVac: number;
  diamonds: number;
  diamondStrength: number;
  falloff: number;
  coreScale: number;
  vacDim: number;
  pressureSensitive: boolean;
}

const STYLES: Record<PlumeType, Style> = {
  kerolox: { core: 0xffd890, edge: 0xff5a10, diamond: 0xfff0c0, intensity: 0.9, lengthFactor: 13, expandVac: 4.5, diamonds: 6, diamondStrength: 1.6, falloff: 1.8, coreScale: 0.5, vacDim: 0.3, pressureSensitive: true },
  hydrolox: { core: 0xb8c8ff, edge: 0x4050ff, diamond: 0xffb0e8, intensity: 0.32, lengthFactor: 11, expandVac: 5.5, diamonds: 7, diamondStrength: 4, falloff: 2.4, coreScale: 0.42, vacDim: 0.35, pressureSensitive: true },
  methalox: { core: 0xc0d0ff, edge: 0x3a40ff, diamond: 0xc8a8ff, intensity: 0.55, lengthFactor: 12, expandVac: 5, diamonds: 7, diamondStrength: 2.6, falloff: 2.1, coreScale: 0.45, vacDim: 0.32, pressureSensitive: true },
  solid: { core: 0xfff4d8, edge: 0xff8a28, diamond: 0xffffff, intensity: 1.3, lengthFactor: 22, expandVac: 3.5, diamonds: 5, diamondStrength: 0.7, falloff: 1.1, coreScale: 0.65, vacDim: 0.35, pressureSensitive: true },
  ion: { core: 0x90d0ff, edge: 0x2a50ff, diamond: 0x90d0ff, intensity: 0.14, lengthFactor: 14, expandVac: 0.9, diamonds: 0, diamondStrength: 0, falloff: 2.8, coreScale: 0.35, vacDim: 1, pressureSensitive: false },
  monoprop: { core: 0xf0f0ec, edge: 0xa8acb4, diamond: 0xffffff, intensity: 0.25, lengthFactor: 6, expandVac: 2.5, diamonds: 0, diamondStrength: 0, falloff: 1.6, coreScale: 0.5, vacDim: 0.6, pressureSensitive: true },
};

const vertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uThrottle;
  uniform float uAtm;
  uniform float uExitR;
  uniform float uLength;
  uniform float uExpandVac;
  uniform float uRadiusScale;
  uniform float uDiamonds;
  varying float vV;
  varying vec3 vRad;
  varying vec3 vNormalV;
  varying vec3 vViewPos;

  float radiusAt(float v) {
    float rVac = 1.0 + uExpandVac * pow(v, 0.55);
    float neck = 1.0 - 0.22 * v + 0.035 * sin(v * uDiamonds * 6.28318) * (1.0 - v);
    // slight bulge right at the exit when underexpanded at altitude
    return mix(rVac, neck, uAtm) * uExitR * uRadiusScale * (0.9 + 0.1 * uThrottle);
  }

  void main() {
    float v = clamp(-position.y, 0.0, 1.0);
    float len = uLength * mix(1.7, 1.0, uAtm) * (0.3 + 0.7 * uThrottle);
    float r = radiusAt(v);
    float dr = (radiusAt(min(v + 0.01, 1.0)) - r) / 0.01;
    vec2 radial = position.xz;
    vec3 pos = vec3(radial.x * r, -v * len, radial.y * r);
    vec3 n = normalize(vec3(radial.x, dr / max(len, 1e-3), radial.y));
    vV = v;
    vRad = vec3(radial, v);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uThrottle;
  uniform float uAtm;
  uniform float uIntensity;
  uniform float uDiamonds;
  uniform float uDiamondStrength;
  uniform float uFalloff;
  uniform float uVacDim;
  uniform float uSeed;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform vec3 uDiamond;
  varying float vV;
  varying vec3 vRad;
  varying vec3 vNormalV;
  varying vec3 vViewPos;

  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main() {
    #include <logdepthbuf_fragment>
    float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
    float body = pow(facing, uFalloff);
    float v = vV;
    float along = exp(-v * mix(1.6, 2.6, uAtm)) * smoothstep(1.0, 0.55, v) * smoothstep(0.0, 0.03, v + 0.01);
    vec3 q = vec3(vRad.x * 2.0, vRad.y * 2.0, v * 9.0 - uTime * 14.0) + uSeed;
    float n = noise3(q) * 0.6 + noise3(q * 2.3 + 7.0) * 0.4;
    float flicker = 0.7 + 0.6 * n;
    float pulse = 0.94 + 0.06 * sin(uTime * 53.0 + uSeed) * sin(uTime * 31.0);
    float d = 0.0;
    if (uDiamonds > 0.0) {
      float c = 0.5 + 0.5 * cos(v * uDiamonds * 6.28318);
      d = pow(c, 6.0) * exp(-v * 3.5) * smoothstep(0.02, 0.08, v) * uAtm * uDiamondStrength * pow(facing, 5.0);
    }
    float t = clamp(v * 1.4 + (1.0 - facing) * 0.5, 0.0, 1.0);
    vec3 col = mix(uCore, uEdge, smoothstep(0.0, 0.8, t));
    float dim = mix(uVacDim, 1.0, uAtm);
    vec3 outc = (col * along * body * flicker + uDiamond * d * body) * uIntensity * dim * pulse * (0.35 + 0.65 * uThrottle);
    gl_FragColor = vec4(outc, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let sharedGeo: THREE.BufferGeometry | null = null;
function plumeGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) {
    // unit open cylinder from y=0 (nozzle) to y=-1 (tail); denser rings near the nozzle
    const g = new THREE.CylinderGeometry(1, 1, 1, 32, 48, true);
    g.translate(0, -0.5, 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = -p.getY(i);
      p.setY(i, -Math.pow(v, 1.5));
    }
    sharedGeo = g;
  }
  return sharedGeo;
}

export function createPlume(opts: PlumeOptions): Plume {
  const st = STYLES[opts.type] ?? STYLES.kerolox;
  const length = opts.length ?? opts.exitRadius * st.lengthFactor + 0.5;
  const seed = opts.seed ?? Math.random() * 100;
  const group = new THREE.Group();
  group.name = 'plume';
  const mats: THREE.ShaderMaterial[] = [];

  const layer = (radiusScale: number, lengthScale: number, intensity: number, core: number, edge: number, falloff: number) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uThrottle: { value: 1 },
        uAtm: { value: 1 },
        uExitR: { value: opts.exitRadius },
        uLength: { value: length * lengthScale },
        uExpandVac: { value: st.expandVac },
        uRadiusScale: { value: radiusScale },
        uDiamonds: { value: st.diamonds },
        uDiamondStrength: { value: st.diamondStrength },
        uFalloff: { value: falloff },
        uVacDim: { value: st.vacDim },
        uIntensity: { value: intensity },
        uSeed: { value: seed },
        uCore: { value: new THREE.Color(core) },
        uEdge: { value: new THREE.Color(edge) },
        uDiamond: { value: new THREE.Color(st.diamond) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    mats.push(m);
    const mesh = new THREE.Mesh(plumeGeometry(), m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
  };
  // outer envelope, then a bright inner core
  layer(1.0, 1.0, st.intensity * 0.5, st.core, st.edge, st.falloff);
  layer(st.coreScale, 0.4, st.intensity, 0xffffff, st.core, st.falloff * 0.8);

  return {
    object: group,
    update({ throttle, ambientPressure, time }) {
      const thr = Math.max(0, Math.min(1, throttle));
      group.visible = thr > 0.001;
      const atm = st.pressureSensitive ? THREE.MathUtils.smoothstep(ambientPressure / 101325, 0.0, 0.35) : 0;
      for (const m of mats) {
        m.uniforms.uTime.value = time;
        m.uniforms.uThrottle.value = thr;
        m.uniforms.uAtm.value = atm;
      }
    },
    dispose() {
      for (const m of mats) m.dispose();
    },
  };
}
