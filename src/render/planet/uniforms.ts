import * as THREE from 'three';
import type { AtmosphereParams } from './atmosphereParams';

/** Period (s) of the shader clock; see {@link shaderTime}. */
export const SHADER_TIME_PERIOD = 100000;
/**
 * Simulation time folded into a float32-safe uniform. Absolute UT (~1e9 s) has a 64 s float32 step, and
 * wave drift (uTime · speed) added to a detail coordinate snapped that coordinate to a 128 m grid: tilted
 * squares of sea in the sun glint. 1e5 s keeps 8 ms resolution, leaves the gas-giant mod(t, 1e5) unchanged
 * and is a whole number of the 4000 s and 12500 s effect cycles; other loops jump once a day of game time.
 */
export function shaderTime(t: number): number {
  const w = t % SHADER_TIME_PERIOD;
  return w < 0 ? w + SHADER_TIME_PERIOD : w;
}

/**
 * `speed` (per second) nudged so one {@link SHADER_TIME_PERIOD} advances a pattern repeating every `tile` by a whole
 * number of repeats: the pattern is the same either side of the wrap instead of jumping (the sea's glint changed in
 * one frame). The nudge is under 0.1 % for the ocean's drifts.
 */
export function loopingSpeed(speed: number, tile: number): number {
  return (Math.round((speed * SHADER_TIME_PERIOD) / tile) * tile) / SHADER_TIME_PERIOD;
}

/** Uniform objects shared by every material of one planet (updated once per frame). */
export interface PlanetUniforms {
  uPlanetCenter: THREE.IUniform<THREE.Vector3>;
  uPlanetRadius: THREE.IUniform<number>;
  uAtmoRadius: THREE.IUniform<number>;
  uHasAtmo: THREE.IUniform<number>;
  uCamRel: THREE.IUniform<THREE.Vector3>;
  uCamCAtm: THREE.IUniform<number>;
  uCamCGround: THREE.IUniform<number>;
  uBetaR: THREE.IUniform<THREE.Vector3>;
  uBetaMs: THREE.IUniform<THREE.Vector3>;
  uBetaMe: THREE.IUniform<THREE.Vector3>;
  uMieG: THREE.IUniform<THREE.Vector3>;
  uBetaO: THREE.IUniform<THREE.Vector3>;
  uOzoneCenter: THREE.IUniform<number>;
  uOzoneWidth: THREE.IUniform<number>;
  uHr: THREE.IUniform<number>;
  uHm: THREE.IUniform<number>;
  uAmbient: THREE.IUniform<number>;
  uMultiScatter: THREE.IUniform<number>;
  /** Integer multiplier on aerial-perspective steps (thick atmospheres need more). */
  uStepScale: THREE.IUniform<number>;
  uPlanetshineDir: THREE.IUniform<THREE.Vector3>;
  uPlanetshineColor: THREE.IUniform<THREE.Vector3>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Vector3>;
  uTransLUT: THREE.IUniform<THREE.Texture | null>;
  uHasRings: THREE.IUniform<number>;
  uRingNormal: THREE.IUniform<THREE.Vector3>;
  uRingInner: THREE.IUniform<number>;
  uRingOuter: THREE.IUniform<number>;
  uRingProfile: THREE.IUniform<THREE.Texture | null>;
  uTime: THREE.IUniform<number>;
  /** Body rotation (body-fixed → render frame) for object-space effects. */
  uBodyRot: THREE.IUniform<THREE.Matrix3>;
  /** Baked cloud cube map (body-fixed, drifting) — see cloudMap.ts; null when the body has no clouds. */
  uCloudMap: THREE.IUniform<THREE.Texture | null>;
  /** Render-frame planet-relative position → cloud-map lookup direction (drift + inverse body rotation). */
  uCloudRot: THREE.IUniform<THREE.Matrix3>;
  /** Cloud shell radius (m); 0 until the cloud map has been baked. */
  uCloudShell: THREE.IUniform<number>;
}

