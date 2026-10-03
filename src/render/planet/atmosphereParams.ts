import * as THREE from 'three';
import type { BodyDef } from '../../sim/bodies/types';
import { SCALE_PRESETS, type ScaleConfig } from '../../sim/bodies/scale';

/**
 * Renderer-side atmosphere parameters derived from AtmosphereDef (+ artistic per-style tuning).
 * Coefficients are per meter in the SCALED universe: the body def's rayleigh/mie are already divided
 * by the atmosphere scale factor (scaleBodyDef), and scale heights are multiplied by it, so optical
 * depths (β·H) match the real atmosphere.
 */
export interface AtmosphereParams {
  planetRadius: number;
  atmosphereRadius: number;
  rayleighScaleHeight: number;
  mieScaleHeight: number;
  betaRayleigh: [number, number, number];
  betaMieScatter: [number, number, number];
  betaMieExt: [number, number, number];
  /** Per-channel Mie anisotropy (lets dust forward-scatter blue more — Mars blue sunsets). */
  mieG: [number, number, number];
  betaOzone: [number, number, number];
  ozoneCenter: number;
  ozoneWidth: number;
  /** Ground ambient tint multiplier (sky light). */
  ambient: number;
  /** Strength of the isotropic multiple-scattering approximation (thick hazes need more). */
  multiScatter: number;
}

const R_GAS = 8.314462618;

export function computeAtmosphereParams(body: BodyDef, scale: ScaleConfig = SCALE_PRESETS.standard): AtmosphereParams | null {
  const a = body.atmosphere;
  if (!a) return null;
  const R = body.radius;
  const g = body.gm / (R * R);
  const atmoFactor = Math.pow(scale.s, scale.atmosphereExponent);
  const hThermo = (R_GAS * a.surfaceTemperature) / (a.molarMass * Math.max(g, 0.01));
  let Hr = Math.min(hThermo * atmoFactor, a.height / 5);
  const preset = body.surface?.preset ?? '';
  const id = body.id;
  const tint = a.tint ?? [0.5, 0.5, 0.5];
  const tmax = Math.max(tint[0], tint[1], tint[2], 1e-6);
  const tintN: [number, number, number] = [tint[0] / tmax, tint[1] / tmax, tint[2] / tmax];

  let betaR: [number, number, number] = a.rayleigh ? [...a.rayleigh] : [5.8e-6 / atmoFactor, 13.5e-6 / atmoFactor, 33.1e-6 / atmoFactor];
  const mie = a.mie ?? 2e-5 / atmoFactor;
  let betaMs: [number, number, number] = [mie, mie, mie];
  let betaMe: [number, number, number] = [mie * 1.11, mie * 1.11, mie * 1.11];
  let mieG: [number, number, number] = [0.8, 0.8, 0.8];
  let Hm = Hr * 0.15;
  let betaO: [number, number, number] = [0, 0, 0];
  let ozoneCenter = 25000 * atmoFactor;
  let ozoneWidth = 15000 * atmoFactor;
  let ambient = 1;
  let multiScatter = 0.35;

  if (preset === 'earth' || id === 'earth') {
    betaO = [0.65e-6 / atmoFactor, 1.881e-6 / atmoFactor, 0.085e-6 / atmoFactor];
    Hm = Hr * 0.15;
  } else if (preset === 'mars' || id === 'mars') {
    // Suspended dust dominates: butterscotch sky (red scattered widely), blue forward lobe near the Sun.
    const dust = mie * 4;
    multiScatter = 1.0;
    const alb: [number, number, number] = [0.92, 0.62, 0.38];
    betaMe = [dust, dust * 1.02, dust * 1.05];
    betaMs = [dust * alb[0], dust * alb[1], dust * alb[2]];
    mieG = [0.5, 0.62, 0.78];
    Hm = Hr * 1.0;
    ambient = 0.9;
  } else if (preset === 'titan' || id === 'titan') {
    // Thick photochemical haze, absorbs blue strongly.
    const haze = mie * 1.6;
    betaMe = [haze, haze * 1.05, haze * 1.15];
    betaMs = [haze * 0.95, haze * 0.6, haze * 0.22];
    betaR = [betaR[0] * 0.6, betaR[1] * 0.5, betaR[2] * 0.5];
    mieG = [0.65, 0.65, 0.65];
    Hm = Hr * 1.3;
    ambient = 1.4;
    multiScatter = 3.0;
  } else if (preset === 'venus' || id === 'venus') {
    const cl = mie;
    betaMe = [cl, cl, cl];
    betaMs = [cl * 0.99, cl * 0.93, cl * 0.72];
    betaR = [betaR[0] * 0.04, betaR[1] * 0.04, betaR[2] * 0.04];
    mieG = [0.7, 0.7, 0.7];
    Hm = Hr * 1.5;
    ambient = 1.5;
    multiScatter = 3.5;
  } else if (preset === 'gasGiant' || preset === 'iceGiant') {
    const blue = preset === 'iceGiant' ? 1 : 0.15;
    betaR = [betaR[0] * blue, betaR[1] * blue, betaR[2] * blue];
    betaMe = [mie * 0.6, mie * 0.6, mie * 0.6];
    betaMs = [mie * 0.6 * tintN[0], mie * 0.6 * tintN[1], mie * 0.6 * tintN[2]];
    mieG = [0.7, 0.7, 0.7];
    Hm = Hr * 0.8;
  } else {
    // Generic thin atmosphere (e.g. Triton/Pluto haze): tinted Mie.
    betaMs = [mie * tintN[0], mie * tintN[1], mie * tintN[2]];
    betaMe = [mie * 1.1, mie * 1.1, mie * 1.1];
    Hm = Hr * 0.5;
  }
  Hr = Math.max(Hr, 1);
  Hm = Math.max(Math.min(Hm, a.height / 4), 1);
  return {
    planetRadius: R,
    atmosphereRadius: R + a.height,
    rayleighScaleHeight: Hr,
    mieScaleHeight: Hm,
    betaRayleigh: betaR,
    betaMieScatter: betaMs,
    betaMieExt: betaMe,
    mieG,
    betaOzone: betaO,
    ozoneCenter,
    ozoneWidth,
    ambient,
    multiScatter,
  };
}

