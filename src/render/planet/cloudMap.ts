import * as THREE from 'three';
import type { TerrainHeightFn } from '../../sim/terrain/api';
import { GLSL_NOISE } from '../core/glsl';
import { ProceduralCubeMap } from '../core/proceduralCube';
import { cloudLandMask } from './cloudCoasts';

/**
 * Synoptic weather baked once, shared by the shell and surface shadows. All coverage is in R;
 * runtime detail may only modulate that coverage. Cube directions avoid a seam or polar pinch.
 * 512/1024/1536 faces retain the performance pass's memory budget and trilinear mip chain.
 */
export class CloudMap extends ProceduralCubeMap {
  private readonly land: THREE.DataTexture;

  constructor(size: number, heightAt: TerrainHeightFn) {
    const land = new THREE.DataTexture(cloudLandMask(heightAt), 128, 64, THREE.RedFormat);
    land.wrapS = THREE.RepeatWrapping;
    land.minFilter = land.magFilter = THREE.LinearFilter;
    land.needsUpdate = true;
    super(size, GLSL_CLOUD_BAKE, {
      format: THREE.RedFormat,
      defines: { FINE_OCT: size >= 1024 ? 2 : 1, BILLOW_OCT: size >= 1024 ? 3 : 2 },
      uniforms: { uLand: { value: land } },
    });
    this.land = land;
    this.texture.anisotropy = 4;
  }

  override dispose(): void {
    this.land.dispose();
    super.dispose();
  }
}

const GLSL_CLOUD_BAKE = /* glsl */ `
${GLSL_NOISE}
uniform sampler2D uLand;
// Warping a front can compress even a low octave below a texel. Filter in the
// bake's footprint as well as limiting the octave count; never bake aliases into mip 0.
float cloudFbm(vec3 p, int octaves) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float sum = 0.0, weight = 0.5, total = 0.0;
  for (int i = 0; i < 3; i++) {
    if (i >= octaves) break;
    float band = 1.0 - smoothstep(0.12, 0.4, footprint);
    sum += weight * snoise(p) * band;
    total += weight;
    p = p * 2.03 + vec3(1.7, -3.1, 2.3);
    footprint *= 2.03;
    weight *= 0.5;
  }
  return sum / total;
}
float gaussian(float x) { return exp(-x * x); }
vec3 swirl(vec3 p, vec3 c, float radius, float strength) {
  float d = length(p - c) / radius;
  float a = strength * exp(-d * d);
  float ca = cos(a), sa = sin(a);
  return p * ca + cross(c, p) * sa + c * dot(c, p) * (1.0 - ca);
}
vec4 bake(vec3 pBF) {
  float lat = asin(clamp(pBF.z, -1.0, 1.0));
  float alat = abs(lat);
  // Broad, hemisphere-correct baroclinic curls. Deform the weather coordinates, not the
  // high-frequency detail: each comma head remains attached to its trailing frontal band.
  vec3 p = swirl(pBF, normalize(vec3(0.45, -0.55, 0.70)), 0.20, 2.4);
  p = swirl(p, normalize(vec3(-0.55, -0.35, 0.76)), 0.18, 2.2);
  p = swirl(p, normalize(vec3(0.2, 0.75, 0.63)), 0.22, 2.5);
  p = swirl(p, normalize(vec3(0.2, 0.75, -0.63)), 0.22, -2.5);
  p = swirl(p, normalize(vec3(-0.65, 0.1, -0.72)), 0.20, -2.3);
  p = swirl(p, normalize(vec3(0.5, -0.5, -0.7)), 0.20, -2.4);
  vec3 w = vec3(cloudFbm(p * 3.0, 3), cloudFbm(p * 3.0 + 5.2, 3), cloudFbm(p * 3.0 - 3.7, 3));
  vec3 q = p + w * 0.10;
  float macro = cloudFbm(q * 3.2 + vec3(13.0, 8.0, -4.0), 3);
  // Anisotropic mesoscales make long fronts instead of isotropic popcorn.
  float meso = cloudFbm(q * vec3(7.0, 7.0, 20.0) + 2.0, 3);
  float itczLat = lat - 0.045 - 0.04 * snoise(pBF * 4.0 + 2.0);
  float itcz = gaussian(itczLat / 0.13);
  float subtropics = gaussian((alat - 0.43) / 0.15);
  float storms = gaussian((alat - 0.87) / 0.30);
  float polar = smoothstep(1.10, 1.50, alat);
  float weather = macro * 0.65 + meso * 0.22 + itcz * 0.18
    - subtropics * 0.14 + storms * 0.11 + polar * 0.055 + 0.025;
  float d = smoothstep(-0.06, 0.22, weather);

  // Stratocumulus decks over cool eastern ocean basins (west of the actual fictional
  // continents). A coarse terrain mask is enough for these hundred-kilometre formations.
  vec2 uv = vec2(atan(pBF.y, pBF.x) / 6.28318530718 + 0.5, lat / 3.14159265359 + 0.5);
  float ocean = 1.0 - texture2D(uLand, uv).r;
  float coast = texture2D(uLand, uv + vec2(0.025, 0.0)).r * 0.55
    + texture2D(uLand, uv + vec2(0.055, 0.0)).r * 0.30
    + texture2D(uLand, uv + vec2(0.085, 0.0)).r * 0.15;
  float deck = ocean * coast * gaussian((alat - 0.36) / 0.22);
  deck *= smoothstep(-0.5, 0.35, cloudFbm(pBF * 8.0 + 19.0, 3));
  d = max(d, deck * 0.85);

  // Fine soft structure lives INSIDE the systems. It cannot create detached bright cells.
  // Highest frequency is 80*2.03: at least three texels even at the cube face centre.
  float fine = cloudFbm(pBF * 80.0 + w * 2.0, FINE_OCT);
  float billow = cloudFbm(pBF * 32.0 + w, BILLOW_OCT);
  d *= (0.58 + 0.42 * smoothstep(-0.5, 0.5, billow + d * 0.25)) * (0.9 + 0.1 * fine);
  return vec4(clamp(d, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;
