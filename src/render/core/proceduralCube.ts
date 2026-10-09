import * as THREE from 'three';
import { contextIsLost } from './contextRecovery';
import { registerOffscreenPass } from './offscreenWarmup';

export interface ProceduralCubeOptions {
  format?: THREE.PixelFormat;
  type?: THREE.TextureDataType;
  defines?: Record<string, string | number>;
  uniforms?: Record<string, THREE.IUniform>;
}

/**
 * A cube map filled once on the GPU by a procedural fragment shader, in strips spread over several
 * frames so even integrated GPUs never stall. The shader source must define `vec4 bake(vec3 dir)`;
 * `dir` is the unit direction of the texel (OpenGL cube-map convention, matching samplerCube lookups).
 * Used for anything too expensive to evaluate per pixel per frame (cloud field, Milky Way).
 */
export class ProceduralCubeMap {
  readonly target: THREE.WebGLCubeRenderTarget;
  private readonly size: number;
  private readonly strip: number;
  private next = 0;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  protected readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  /** Compiled by the flight warm-up until the bake finishes. */
  private unregister: (() => void) | null;

  constructor(size: number, bakeGlsl: string, opts: ProceduralCubeOptions = {}) {
    this.size = size;
    // ~0.75 M texels per step keeps each bake step a fraction of a frame even on integrated GPUs.
    this.strip = Math.max(32, Math.min(size, Math.floor(786432 / size)));
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      format: opts.format ?? THREE.RGBAFormat,
      type: opts.type ?? THREE.UnsignedByteType,
      // Mip storage is allocated up front; three regenerates the chain after each strip (cheap).
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
    this.material = new THREE.ShaderMaterial({
      defines: opts.defines ?? {},
      uniforms: { ...(opts.uniforms ?? {}), uFace: { value: 0 }, uSize: { value: size } },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform int uFace;
        uniform float uSize;
        ${GLSL_CUBE_DIR}
        ${bakeGlsl}
        void main() {
          vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
          gl_FragColor = bake(normalize(cubeDir(uFace, st)));
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.unregister = registerOffscreenPass(this.quad.geometry, this.material);
  }

  get texture(): THREE.CubeTexture { return this.target.texture; }

  get done(): boolean { return this.next >= 6 * Math.ceil(this.size / this.strip); }

  /**
   * Bake again from the first strip: the target's contents are gone after a context loss. Safe to call at any
   * point; `done` is false until the new bake has finished.
   */
  restart(): void {
    this.next = 0;
    this.target.viewport.set(0, 0, this.size, this.size);
    this.target.scissor.copy(this.target.viewport);
    this.target.scissorTest = false;
  }

  /** Bake one strip of one face. Returns true once the whole map (with mipmaps) is ready. */
  step(renderer: THREE.WebGLRenderer): boolean {
    if (this.done) return true;
    // While the context is lost the draw is dropped: do not count the strip as baked.
    if (contextIsLost(renderer)) return false;
    const perFace = Math.ceil(this.size / this.strip);
    const face = Math.floor(this.next / perFace);
    const row = (this.next % perFace) * this.strip;
    this.next++;
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    const last = this.done;
    this.material.uniforms.uFace.value = face;
    this.target.viewport.set(0, row, this.size, Math.min(this.strip, this.size - row));
    this.target.scissor.copy(this.target.viewport);
    this.target.scissorTest = true;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target, face);
    renderer.render(this.scene, this.camera);
    if (last) {
      this.target.viewport.set(0, 0, this.size, this.size);
      this.target.scissor.copy(this.target.viewport);
      this.target.scissorTest = false;
    }
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.autoClear = prevAutoClear;
    if (last) { this.unregister?.(); this.unregister = null; }
    return last;
  }

  dispose(): void {
    this.unregister?.();
    this.unregister = null;
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/** Body-fixed cube direction for a texel of face `f` (OpenGL cube-map convention, s,t ∈ [-1, 1]). */
const GLSL_CUBE_DIR = /* glsl */ `
vec3 cubeDir(int f, vec2 st) {
  float s = st.x, t = st.y;
  if (f == 0) return vec3(1.0, -t, -s);
  if (f == 1) return vec3(-1.0, -t, s);
  if (f == 2) return vec3(s, 1.0, t);
  if (f == 3) return vec3(s, -1.0, -t);
  if (f == 4) return vec3(s, -t, 1.0);
  return vec3(-s, -t, -1.0);
}
`;

