import { describe, expect, it } from 'vitest';
import { classifyGpu, presetForTier } from '../src/util/gpuTier';
import { FrameProfiler } from '../src/util/frameProfiler';
import { hashString } from '../src/render/core/textureCache';

describe('GPU tier heuristic', () => {
  it.each([
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'weak'],
    ['ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'weak'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid'],
    ['ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'mid'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'strong'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', 'strong'],
    ['Apple GPU', 'mid'], // Safari masks the model
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid'],
    ['ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'strong'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', 'strong'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX350 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'weak'],
    ['Mali-G78', 'weak'],
    ['Mesa Intel(R) Xe Graphics (TGL GT2)', 'mid'],
    ['', 'mid'],
  ])('%s → %s', (name, tier) => expect(classifyGpu(name)).toBe(tier));
  it('starts weak GPUs on Low and everything else on Medium', () => {
    expect(presetForTier('weak')).toBe('low');
    expect(presetForTier('mid')).toBe('medium');
    expect(presetForTier('strong')).toBe('medium');
  });
});

describe('frame profiler', () => {
  it('accumulates sections per frame and reports interval percentiles', () => {
    const p = new FrameProfiler();
    p.enabled = true;
    for (let i = 0; i < 100; i++) {
      p.beginFrame(i * 16 + (i === 50 ? 30 : 0));
      p.addMs('sim', 1);
      p.addMs('render', 2);
      p.endFrame();
    }
    const s = p.summary();
    expect(s.frames).toBe(100);
    expect(p.totalFrames).toBe(100);
    expect(s.sections.sim).toBeCloseTo(1);
    expect(s.sections.render).toBeCloseTo(2);
    expect(s.frameMs.p50).toBe(16);
    expect(s.frameMs.max).toBe(46);
    expect(s.hitches25).toBe(1);
    const g = new Float64Array(10);
    expect(p.graph(g)).toBe(10);
    expect(g[9]).toBe(16);
  });
  it('is inert while disabled', () => {
    const p = new FrameProfiler();
    p.beginFrame(0); p.addMs('sim', 5); p.endFrame();
    expect(p.summary().frames).toBe(0);
    expect(p.now()).toBe(0);
  });
});

it('texture cache keys hash generator source', () => {
  expect(hashString('abc')).toBe(hashString('abc'));
  expect(hashString('abc')).not.toBe(hashString('abd'));
  expect(hashString('')).toMatch(/^[0-9a-f]{8}$/);
});
