import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

interface BloomInternals { _fsQuad: FullScreenQuad; blendMaterial: THREE.Material; renderTargetsHorizontal: THREE.WebGLRenderTarget[] }

/**
 * Unreal-style bloom without its final full-resolution step. three's pass ends by blending the half-resolution
 * composite additively onto the HDR scene target (a full-screen read-modify-write of a half-float target);
 * here that addition happens inside the tone-mapping pass instead (`ToneMapPass`), which reads the scene anyway.
 * The sum is the same — scene + bilinearly sampled composite — so the image is unchanged.
 */
export class FusedBloomPass extends UnrealBloomPass {
  /** Half-resolution bloom composite of the last render (valid until the next one). */
  get bloomTexture(): THREE.Texture { return (this as unknown as BloomInternals).renderTargetsHorizontal[0].texture; }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const self = this as unknown as BloomInternals;
    const quad = self._fsQuad;
    const draw = quad.render;
    quad.render = (r: THREE.WebGLRenderer) => { if (quad.material !== self.blendMaterial) draw.call(quad, r); };
    try { super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); } finally { quad.render = draw; }
  }
}

/** three's OutputPass (tone mapping + output transfer) that first adds the bloom composite, when one is set. */
export class ToneMapPass extends OutputPass {
  bloom: FusedBloomPass | null = null;
  constructor() {
    super();
    const m = this.material as THREE.RawShaderMaterial;
    m.uniforms.tBloom = { value: null };
    m.uniforms.uBloom = { value: 0 };
    m.fragmentShader = m.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;\nuniform float uBloom;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\n\t\t\tif ( uBloom > 0.5 ) gl_FragColor.rgb += texture2D( tBloom, vUv ).rgb;');
    if (!m.fragmentShader.includes('tBloom, vUv')) throw new Error('ToneMapPass: OutputShader changed; update the bloom splice.');
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const u = (this.material as THREE.RawShaderMaterial).uniforms;
    const on = !!this.bloom?.enabled;
    u.uBloom.value = on ? 1 : 0;
    u.tBloom.value = on ? this.bloom!.bloomTexture : readBuffer.texture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
