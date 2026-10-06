import * as THREE from 'three';

/**
 * Procedural image-based lighting for flight: a PMREM-baked sky/ground gradient that follows the
 * local vertical, the sun direction and how much atmosphere surrounds the vessel. On the pad it
 * gives parts a blue sky dome, warm sun-side horizon and a dim ground bounce; in orbit it fades to
 * black space with planetshine from below. Re-baked only when the quantised inputs change (and at
 * most a few times per second), so the per-frame cost is a handful of comparisons.
 */

export interface SkyEnvParams {
  /** Unit local vertical in render space. */
  up: THREE.Vector3;
  /** Unit direction to the sun in render space. */
  sun: THREE.Vector3;
  /** 0 = vacuum, 1 = thick sea-level air. */
  air: number;
  /** 0..1 sun visibility (eclipse/terrain shadow). */
  daylight: number;
  /** Body surface colour (linear RGB). */
  ground: [number, number, number];
  /** Atmosphere tint (linear RGB) or undefined for airless bodies. */
  skyTint?: [number, number, number];
  /** Apparent angular radius of the body below (rad); larger = planet fills more of the sky. */
  bodyAngle: number;
}

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uUp;
  uniform vec3 uSun;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunCol;
  uniform float uHorizonCos;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = dot(d, uUp);
    float sunAmt = max(dot(d, uSun), 0.0);
    // sky above the (possibly depressed) horizon, ground/planet below it
    float sky = smoothstep(uHorizonCos - 0.04, uHorizonCos + 0.04, h);
    float t = clamp((h - uHorizonCos) / max(1.0 - uHorizonCos, 1e-3), 0.0, 1.0);
    vec3 skyCol = mix(uHorizon, uZenith, pow(t, 0.55));
    skyCol += uHorizon * 0.6 * pow(sunAmt, 6.0); // forward-scatter glow around the sun
    vec3 groundCol = uGround * (0.55 + 0.45 * smoothstep(-1.0, max(uHorizonCos, -0.999), h));
    vec3 col = mix(groundCol, skyCol, sky);
    col += uSunCol * (pow(sunAmt, 900.0) * 40.0 + pow(sunAmt, 40.0) * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkyEnvironment {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly mat: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget | null = null;
  private key = '';
  private lastBake = -1e9;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color() },
        uHorizonCos: { value: 0 },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.mat));
  }

  get texture(): THREE.Texture | null {
    return this.rt?.texture ?? null;
  }

  /** Re-bake if inputs changed meaningfully. Returns the current environment texture. */
  update(p: SkyEnvParams, nowMs: number): THREE.Texture | null {
    const q = (x: number, s: number) => Math.round(x * s);
    const key = [q(p.up.x, 12), q(p.up.y, 12), q(p.up.z, 12), q(p.sun.x, 12), q(p.sun.y, 12), q(p.sun.z, 12), q(p.air, 20), q(p.daylight, 10), q(p.bodyAngle, 20)].join(',');
    if (key === this.key && this.rt) return this.rt.texture;
    if (this.rt && nowMs - this.lastBake < 250) return this.rt.texture;
    this.key = key;
    this.lastBake = nowMs;
    this.bake(p);
    return this.rt!.texture;
  }

  private bake(p: SkyEnvParams) {
    const u = this.mat.uniforms;
    u.uUp.value.copy(p.up);
    u.uSun.value.copy(p.sun);
    const sunUp = p.sun.dot(p.up);
    const day = THREE.MathUtils.smoothstep(sunUp, -0.15, 0.25) * p.daylight;
    const air = THREE.MathUtils.clamp(p.air, 0, 1);
    const tint = p.skyTint ?? [0, 0, 0];
    // Sky: tinted zenith, paler horizon, warmer when the sun is low; fades to black with altitude.
    const airVis = Math.pow(air, 0.35);
    const low = 1 - THREE.MathUtils.smoothstep(sunUp, 0.05, 0.5);
    const zen = new THREE.Color(tint[0] * 0.9, tint[1] * 0.9, tint[2] * 1.0).multiplyScalar(airVis * day);
    const hor = new THREE.Color(0.55 + 0.35 * low, 0.6 + 0.08 * low, 0.68 - 0.25 * low).multiplyScalar(airVis * day * 0.9);
    u.uZenith.value.copy(zen);
    u.uHorizon.value.copy(hor);
    // Ground / planetshine: albedo lit by the sun, a little skylight even in shadow.
    const g = p.ground;
    const lit = 0.25 + 0.75 * day;
    u.uGround.value.setRGB(g[0] * lit * 0.9, g[1] * lit * 0.9, g[2] * lit * 0.9);
    u.uSunCol.value.setRGB(1, 0.97, 0.9).multiplyScalar(p.daylight);
    // Horizon dips as the planet shrinks below us: cos of the angle from up to the limb.
    u.uHorizonCos.value = -Math.cos(Math.min(Math.PI / 2, p.bodyAngle));
    const next = this.pmrem.fromScene(this.scene, 0, 0.1, 100);
    this.rt?.dispose();
    this.rt = next;
  }

  dispose() {
    this.rt?.dispose();
    this.rt = null;
    this.pmrem.dispose();
    this.mat.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
