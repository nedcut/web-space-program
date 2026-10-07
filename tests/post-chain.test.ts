import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ToneMapPass } from '../src/render/core/fusedBloom';
import { UpscalePass } from '../src/render/core/UpscalePass';

describe('post chain', () => {
  it('splices the bloom composite into three\'s tone-mapping shader', () => {
    const pass = new ToneMapPass();
    const m = pass.material as THREE.RawShaderMaterial;
    expect(m.fragmentShader).toContain('texture2D( tBloom, vUv )');
    // The bloom is added before tone mapping (same sum as the additive blend it replaces).
    expect(m.fragmentShader.indexOf('tBloom, vUv')).toBeLessThan(m.fragmentShader.indexOf('ToneMapping('));
    expect(m.uniforms.tBloom).toBeDefined();
  });

  it('upscale pass reads the source with texelFetch and has a flat early-out', () => {
    const pass = new UpscalePass();
    const src = (pass as unknown as { material: THREE.ShaderMaterial }).material.fragmentShader;
    expect(src).toContain('texelFetch');
    expect(src).toContain('uFlat');
    expect(pass.needsSwap).toBe(false);
  });
});
