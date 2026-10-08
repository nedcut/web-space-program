import * as THREE from 'three';
import type { VesselState } from '../../sim/vessel/runtime';
import type { Vec3 } from '../../util/vec3';
import { GLSL_LOGDEPTH_FRAG, GLSL_LOGDEPTH_FRAG_PARS, GLSL_LOGDEPTH_VERT, GLSL_LOGDEPTH_VERT_PARS } from '../core/glsl';

/**
 * Engine-blown regolith on airless (and thin-air) bodies: a sheet of radial dust streaks racing outward over
 * the ground where the exhaust strikes it. It starts around 100 m up for a lander-sized engine (higher for more
 * thrust), thickens and widens as the vessel descends, and the centre is blown clean. One draw, a shallow
 * cone (the sheet lifts as it spreads), lit by the Sun like the regolith. Complements the particle puffs of
 * the flight effects, which only start a few tens of metres up.
 */
export class SurfaceDust {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly q = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly ground = new THREE.Vector3();
  private strength = 0;

  constructor() {
    const g = new THREE.RingGeometry(0.02, 1, 64, 6).rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uStrength: { value: 0 }, uRadius: { value: 1 }, uColor: { value: new THREE.Color(0.5, 0.5, 0.5) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        ${GLSL_LOGDEPTH_VERT_PARS}
        uniform float uRadius;
        varying vec2 vPolar;
        void main() {
          float r = length(position.xz);
          vPolar = vec2(r, atan(position.z, position.x));
          // The sheet rises toward its rim (6 % of its radius) like a lifted skirt.
          vec3 p = vec3(position.x * uRadius, 0.25 + 0.06 * r * r * uRadius, position.z * uRadius);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          ${GLSL_LOGDEPTH_VERT}
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_LOGDEPTH_FRAG_PARS}
        uniform float uTime, uStrength;
        uniform vec3 uColor, uSunDir, uUp;
        varying vec2 vPolar;
        void main() {
          ${GLSL_LOGDEPTH_FRAG}
          float r = vPolar.x, a = vPolar.y;
          // Radial streaks (angular noise from incommensurate sines) flowing outward.
          float rays = 0.55 + 0.45 * sin(a * 23.0 + sin(a * 7.0) * 2.0) * sin(a * 37.0 - 1.3) ;
          float flow = 0.6 + 0.4 * sin(r * 26.0 - uTime * 9.0 + sin(a * 11.0) * 3.0);
          float body = smoothstep(0.04, 0.22, r) * (1.0 - smoothstep(0.45, 1.0, r));
          float alpha = uStrength * body * mix(0.55, 1.0, rays * flow) * 0.75;
          if (alpha < 0.003) discard;
          float sun = max(dot(uSunDir, uUp), 0.0);
          vec3 col = uColor * (0.05 + 2.2 * sun) * (0.85 + 0.3 * flow);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'surface-dust';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  /**
   * `altitude` is the vessel's height above the terrain; `airDensity` (kg/m³) suppresses the sheet in thick air.
   * `sunDir` is the render-space direction to the Sun; `color` the body's regolith colour (linear RGB).
   */
  update(state: VesselState, origin: Vec3, bodyCenter: Vec3, altitude: number, airDensity: number, color: readonly number[] | undefined, sunDir: THREE.Vector3, time: number, dt: number): void {
    const thrust = Math.max(0, state.telemetry.thrust);
    this.up.set(state.position.x - bodyCenter.x, state.position.y - bodyCenter.y, state.position.z - bodyCenter.z).normalize();
    this.q.set(state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w);
    this.axis.set(0, -1, 0).applyQuaternion(this.q);
    const down = -this.axis.dot(this.up);
    const k = Math.sqrt(thrust / 30000);
    const reach = Math.min(160, Math.max(45, 30 + 60 * k));
    let target = 0;
    if (airDensity < 0.05 && thrust > 0 && down > 0.35 && altitude > -2 && altitude < reach) {
      target = Math.min(1, 0.35 + 0.65 * Math.min(1, k)) * (1 - THREE.MathUtils.smoothstep(altitude, reach * 0.45, reach)) * Math.min(1, (down - 0.35) * 3);
    }
    // Ease so the sheet builds and settles rather than flickering with throttle.
    this.strength += (target - this.strength) * Math.min(1, dt * (target > this.strength ? 2.5 : 1.2));
    const m = this.mesh.material.uniforms;
    if (this.strength < 0.01) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    // Where the exhaust axis meets the ground (tangent plane at the vessel's foot).
    const h = Math.max(0, altitude);
    const along = h / Math.max(0.35, down);
    this.ground.set(state.position.x - origin.x, state.position.y - origin.y, state.position.z - origin.z).addScaledVector(this.axis, along);
    // Snap the sheet onto the ground plane under the vessel (remove the along-up error of the slanted ray).
    const below = this.ground.dot(this.up) - ((state.position.x - origin.x) * this.up.x + (state.position.y - origin.y) * this.up.y + (state.position.z - origin.z) * this.up.z - h);
    this.ground.addScaledVector(this.up, -below);
    this.mesh.position.copy(this.ground);
    this.mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.up);
    m.uRadius.value = Math.min(90, 8 + 1.1 * h + 14 * Math.min(1.5, k));
    m.uStrength.value = this.strength;
    m.uTime.value = time % 1000;
    if (color) (m.uColor.value as THREE.Color).setRGB(color[0] * 0.9, color[1] * 0.9, color[2] * 0.9);
    else (m.uColor.value as THREE.Color).setRGB(0.405, 0.387, 0.36);
    (m.uSunDir.value as THREE.Vector3).copy(sunDir);
    (m.uUp.value as THREE.Vector3).copy(this.up);
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
