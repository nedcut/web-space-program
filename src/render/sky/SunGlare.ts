import * as THREE from 'three';

/**
 * Screen-space sun glare + lens flare ghosts, drawn as one full-screen triangle (additive, last).
 * Occlusion and atmospheric tint are supplied by the caller (e.g. PlanetRenderer.sunVisibility).
 */
export class SunGlare {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector4();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: new THREE.Vector2() },
        uAspect: { value: 1 },
        uIntensity: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uSize: { value: 0.01 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uSun;
        uniform float uAspect;
        uniform float uIntensity;
        uniform vec3 uTint;
        uniform float uSize;
        varying vec2 vNdc;
        // Soft disc: 1 inside r·soft, 0 beyond r. (smoothstep with edge0 >= edge1 is undefined in GLSL;
        // Apple's Metal backend extrapolates it, which flooded the screen with the green ghost.)
        float ghost(vec2 p, vec2 c, float r, float soft) {
          float d = length((p - c) * vec2(uAspect, 1.0));
          return 1.0 - smoothstep(r * soft, r, d);
        }
        void main() {
          vec2 p = vNdc;
          vec2 d = (p - uSun) * vec2(uAspect, 1.0);
          float r = length(d);
          // Core glow + wide halo
          float glow = uSize * uSize / (r * r + uSize * uSize * 0.5) * 0.6 + exp(-r * 7.0) * 0.06 + exp(-r * 1.6) * 0.012;
          // Starburst rays (diffraction spikes): |cos 3θ|^60 + 0.6·|cos(3θ + π/6)|^120, with the triple-angle
          // identities and repeated squaring instead of atan/cos/pow (same values, a fraction of the ALU).
          vec2 u = d / max(r, 1e-6);
          float c3 = u.x * (4.0 * u.x * u.x - 3.0), s3 = u.y * (3.0 - 4.0 * u.y * u.y);
          float a = abs(c3), b = abs(c3 * 0.8660254 - s3 * 0.5);
          float a4 = a * a; a4 *= a4; float a8 = a4 * a4, a16 = a8 * a8;
          float b4 = b * b; b4 *= b4; float b8 = b4 * b4, b16 = b8 * b8, b60 = b16 * b16 * b16 * b8 * b4;
          float rays = (a16 * a16) * a16 * a8 * a4 + b60 * b60 * 0.6;
          rays *= exp(-r * 8.0) * 0.18;
          // Fine streaks
          float streak = exp(-abs(d.y) * 220.0) * exp(-abs(d.x) * 2.5) * 0.25;
          vec3 c = uTint * (glow + rays + streak);
          // Ghosts along the sun–centre axis
          vec2 axis = -uSun;
          // Subtle, near-neutral ghosts (saturated ones read as on-screen blobs, not optics).
          c += vec3(0.55, 0.65, 1.0) * ghost(p, uSun + axis * 1.35, 0.06, 0.6) * 0.022;
          c += vec3(1.0, 0.75, 0.55) * ghost(p, uSun + axis * 1.7, 0.11, 0.85) * 0.012;
          c += vec3(0.75, 0.7, 1.0) * ghost(p, uSun + axis * 2.2, 0.18, 0.9) * 0.008;
          // Halo ring
          float ringD = (length((p - uSun - axis) * vec2(uAspect, 1.0)) - 0.45) * 25.0;
          float ring = exp(-ringD * ringD);
          c += vec3(0.6, 0.7, 1.0) * ring * 0.005;
          gl_FragColor = vec4(clamp(c * uIntensity, 0.0, 64.0), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
  }

  /**
   * @param sunDirRender unit vector from camera towards the sun (render space)
   * @param visibility 0..1 occlusion factor; tint = atmospheric transmittance (RGB)
   * @param angularRadius sun angular radius (rad), controls glare size
   */
  update(camera: THREE.PerspectiveCamera, sunDirRender: THREE.Vector3, visibility: number, tint: [number, number, number] = [1, 1, 1], angularRadius = 0.0047, strength = 1): void {
    const v = this.tmp.set(sunDirRender.x, sunDirRender.y, sunDirRender.z, 0);
    v.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    const u = this.mat.uniforms;
    if (v.w <= 0 || visibility <= 0) {
      this.mesh.visible = false;
      return;
    }
    const nx = v.x / v.w, ny = v.y / v.w;
    // Fade out when the sun is far off-screen.
    const off = Math.max(Math.abs(nx), Math.abs(ny));
    const edgeFade = 1 - Math.min(1, Math.max(0, (off - 1.0) / 0.6));
    this.mesh.visible = edgeFade > 0;
    u.uSun.value.set(nx, ny);
    u.uAspect.value = camera.aspect;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    u.uSize.value = Math.max((angularRadius / (fovRad * 0.5)) * 1.0, 0.004);
    u.uTint.value.set(tint[0], tint[1], tint[2]);
    // At large angular sizes the resolved photosphere/corona supplies the light; glare must not wash it out.
    const resolvedSun = 1 - THREE.MathUtils.smoothstep(angularRadius, 0.025, 0.20);
    u.uIntensity.value = visibility * edgeFade * strength * resolvedSun;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
