import * as THREE from 'three';
import { GLSL_LOGDEPTH_FRAG, GLSL_LOGDEPTH_FRAG_PARS, GLSL_LOGDEPTH_VERT, GLSL_LOGDEPTH_VERT_PARS } from '../core/glsl';

/**
 * Deluge steam at the launch pad: when engines fire over the flame hole, the deflector turns the exhaust and
 * flashing deluge water north along the trench. Billows boil out of the open trench and roll off its exit apron;
 * a lighter curtain rises around the hole. One instanced draw in the pad frame (metres), GPU-ballistic
 * like the flight particle pool: a puff's spawn state is written once and the shader integrates drag, buoyancy
 * and growth. Nothing is drawn (or uploaded) while the pool is idle.
 */
export class PadSteam {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly spawn: Float32Array;
  private readonly velocity: Float32Array;
  private readonly params: Float32Array;
  private cursor = 0;
  private credit = 0;
  private expires = -1;
  private seed = 12345;
  /** Local clock (s): UT is ~1e9 s, far beyond float32 resolution for puff ages. */
  private clock = 0;

  constructor(private readonly capacity: number, sunDir: { value: THREE.Vector3 }, private readonly trench: { halfWidth: number; open: number; end: number; hole: number }) {
    this.spawn = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    g.instanceCount = capacity;
    for (const [name, array, size] of [['aSpawn', this.spawn, 3], ['aVelocity', this.velocity, 3], ['aParams', this.params, 4]] as const) {
      g.setAttribute(name, new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSunDir: sunDir, uDay: { value: 1 }, uAmbient: { value: new THREE.Color(0.35, 0.4, 0.48) } },
      vertexShader: /* glsl */ `
        ${GLSL_LOGDEPTH_VERT_PARS}
        attribute vec3 aSpawn; attribute vec3 aVelocity; attribute vec4 aParams; // birth, life, size, growth
        uniform float uTime;
        varying vec2 vUv; varying float vAlpha; varying float vPhase; varying vec3 vSunView;
        uniform vec3 uSunDir;
        void main() {
          float age = uTime - aParams.x;
          float life = age / max(0.001, aParams.y);
          float valid = step(0.0, age) * step(life, 1.0) * step(0.001, aParams.y);
          // Drag (velocity decays over ~1.6 s) plus a slow buoyant rise.
          const float tau = 1.6;
          float k = tau * (1.0 - exp(-age / tau));
          vec3 p = aSpawn + aVelocity * k + vec3(0.0, 0.9 * age + 0.05 * age * age, 0.0);
          float radius = aParams.z * 0.5 + aParams.w * sqrt(max(age, 0.0)) * 2.2;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * radius * 2.0 * valid;
          gl_Position = projectionMatrix * mv;
          // Fade in quickly, out slowly; close to the camera the billboard fades instead of filling the screen.
          float near = smoothstep(radius * 0.6, radius * 2.5, -mv.z);
          vAlpha = valid * min(1.0, age * 4.0) * pow(1.0 - clamp(life, 0.0, 1.0), 1.6) * near;
          vPhase = aParams.x * 13.7;
          vSunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          vUv = uv;
          ${GLSL_LOGDEPTH_VERT}
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_LOGDEPTH_FRAG_PARS}
        uniform float uDay; uniform vec3 uAmbient;
        varying vec2 vUv; varying float vAlpha; varying float vPhase; varying vec3 vSunView;
        void main() {
          if (vAlpha < 0.002) discard;
          vec2 q = vUv * 2.0 - 1.0;
          float r = dot(q, q);
          if (r > 1.0) discard;
          ${GLSL_LOGDEPTH_FRAG}
          float a = vPhase;
          vec2 s = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
          float billow = sin(s.x * 7.0 + sin(s.y * 5.0 + a)) * sin(s.y * 6.0 - a);
          float edge = pow(max(0.0, 1.0 - r + 0.16 * billow), 1.6);
          // Treat the puff as a sphere: sunlit side bright, the far side grey-blue from the sky.
          vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r)));
          float lit = clamp(dot(n, vSunView) * 0.6 + 0.55, 0.0, 1.0);
          vec3 col = vec3(0.92, 0.91, 0.89) * (uAmbient + vec3(1.0, 0.97, 0.92) * lit * uDay * 1.6) * (0.9 + 0.1 * billow);
          gl_FragColor = vec4(col, vAlpha * edge * 0.62);
        }`,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'site:steam';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
  }

  private rnd(): number { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  /**
   * Advance by `dt` seconds of sim time. `strength` (0..1) scales the emission: engine thrust over the hole, fading as the
   * vessel climbs. `daylight` (0..1) dims the steam at night.
   */
  update(dt: number, strength: number, daylight: number): void {
    this.clock += dt;
    const t = this.clock;
    const u = this.mesh.material.uniforms;
    u.uTime.value = t;
    u.uDay.value = daylight;
    (u.uAmbient.value as THREE.Color).setRGB(0.12 + 0.26 * daylight, 0.13 + 0.29 * daylight, 0.16 + 0.34 * daylight);
    if (strength > 0.01 && dt > 0) {
      this.credit = Math.min(8, this.credit + dt * 34 * strength);
      const T = this.trench;
      while (this.credit >= 1) {
        this.credit -= 1;
        const kind = this.rnd();
        let x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, growth: number;
        if (kind < 0.55) {
          // Boiling out of the open trench, carried north.
          x = (this.rnd() - 0.5) * 2 * T.halfWidth * 0.8; y = -2.5; z = T.open + (T.end - T.open) * this.rnd();
          vx = (this.rnd() - 0.5) * 6; vy = 8 + this.rnd() * 10; vz = -(14 + this.rnd() * 22) * strength;
          size = 5 + this.rnd() * 5; life = 6 + this.rnd() * 6; growth = 2.2 + this.rnd() * 1.6;
        } else if (kind < 0.85) {
          // Rolling off the exit apron: low, fast and wide.
          x = (this.rnd() - 0.5) * 2 * T.halfWidth; y = -1; z = T.end - 2;
          vx = (this.rnd() - 0.5) * 18; vy = 3 + this.rnd() * 6; vz = -(22 + this.rnd() * 20) * strength;
          size = 6 + this.rnd() * 6; life = 7 + this.rnd() * 7; growth = 2.8 + this.rnd() * 1.8;
        } else {
          // Flashing deluge water around the hole rim.
          const a = this.rnd() * Math.PI * 2;
          x = Math.cos(a) * (T.hole + 1); y = 0.5; z = Math.sin(a) * (T.hole + 1);
          vx = Math.cos(a) * 7; vy = 6 + this.rnd() * 8; vz = Math.sin(a) * 7;
          size = 3 + this.rnd() * 3; life = 4 + this.rnd() * 4; growth = 1.6 + this.rnd();
        }
        const i = this.cursor++ % this.capacity, j = i * 3, k = i * 4;
        this.spawn[j] = x; this.spawn[j + 1] = y; this.spawn[j + 2] = z;
        this.velocity[j] = vx; this.velocity[j + 1] = vy; this.velocity[j + 2] = vz;
        this.params[k] = t + this.rnd() * dt; this.params[k + 1] = life; this.params[k + 2] = size; this.params[k + 3] = growth;
        this.expires = Math.max(this.expires, t + life + 0.5);
        for (const name of ['aSpawn', 'aVelocity', 'aParams']) {
          const attr = this.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
          attr.addUpdateRange(i * attr.itemSize, attr.itemSize);
          attr.needsUpdate = true;
        }
      }
    }
    this.mesh.visible = t < this.expires;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
