import * as THREE from 'three';

/** Deterministic PRNG so the map sky is identical every session. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Faint background stars for the map: one point draw at infinity (direction only, so no float precision issue at
 * any zoom), denser and slightly brighter along a tilted galactic band. Drawn first in the opaque pass, so planets
 * cover it; additive so it never darkens anything.
 */
export function createMapStars(count = 2600): THREE.Points {
  const rand = mulberry32(0x5eed);
  const positions = new Float32Array(count * 3), sizes = new Float32Array(count), colors = new Float32Array(count * 3);
  const band = new THREE.Vector3(0.25, -0.35, 0.9).normalize(), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Rejection-free band bias: half of the stars are pulled towards the band plane.
    const z = rand() * 2 - 1, phi = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    p.set(r * Math.cos(phi), r * Math.sin(phi), z);
    if (i % 2 === 0) { p.addScaledVector(band, -p.dot(band) * (0.55 + rand() * 0.4)).normalize(); }
    positions.set([p.x, p.y, p.z], i * 3);
    const m = rand();
    const bright = Math.pow(m, 6); // mostly faint, a few bright
    sizes[i] = 1.1 + bright * 2.2;
    const temp = rand();
    const c = temp < 0.15 ? [1, 0.82, 0.68] : temp > 0.85 ? [0.72, 0.82, 1] : [0.9, 0.93, 1];
    const intensity = 0.16 + bright * 0.7 + rand() * 0.08;
    colors.set([c[0] * intensity, c[1] * intensity, c[2] * intensity], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        // Pinned to depth 0 in clip space: never clipped by the zoom-dependent near/far planes.
        gl_Position = vec4(p.xy, 0.0, p.w);
        gl_PointSize = size * uPixelRatio;
      }`,
    fragmentShader: `varying vec3 vColor;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.;
        float a = 1. - smoothstep(.35, 1., r);
        gl_FragColor = vec4(vColor * a, 1.);
      }`,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  stars.renderOrder = -100;
  stars.onBeforeRender = (renderer) => { material.uniforms.uPixelRatio.value = renderer.getPixelRatio(); };
  return stars;
}

/** Sphere-of-influence shell: a faint fill with a brighter limb, so the boundary reads as a ring. */
export function createSoiShell(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x9cc4e8) }, uOpacity: { value: 1 } },
    vertexShader: `varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal); vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vNormal; varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1. - facing, 3.);
        gl_FragColor = vec4(uColor, (.025 + rim * .32) * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.renderOrder = 0; mesh.frustumCulled = false; mesh.visible = false;
  return mesh;
}
