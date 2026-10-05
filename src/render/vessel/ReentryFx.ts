import { game } from '../../game/store';
import * as THREE from 'three';

/**
 * Re-entry plasma: an additive, noise-animated shock sheath in front of the vessel plus a glowing wake
 * streaming behind it. Driven by stagnation heat flux (W/m²) so it fades in naturally around Mach 5+.
 * The group is oriented so its +Y axis points INTO the airflow (i.e. along the vessel's air-relative velocity).
 */
const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPos;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uIntensity;
  uniform float uWake;
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;
  varying vec3 vPos;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    #include <logdepthbuf_fragment>
    // y in [-1, 1]: +1 = stagnation side (front), -1 = wake tip.
    float y = vPos.y;
    float front = smoothstep(-0.2, 1.0, y);
    float wake = (1.0 - smoothstep(-1.0, 0.2, y)) * uWake;
    float rim = pow(1.0 - abs(dot(vNormalV, vViewDir)), 1.5);
    float n = noise(vPos * 3.0 + vec3(0.0, uTime * 9.0, 0.0)) * 0.6 + noise(vPos * 7.0 - vec3(0.0, uTime * 15.0, 0.0)) * 0.4;
    float a = (front * (0.35 + rim) + wake * n * 0.8) * uIntensity;
    vec3 col = mix(uColorCool, uColorHot, clamp(front + n * 0.3, 0.0, 1.0));
    gl_FragColor = vec4(col * a * 3.0, a);
  }
`;

export class ReentryFx {
  readonly object = new THREE.Group();
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    // Capsule-like envelope: hemisphere front + long cone wake, unit radius, built along +Y in [-1, 1].
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      profile.push(new THREE.Vector2(Math.sin(a), 0.4 + Math.cos(a) * 0.6));
    }
    profile.reverse();
    profile.push(new THREE.Vector2(0.7, -0.2), new THREE.Vector2(0.25, -0.8), new THREE.Vector2(0.0, -1.0));
    const geo = new THREE.LatheGeometry(profile, 48);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uWake: { value: 1 },
        uColorHot: { value: new THREE.Color(1.0, 0.55, 0.25) },
        uColorCool: { value: new THREE.Color(1.0, 0.25, 0.45) },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.object.add(this.mesh);
    this.object.visible = false;
  }

  /**
   * @param heatFlux stagnation heat flux, W/m² (visible from ~10 kW/m², saturates around 300 kW/m²)
   * @param airDirInto unit vector (render space) pointing into the oncoming air, i.e. along air-relative velocity
   * @param radius vessel bounding radius, m
   */
  update(heatFlux: number, airDirInto: THREE.Vector3, radius: number, time: number) {
    const k = THREE.MathUtils.clamp((Math.log10(Math.max(heatFlux, 1)) - 4.0) / 1.5, 0, 1);
    this.object.visible = k > 0.01;
    if (!this.object.visible) return;
    this.mat.uniforms.uIntensity.value = k * k;
    this.mat.uniforms.uTime.value = game.get().settings.reduceMotion ? 0 : time;
    const r = radius * 1.15;
    const sy = r * (1.4 + 2.5 * k);
    this.object.scale.set(r, sy, r);
    this.object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), airDirInto);
    // Place the envelope so its front cap (local y = +1) sits just ahead of the vessel and the wake trails behind.
    this.object.position.copy(airDirInto).multiplyScalar(r * 0.75 - sy);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
