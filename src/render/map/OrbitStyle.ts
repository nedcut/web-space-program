import * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/**
 * Per-line look. All lengths are CSS pixels (the line material's resolution is the CSS viewport, the map renders at
 * device resolution, so a 1 CSS px feature is 2 device px on a Retina display).
 */
export interface OrbitLook {
  /** Dark rim drawn just outside the core, keeps a line legible over bright planet discs. */
  outline: number;
  /** Rim opacity. */
  outlineAlpha: number;
  /** Soft glow in the line colour beyond the rim (0 = none). */
  glow: number;
  /** Glow width. */
  glowWidth: number;
  /** Apply the vessel-distance brightness gradient (current, unplanned trajectory only). */
  vesselFade: boolean;
}

export const BODY_LOOK: OrbitLook = { outline: 1, outlineAlpha: .45, glow: 0, glowWidth: 0, vesselFade: false };
export const TRAJECTORY_LOOK: OrbitLook = { outline: 1.25, outlineAlpha: .75, glow: .30, glowWidth: 5, vesselFade: true };
export const PLANNED_LOOK: OrbitLook = { outline: 1.25, outlineAlpha: .75, glow: .30, glowWidth: 5, vesselFade: false };
export const GIZMO_LOOK: OrbitLook = { outline: 1, outlineAlpha: .6, glow: 0, glowWidth: 0, vesselFade: false };

/** Per-material uniforms (set from the CPU each frame where needed). */
export interface OrbitUniforms {
  mapPad: { value: number };
  mapOutline: { value: THREE.Vector2 };
  mapGlow: { value: THREE.Vector2 };
  /** 0..1: how far this conic is "larger than the screen"; fades it and its off-centre parts (parent orbits). */
  mapLarge: { value: number };
  mapTrajectory: { value: number };
}

export function orbitUniforms(line: { material: LineMaterial }): OrbitUniforms {
  return line.material.userData.mapUniforms as OrbitUniforms;
}

/** Shared uniforms, populated with camera-relative coordinates before drawing. */
export class OrbitStyle {
  readonly occluders = Array.from({ length: 12 }, () => new THREE.Vector4());
  readonly uniforms = {
    mapOccluders: { value: this.occluders }, mapCount: { value: 0 },
    mapDistance: { value: 1 }, mapVessel: { value: new THREE.Vector3() },
    mapViewport: { value: new THREE.Vector2(1, 1) },
  };
  configure(material: LineMaterial, look: OrbitLook) {
    material.depthTest = false; // Analytic soft occlusion retains a faint navigable silhouette.
    material.transparent = true;
    const own: OrbitUniforms = {
      mapPad: { value: Math.max(1, look.outline + look.glowWidth + 1) },
      mapOutline: { value: new THREE.Vector2(look.outline, look.outlineAlpha) },
      mapGlow: { value: new THREE.Vector2(look.glow, Math.max(.5, look.glowWidth)) },
      mapLarge: { value: 0 },
      mapTrajectory: { value: look.vesselFade ? 1 : 0 },
    };
    material.userData.mapUniforms = own;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms, own);
      shader.vertexShader = 'varying vec3 vMapPosition;\nvarying vec3 vMapClip;\nuniform float mapPad;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('gl_Position = clip;', 'gl_Position = clip;\nvMapClip = clip.xyw;');
      shader.vertexShader = shader.vertexShader.replace('vec4 start =',
        'vMapPosition = (modelMatrix * vec4(position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;\nvec4 start =');
      // Widen the quad so the rim and glow fit; the fragment shader rebuilds exact coverage analytically.
      shader.vertexShader = shader.vertexShader.replace('offset *= linewidth;', 'offset *= linewidth + 2.0 * mapPad;');
      // The stock dash test discards whole gap fragments; dashes are antialiased below instead.
      shader.fragmentShader = shader.fragmentShader.replace(/if \( mod\( vLineDistance \+ dashOffset, dashSize \+ gapSize \) > dashSize \) discard;/, '');
      shader.fragmentShader = `varying vec3 vMapPosition; varying vec3 vMapClip;
        uniform vec4 mapOccluders[12]; uniform int mapCount;
        uniform float mapDistance, mapTrajectory, mapPad, mapLarge; uniform vec3 mapVessel;
        uniform vec2 mapOutline, mapGlow, mapViewport;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );', `
        // Flat segment ends: rounded caps of adjacent semi-transparent segments overlapped and doubled the alpha at
        // every joint, which read as a beaded/dotted line.
        if (abs(vUv.y) > 1.) discard;
        float halfWidth = linewidth * .5;
        // Distance (CSS px) outside the core edge; negative inside the core.
        float edge = abs(vUv.x) * (halfWidth + mapPad) - halfWidth;
        // One device pixel of antialiasing (fwidth is per device pixel, expressed in CSS px).
        float aa = max(fwidth(edge), 1e-3);
        float core = clamp(.5 - edge / aa, 0., 1.);
        // Lines thinner than a device pixel keep their energy instead of flickering.
        core *= min(1., linewidth / aa);
        float rim = clamp(.5 - (edge - mapOutline.x) / aa, 0., 1.) * mapOutline.y;
        float outside = max(edge - mapOutline.x, 0.) / mapGlow.y;
        float glow = mapGlow.x * exp(-outside * outside * 2.5) * step(0., edge);
        // Composite core over rim, then the glow beneath both (straight alpha).
        float solid = core + (1. - core) * rim;
        vec3 rimColor = vec3(.008, .014, .03);
        vec3 solidColor = mix(rimColor, diffuseColor.rgb, core / max(solid, 1e-4));
        float total = solid + (1. - solid) * glow;
        vec3 rgb = (solidColor * solid + diffuseColor.rgb * glow * (1. - solid)) / max(total, 1e-4);
        alpha = diffuseColor.a * total;
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
          float soft = max(radius * .025, 1.);
          float front = along - sqrt(max(radius*radius-side*side, 0.));
          if (along > 0. && rayLength > front + soft)
            occlusion *= mix(.10, 1., smoothstep(radius - soft, radius + soft, side));
        }
        // Distant parts of a conic dim gently; never below 35 % so nothing important disappears.
        float focusFade = mix(.35, 1., exp(-length(vMapPosition) / max(mapDistance * 6., 1.)));
        float vesselFade = mix(.45, 1., exp(-length(vMapPosition-mapVessel) / max(mapDistance * .8, 1.)));
        // Conics much larger than the view (the focused planet's own heliocentric orbit…) read as stray straight
        // lines: keep them faint and fade them out towards the screen edges.
        vec2 ndc = vMapClip.xy / vMapClip.z;
        float edgeFade = 1. - smoothstep(.3, 1.7, length(ndc * vec2(mapViewport.x / mapViewport.y, 1.)));
        float large = mix(1., .4 * edgeFade, mapLarge);
        gl_FragColor = vec4(rgb, alpha * occlusion * focusFade * large * mix(1., vesselFade, mapTrajectory));
      `);
    };
    material.customProgramCacheKey = () => 'map-orbit-v2';
  }
}
