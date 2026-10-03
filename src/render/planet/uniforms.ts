import * as THREE from 'three';
import type { AtmosphereParams } from './atmosphereParams';

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
  };
}
