import * as THREE from 'three';

/**
 * Terrain cutouts: up to two rounded boxes (in a local tangent frame) where the terrain shader discards
 * fragments, so hand-built ground geometry (launch pad deck, flame trench) can replace the terrain surface
 * without z-fighting and with real holes. One shared uniform set per body id; written by whoever owns the
 * site geometry (e.g. `LaunchSite.update`) and read by every terrain material of that body.
 */
export interface TerrainCutoutUniforms {
  /** Render-space → local (site) frame. */
  uCutMatrix: THREE.IUniform<THREE.Matrix4>;
  /** Box A: (centreX, centreZ, halfX, halfZ) in local metres. */
  uCutA: THREE.IUniform<THREE.Vector4>;
  /** Box B: (centreX, centreZ, halfX, halfZ) in local metres. */
  uCutB: THREE.IUniform<THREE.Vector4>;
  /** (cornerRadiusA, cornerRadiusB, |local y| limit, enabled 0/1). */
  uCutParams: THREE.IUniform<THREE.Vector4>;
}

const registry = new Map<string, TerrainCutoutUniforms>();

export function terrainCutout(bodyId: string): TerrainCutoutUniforms {
  let c = registry.get(bodyId);
  if (!c) {
    c = {
      uCutMatrix: { value: new THREE.Matrix4() },
      uCutA: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCutB: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCutParams: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    registry.set(bodyId, c);
  }
  return c;
}

export const GLSL_CUTOUT = /* glsl */ `
  uniform mat4 uCutMatrix;
  uniform vec4 uCutA;
  uniform vec4 uCutB;
  uniform vec4 uCutParams;
  float cutBox(vec2 p, vec4 b, float r) {
    vec2 q = abs(p - b.xy) - (b.zw - vec2(r));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void applyCutout(vec3 worldPos) {
    if (uCutParams.w < 0.5) return;
    vec3 lp = (uCutMatrix * vec4(worldPos, 1.0)).xyz;
    if (abs(lp.y) > uCutParams.z) return;
    if (cutBox(lp.xz, uCutA, uCutParams.x) < 0.0 || cutBox(lp.xz, uCutB, uCutParams.y) < 0.0) discard;
  }
`;
