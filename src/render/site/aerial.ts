import * as THREE from 'three';
import { GLSL_ATMOSPHERE } from '../planet/shaders/atmosphere.glsl';
import { livePlanetUniforms } from '../planet/uniforms';

/**
 * Patch a built-in lit material so its output gets the planet's single-scattering aerial perspective (same
 * function and live uniforms as the terrain), keeping hand-built ground objects consistent with the terrain
 * haze at any distance. Must be called before the material is first compiled.
 *
 * Like the terrain, the scattering is integrated per vertex and applied per fragment (`color × T + L`): the
 * launch complex and its vegetation fill much of the pad view, and with logarithmic depth (no early-Z) every
 * overdrawn fragment paid for the integration. Site geometry is finely tessellated where it is near; large
 * faces (assembly building, aprons, runway strips) are far or subdivided, where the haze varies smoothly.
 */
export function withAerialPerspective<M extends THREE.Material>(mat: M, bodyId: string, steps = 4): M {
  const uniforms = livePlanetUniforms(bodyId);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `varying vec3 vAtmoWorld;\nvarying vec3 vAerialL;\nvarying vec3 vAerialT;\n${GLSL_ATMOSPHERE}\nvoid main() {`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 aw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            aw = instanceMatrix * aw;
          #endif
          vAtmoWorld = (modelMatrix * aw).xyz;
          vAerialL = vec3(0.0);
          vAerialT = vec3(1.0);
          vec3 toCamA = cameraPosition - vAtmoWorld;
          float dA = max(length(toCamA), 1e-3);
          vec3 rdA = -toCamA / dA;
          if (uHasAtmo > 0.5) {
            vec2 segA = cameraAtmoSegment(rdA, dA);
            // The per-segment integration is exact in a homogeneous medium, and over the site's short, nearly level
            // rays the air barely changes: one or two segments match the full march while costing a fraction of it.
            if (segA.y > segA.x) integrateScattering(uCamRel, rdA, segA.x, segA.y, dA < 4000.0 ? 1 : dA < 20000.0 ? 2 : ${steps}, vAerialL, vAerialT);
          }
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vAtmoWorld;\nvarying vec3 vAerialL;\nvarying vec3 vAerialT;\nvoid main() {')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = gl_FragColor.rgb * vAerialT + vAerialL;\n#include <tonemapping_fragment>');
  };
  mat.customProgramCacheKey = () => `aerial3:${bodyId}:${steps}`;
  return mat;
}
