import * as THREE from 'three';
import type { PlanetUniforms } from './uniforms';
import type { QualitySettings } from '../core/quality';
import { GLSL_NOISE, GLSL_LOGDEPTH_VERT_PARS, GLSL_LOGDEPTH_VERT, GLSL_LOGDEPTH_FRAG_PARS } from '../core/glsl';

/** Bounded, body-local volume; the ray is clipped against the solid body before integration. */
export function createPlanetEffect(u: PlanetUniforms, q: QualitySettings, kind: 'enceladus' | 'io' | 'titan' | 'earth' | 'corona', extent: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    defines: { STEPS: kind === 'enceladus' ? q.planetDetails.plumeSteps : q.planetDetails.volumeSteps, [kind.toUpperCase()]: 1 },
    uniforms: { ...u, uExtent: { value: extent } },
    vertexShader: /* glsl */ `
      ${GLSL_LOGDEPTH_VERT_PARS}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${GLSL_LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_LOGDEPTH_FRAG_PARS}
      ${GLSL_NOISE}
      uniform vec3 uCamRel, uSunDir, uSunColor;
      uniform mat3 uBodyRot;
      uniform mat4 projectionMatrix;
      uniform float uPlanetRadius, uExtent, uTime;
      varying vec3 vWorld;
      vec2 hit(vec3 p, vec3 d, float r) {
        float b = dot(p, d), disc = b*b - dot(p,p) + r*r;
        if (disc < 0.0) return vec2(1e20, -1e20);
        return vec2(-b-sqrt(disc), -b+sqrt(disc));
      }
      float shellChord(vec3 ro, vec3 rd, float r, float width, float start, float end) {
        vec2 outer = hit(ro, rd, r + width), inner = hit(ro, rd, r - width);
        float chord = max(0.0, min(end, outer.y) - max(start, outer.x));
        return max(0.0, chord - max(0.0, min(end, inner.y) - max(start, inner.x)));
      }
      float jet(vec3 p, vec3 axis, float height, float width) {
        float h = dot(p, axis) - 0.99;
        if (h < 0.0 || h > height) return 0.0;
        float side = length(p - axis * dot(p, axis));
        float w = 0.012 + width * h;
        float radial = exp(-side*side / (w*w));
        float streak = 0.75 + 0.25 * snoise(p * 55.0 - axis * mod(uTime * 0.025, 100.0));
        return radial * exp(-h / (height * 0.30)) * (1.0 - smoothstep(height * 0.65, height, h)) * streak;
      }
      void main() {
        vec3 rdWorld = normalize(vWorld - cameraPosition);
        vec3 rd = transpose(uBodyRot) * rdWorld;
        vec3 ro = transpose(uBodyRot) * uCamRel / uPlanetRadius;
        vec3 sun = transpose(uBodyRot) * uSunDir;
        vec2 bounds = hit(ro, rd, uExtent);
        float start = max(0.0, bounds.x), end = bounds.y;
        #ifdef ENCELADUS
          // Tight plume bounds prevent undersampling thin jets across a whole sphere diameter.
          vec3 inv = 1.0 / (sign(rd + 1e-12) * max(abs(rd), vec3(1e-8)));
          vec3 a = (vec3(-0.4, -0.4, -1.8) - ro) * inv;
          vec3 b = (vec3(0.4, 0.4, -0.94) - ro) * inv;
          vec3 lo = min(a, b), hi = max(a, b);
          start = max(start, max(lo.x, max(lo.y, lo.z)));
          end = min(end, min(hi.x, min(hi.y, hi.z)));
        #endif
        vec2 ground = hit(ro, rd, 1.001);
        if (ground.x > 0.0) end = min(end, ground.x);
        if (end <= start) discard;
        #ifdef EARTH
          // The aurora lives in the polar ovals (|z| ≳ 0.9) on the night side. Both z and the sun
          // projection are linear along the ray, so their extremes are at the segment ends: reject
          // the (usual) rays that never reach the ovals before marching 20–32 noisy steps.
          float za = ro.z + rd.z * start, zb = ro.z + rd.z * end;
          if (max(abs(za), abs(zb)) < 0.86) discard;
          if (min(dot(ro + rd * start, sun), dot(ro + rd * end, sun)) > 0.17) discard;
          // Clip to the hemisphere slab the ray reaches when it touches only one oval.
          if (abs(rd.z) > 1e-5) {
            float tn = (0.86 - ro.z) / rd.z, ts = (-0.86 - ro.z) / rd.z;
            bool north = max(za, zb) >= 0.86, south = min(za, zb) <= -0.86;
            if (north && !south) { if (rd.z > 0.0) start = max(start, tn); else end = min(end, tn); }
            else if (south && !north) { if (rd.z < 0.0) start = max(start, ts); else end = min(end, ts); }
          }
          if (end <= start) discard;
        #endif
        // Use the front of the volume for depth tests, rather than the back-face proxy sphere.
        vec4 clip = projectionMatrix * viewMatrix * vec4(cameraPosition + rdWorld * start * uPlanetRadius, 1.0);
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth = log2(max(1e-6, 1.0 + clip.w)) * logDepthBufFC * 0.5;
        #elif defined(USE_REVERSED_DEPTH_BUFFER)
          gl_FragDepth = clip.w > 0.0 ? clamp(clip.z / clip.w, 0.0, 1.0) : 1.0;
        #else
          gl_FragDepth = clip.w > 0.0 ? clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0) : 0.0;
        #endif
        vec3 color = vec3(0.0);
        float phase = 0.5 + 2.0 * pow(max(dot(rd, sun), 0.0), 6.0);
        #if defined(TITAN)
          // Analytic thin-shell chord lengths resolve detached layers even at low sample counts.
          // Detach the cool layer above the main amber atmosphere, leaving a visible gap.
          float r = 1.0 + (uExtent - 1.0) * 0.94;
          float chord = shellChord(ro, rd, r, 0.004, start, end);
          vec3 p = ro + rd * clamp(-dot(ro, rd), start, end);
          float day = smoothstep(-0.22, 0.4, dot(normalize(p), sun));
          float layering = 0.8 + 0.2 * snoise(normalize(p) * vec3(3.0, 3.0, 12.0));
          color = vec3(0.075, 0.10, 0.15) * (1.0-exp(-chord*1.2)) * layering;
          // Thin amber strata stay below the detached cool limb layer.
          float lower = shellChord(ro, rd, 1.0 + (uExtent - 1.0) * 0.36, 0.007, start, end);
          float upper = shellChord(ro, rd, 1.0 + (uExtent - 1.0) * 0.56, 0.005, start, end);
          color += vec3(0.12, 0.058, 0.018) * (1.0-exp(-lower*0.5-upper*0.35)) * layering;
          color *= day * phase * uSunColor;
        #else
          float stepSize = (end - start) / float(STEPS);
          for (int i = 0; i < STEPS; i++) {
            vec3 p = ro + rd * (start + (float(i) + 0.5) * stepSize);
            float r = length(p);
            #if defined(ENCELADUS)
              float density = jet(p, normalize(vec3(-0.10, 0.025, -1.0)), 0.75, 0.23)
                            + jet(p, normalize(vec3(0.075, -0.035, -1.0)), 0.58, 0.17)
                            + jet(p, normalize(vec3(0.01, 0.10, -1.0)), 0.68, 0.20);
              color += vec3(0.48, 0.74, 1.0) * density * stepSize * 5.0 * phase * uSunColor;
            #elif defined(IO)
              float density = jet(p, normalize(vec3(0.95, 0.2, 0.16)), 0.17, 0.9)
                            + jet(p, normalize(vec3(-0.4, -0.9, -0.18)), 0.13, 1.0);
              color += vec3(0.50, 0.36, 0.26) * density * stepSize * 1.4 * phase * uSunColor;
            #elif defined(EARTH)
              vec3 n = p / r;
              float lon = atan(n.y, n.x);
              float wave = 0.012 * sin(lon * 11.0 + uTime * 0.015) + 0.006 * sin(lon * 29.0);
              float oval = exp(-(((abs(n.z) - 0.947 - wave) / 0.012) * ((abs(n.z) - 0.947 - wave) / 0.012)));
              float curtains = ((0.5 + 0.5 * snoise(vec3(n.xy * 180.0, uTime * 0.01))) * (0.5 + 0.5 * snoise(vec3(n.xy * 180.0, uTime * 0.01))));
              float h = (r - 1.0) / (uExtent - 1.0);
              float night = 1.0 - smoothstep(-0.2, 0.15, dot(n, sun));
              color += mix(vec3(0.05, 0.8, 0.29), vec3(0.32, 0.04, 0.28), h) * oval * curtains * night
                       * exp(-h * 3.0) * stepSize * 8.0;
            #elif defined(CORONA)
              float h = r - 1.0;
              vec3 n = p / r;
              float streamers = 0.6 + 0.4 * ((0.5 + 0.5 * snoise(n * 13.0)) * (0.5 + 0.5 * snoise(n * 13.0)));
              color += vec3(1.0, 0.60, 0.24) * exp(-h * 12.0) * streamers * stepSize * 0.6;
            #endif
          }
        #endif
        gl_FragColor = vec4(color, 1.0);
      }`,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, q.sphereSegments, q.sphereSegments / 2), material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 4;
  mesh.userData.extent = extent;
  return mesh;
}