let dummyTex: THREE.DataTexture | null = null;
function dummy(): THREE.DataTexture {
  if (!dummyTex) {
    dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    dummyTex.needsUpdate = true;
  }
  return dummyTex;
}

export function createPlanetUniforms(radius: number, atmo: AtmosphereParams | null, lut: THREE.Texture | null): PlanetUniforms {
  const v = (a?: [number, number, number]) => new THREE.Vector3(...(a ?? [0, 0, 0]));
  return {
    uPlanetCenter: { value: new THREE.Vector3() },
    uPlanetRadius: { value: radius },
    uAtmoRadius: { value: atmo ? atmo.atmosphereRadius : radius },
    uHasAtmo: { value: atmo ? 1 : 0 },
    uCamRel: { value: new THREE.Vector3() },
    uCamCAtm: { value: 0 },
    uCamCGround: { value: 0 },
    uBetaR: { value: v(atmo?.betaRayleigh) },
    uBetaMs: { value: v(atmo?.betaMieScatter) },
    uBetaMe: { value: v(atmo?.betaMieExt) },
    uMieG: { value: v(atmo?.mieG ?? [0.8, 0.8, 0.8]) },
    uBetaO: { value: v(atmo?.betaOzone) },
    uOzoneCenter: { value: atmo?.ozoneCenter ?? 1 },
    uOzoneWidth: { value: atmo?.ozoneWidth ?? 1 },
    uHr: { value: atmo?.rayleighScaleHeight ?? 1 },
    uHm: { value: atmo?.mieScaleHeight ?? 1 },
    uAmbient: { value: atmo?.ambient ?? 0 },
    uMultiScatter: { value: atmo?.multiScatter ?? 0 },
    uStepScale: { value: atmo && atmo.multiScatter > 2 ? 3 : 1 },
    uPlanetshineDir: { value: v([1, 0, 0]) },
    uPlanetshineColor: { value: v() },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunColor: { value: new THREE.Vector3(10, 10, 10) },
    uTransLUT: { value: lut ?? dummy() },
    uHasRings: { value: 0 },
    uRingNormal: { value: new THREE.Vector3(0, 0, 1) },
    uRingInner: { value: 1 },
    uRingOuter: { value: 2 },
    uRingProfile: { value: dummy() },
    uTime: { value: 0 },
    uBodyRot: { value: new THREE.Matrix3() },
    uCloudMap: { value: null },
    uCloudRot: { value: new THREE.Matrix3() },
    uCloudShell: { value: 0 },
  };
}

// ---------------------------------------------------------------- live registry
/**
 * The current PlanetRenderer uniforms per body id, so other renderers (e.g. the launch site) can apply the
 * same aerial perspective. PlanetRenderer registers on construction and unregisters on dispose.
 */
const live = new Map<string, PlanetUniforms>();
let fallback: PlanetUniforms | null = null;

export function registerPlanetUniforms(bodyId: string, u: PlanetUniforms): void {
  live.set(bodyId, u);
}

export function unregisterPlanetUniforms(bodyId: string, u: PlanetUniforms): void {
  if (live.get(bodyId) === u) live.delete(bodyId);
}

/**
 * Uniform objects whose `.value` always reads the body's CURRENT planet uniforms (getter-backed), falling back
 * to an atmosphere-less set (uHasAtmo = 0) when no renderer exists. Safe to bind into any material once.
 */
export function livePlanetUniforms(bodyId: string): Record<string, THREE.IUniform> {
  fallback ??= createPlanetUniforms(1, null, null);
  const out: Record<string, THREE.IUniform> = {};
  for (const k of Object.keys(fallback) as (keyof PlanetUniforms)[]) {
    out[k] = {
      get value() {
        return (live.get(bodyId) ?? fallback!)[k].value;
      },
      set value(_v: unknown) {
        /* read-only proxy */
      },
    };
  }
  return out;
}
