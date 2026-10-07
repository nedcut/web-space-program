import * as THREE from 'three';

// WebGL validates sampler completeness even when the enabled uniform skips sampling.
// Explicit storage also keeps the standalone planet preview valid without a solar shadow pass.
const emptyDepth = new THREE.DepthTexture(1, 1);
emptyDepth.compareFunction = THREE.LessEqualCompare;
emptyDepth.needsUpdate = true;

/** Existing solar shadow map, shared with custom terrain shaders. No second render pass. */
export const siteShadowUniforms = {
  uSiteShadowMap: { value: emptyDepth as THREE.Texture },
  uSiteShadowMatrix: { value: new THREE.Matrix4() },
  uSiteShadowTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
  uSiteShadowEnabled: { value: 0 },
};
export function updateSiteShadow(light: THREE.DirectionalLight, enabled: boolean): void {
  const s = light.shadow;
  siteShadowUniforms.uSiteShadowEnabled.value = enabled && !!s.map ? 1 : 0;
  siteShadowUniforms.uSiteShadowMap.value = enabled ? s.map?.depthTexture ?? emptyDepth : emptyDepth;
  // Keep the live matrix reference: three updates it when rendering the shadow pass.
  siteShadowUniforms.uSiteShadowMatrix.value = s.matrix;
  siteShadowUniforms.uSiteShadowTexel.value.set(1 / s.mapSize.x, 1 / s.mapSize.y);
}
export const GLSL_SITE_SHADOW = /* glsl */ `
uniform highp sampler2DShadow uSiteShadowMap;
uniform mat4 uSiteShadowMatrix;
uniform vec2 uSiteShadowTexel;
uniform float uSiteShadowEnabled;
float siteShadow(vec3 world) {
  if (uSiteShadowEnabled < 0.5) return 1.0;
  vec4 p = uSiteShadowMatrix * vec4(world, 1.0);
  vec3 q = p.xyz / p.w;
  if (min(min(q.x, q.y), q.z) <= 0.0 || max(max(q.x, q.y), q.z) >= 1.0) return 1.0;
  float visibility = 0.0;
  for (int x = 0; x < 2; x++) for (int y = 0; y < 2; y++) {
    visibility += texture(uSiteShadowMap, vec3(q.xy + (vec2(float(x), float(y)) - 0.5) * uSiteShadowTexel, q.z - 0.00015));
  }
  return visibility * 0.25;
}
`;

/** Drop GPU references when a scene releases its renderer. */
export function clearSiteShadow(): void {
  siteShadowUniforms.uSiteShadowEnabled.value = 0;
  siteShadowUniforms.uSiteShadowMap.value = emptyDepth;
}