/** Sea-level vertical optical depth per channel (useful for tests/tuning). */
export function verticalOpticalDepth(p: AtmosphereParams): [number, number, number] {
  return [0, 1, 2].map(
    (i) => p.betaRayleigh[i] * p.rayleighScaleHeight + p.betaMieExt[i] * p.mieScaleHeight + p.betaOzone[i] * p.ozoneWidth,
  ) as [number, number, number];
}

export const TRANSMITTANCE_LUT_SIZE = { width: 256, height: 64 };

/**
 * Transmittance LUT T(r, mu) from a point at radius r looking in direction with cos-zenith mu to the
 * top of the atmosphere (0 if the ray hits the planet). Parameterisation (matches GLSL):
 *   u = mu * 0.5 + 0.5,  v = sqrt((r − R) / (Ra − R))
 * Computed on the CPU once per body (≈16k texels × 48 steps) → HalfFloat texture.
 */
export function buildTransmittanceLUT(p: AtmosphereParams): THREE.DataTexture {
  const { width: W, height: H } = TRANSMITTANCE_LUT_SIZE;
  const data = new Uint16Array(W * H * 4);
  const R = p.planetRadius;
  const Ra = p.atmosphereRadius;
  const steps = 48;
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const r = R + v * v * (Ra - R);
    for (let i = 0; i < W; i++) {
      const mu = ((i + 0.5) / W) * 2 - 1;
      // Ray from (0, r) in direction (sqrt(1-mu²), mu).
      const b = r * mu;
      const cAtm = r * r - Ra * Ra;
      const tTop = -b + Math.sqrt(Math.max(b * b - cAtm, 0));
      const cG = r * r - R * R;
      const discG = b * b - cG;
      let hitsGround = discG > 0 && -b - Math.sqrt(discG) > 0;
      // Soft horizon: allow grazing rays slightly below the geometric horizon to fade out.
      let od0 = 0, od1 = 0, od2 = 0;
      if (!hitsGround) {
        const dt = tTop / steps;
        let odR = 0, odM0 = 0, odM1 = 0, odM2 = 0, odO = 0;
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) * dt;
          const x = Math.sqrt(1 - mu * mu) * t;
          const y = r + mu * t;
          const h = Math.sqrt(x * x + y * y) - R;
          const dR = Math.exp(-h / p.rayleighScaleHeight) * dt;
          const dM = Math.exp(-h / p.mieScaleHeight) * dt;
          const dO = Math.max(0, 1 - Math.abs(h - p.ozoneCenter) / p.ozoneWidth) * dt;
          odR += dR;
          odM0 += dM * p.betaMieExt[0];
          odM1 += dM * p.betaMieExt[1];
          odM2 += dM * p.betaMieExt[2];
          odO += dO;
        }
        od0 = p.betaRayleigh[0] * odR + odM0 + p.betaOzone[0] * odO;
        od1 = p.betaRayleigh[1] * odR + odM1 + p.betaOzone[1] * odO;
        od2 = p.betaRayleigh[2] * odR + odM2 + p.betaOzone[2] * odO;
      }
      hitsGround = hitsGround || false;
      const k = (j * W + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(hitsGround ? 0 : Math.exp(-od0));
      data[k + 1] = THREE.DataUtils.toHalfFloat(hitsGround ? 0 : Math.exp(-od1));
      data[k + 2] = THREE.DataUtils.toHalfFloat(hitsGround ? 0 : Math.exp(-od2));
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
