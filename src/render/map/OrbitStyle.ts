import * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/** Shared uniforms, populated with camera-relative coordinates before drawing. */
export class OrbitStyle {
  readonly occluders = Array.from({ length: 12 }, () => new THREE.Vector4());
  readonly uniforms = {
    mapOccluders: { value: this.occluders }, mapCount: { value: 0 },
    mapDistance: { value: 1 }, mapVessel: { value: new THREE.Vector3() },
  };
  configure(material: LineMaterial, trajectory: boolean) {
    material.depthTest = false; // Analytic soft occlusion retains a faint navigable silhouette.
    material.transparent = true;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.mapTrajectory = { value: trajectory ? 1 : 0 };
      shader.vertexShader = 'varying vec3 vMapPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('vec4 start =',
        'vMapPosition = (modelMatrix * vec4(position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;\nvec4 start =');
      shader.vertexShader = shader.vertexShader.replace('offset *= linewidth;', 'offset *= linewidth + 2.0;');
      shader.fragmentShader = `varying vec3 vMapPosition;
        uniform vec4 mapOccluders[12]; uniform int mapCount;
        uniform float mapDistance, mapTrajectory; uniform vec3 mapVessel;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );', `
        // Derivative coverage works even when the map bypasses the post-AA pipeline.
        // Flat segment ends: rounded caps of adjacent semi-transparent segments overlapped and
        // doubled the alpha at every joint, which read as a beaded/dotted line.
        if (abs(vUv.y) > 1.) discard;
        float capsule = abs(vUv.x);
        float edgeDistance = capsule * (linewidth + 2.) * .5 - linewidth * .5;
        float pixelAA = max(.5, fwidth(edgeDistance) * .5);
        alpha *= 1. - smoothstep(-pixelAA, pixelAA, edgeDistance);
        #ifdef USE_DASH
          float dashAt = mod(vLineDistance + dashOffset, dashSize + gapSize);
          float dashAA = max(fwidth(vLineDistance), .001);
          alpha *= smoothstep(0., dashAA, dashAt) * (1. - smoothstep(dashSize - dashAA, dashSize, dashAt));
        #endif
        vec3 ray = vMapPosition - cameraPosition;
        float rayLength = length(ray); vec3 direction = ray / max(rayLength, 1.);
        float occlusion = 1.;
        for (int i = 0; i < 12; i++) {
          if (i >= mapCount) break;
          vec3 center = mapOccluders[i].xyz - cameraPosition;
          float along = dot(center, direction);
          float side = length(center - direction * along);
          float radius = mapOccluders[i].w;
          float edge = max(radius * .025, 1.);
          float front = along - sqrt(max(radius*radius-side*side, 0.));
          if (along > 0. && rayLength > front + edge)
            occlusion *= mix(.08, 1., smoothstep(radius - edge, radius + edge, side));
        }
        float focusFade = mix(.18, 1., exp(-length(vMapPosition) / max(mapDistance * 5., 1.)));
        float vesselFade = mix(.30, 1., exp(-length(vMapPosition-mapVessel) / max(mapDistance * .6, 1.)));
        gl_FragColor = vec4(diffuseColor.rgb, alpha * occlusion * focusFade * mix(1., vesselFade, mapTrajectory));
      `);
    };
    material.customProgramCacheKey = () => `map-orbit-${trajectory}`;
  }
}
