import * as THREE from 'three';
import { GLSL_ATMOSPHERE } from '../planet/shaders/atmosphere.glsl';
import { livePlanetUniforms } from '../planet/uniforms';

/**
 * Patch a built-in lit material so its output gets the planet's single-scattering aerial perspective (same
 * function and live uniforms as the terrain), keeping hand-built ground objects consistent with the terrain
 * haze at any distance. Must be called before the material is first compiled.
 */
export function withAerialPerspective<M extends THREE.Material>(mat: M, bodyId: string, steps = 4): M {
  const uniforms = livePlanetUniforms(bodyId);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vAtmoWorld;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 aw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            aw = instanceMatrix * aw;
          #endif
          vAtmoWorld = (modelMatrix * aw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 vAtmoWorld;\n${GLSL_ATMOSPHERE}\nvoid main() {`)
      .replace(
        '#include <tonemapping_fragment>',
        `{
          vec3 toCamA = cameraPosition - vAtmoWorld;
          float dA = max(length(toCamA), 1e-3);
          gl_FragColor.rgb = applyAerialPerspective(gl_FragColor.rgb, -toCamA / dA, dA, ${steps});
        }
        #include <tonemapping_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `aerial:${bodyId}:${steps}`;
  return mat;
}
