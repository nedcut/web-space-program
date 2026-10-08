import { describe, expect, it } from 'vitest';
import { resolutionPlan } from '../src/render/core/renderer';
import { QUALITY_PRESETS, resolveQuality } from '../src/render/core/quality';

const base = { shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, advancedGraphics: {} };

describe('resolution plan', () => {
  it('Medium on Retina renders ~70% internally and upscales into a device-resolution canvas', () => {
    const p = resolutionPlan(2, QUALITY_PRESETS.medium, 1, false, 920);
    expect(p.upscaling).toBe(true);
    expect(p.output).toBe(2);
    expect(p.internal).toBeCloseTo(1.4);
    expect(p.lod).toBeCloseTo(2); // terrain detail follows the reconstructed resolution
  });

  it('Medium at DPR 1 is native and does not upscale', () => {
    const p = resolutionPlan(1, QUALITY_PRESETS.medium, 1, false, 920);
    expect(p).toEqual({ internal: 1, output: 1, upscaling: false, lod: 1, device: 1 });
  });

  it('adaptive reductions are upscaled instead of shrinking the canvas', () => {
    const p = resolutionPlan(1, QUALITY_PRESETS.medium, 0.6, false, 920);
    expect(p.upscaling).toBe(true);
    expect(p.output).toBe(1);
    expect(p.internal).toBeCloseTo(0.6);
    expect(p.lod).toBeCloseTo(0.6);
  });

  it('native mode keeps the previous canvas-scaling behaviour', () => {
    const q = resolveQuality('medium', { ...base, advancedGraphics: { upscale: 'native' } });
    expect(resolutionPlan(2, q, 1, false, 920)).toEqual({ internal: 2, output: 2, upscaling: false, lod: 2, device: 2 });
    expect(resolutionPlan(2, q, 0.8, false, 920)).toMatchObject({ internal: 1.6, output: 1.6, upscaling: false });
  });

  it('advanced levels select the Retina fraction', () => {
    const q = resolveQuality('high', { ...base, advancedGraphics: { upscale: 'performance' } });
    expect(q.upscale).toMatchObject({ mode: 'edge', retinaScale: 0.58 });
    expect(resolutionPlan(2, q, 1, false, 920).internal).toBeCloseTo(1.16);
  });

  it('supersampling and Ultra render at or above device resolution without the upscaler', () => {
    expect(resolutionPlan(2, QUALITY_PRESETS.ultra, 1, false, 920).upscaling).toBe(false);
    const q = resolveQuality('medium', { ...base, renderScale: 1.5, advancedGraphics: { upscale: 'native' } });
    expect(resolutionPlan(2, q, 1, false, 920)).toMatchObject({ internal: 3, output: 3, upscaling: false });
  });

  it('Low keeps its half-resolution canvas by default and can opt into upscaling it to 1×', () => {
    expect(resolutionPlan(2, QUALITY_PRESETS.low, 1, false, 920)).toMatchObject({ internal: 0.5, output: 0.5, upscaling: false });
    const q = resolveQuality('low', { ...base, renderScale: 0.5, advancedGraphics: { upscale: 'quality' } });
    expect(resolutionPlan(2, q, 1, false, 920)).toMatchObject({ internal: 0.5, output: 1, upscaling: true });
  });

  it('the map draws directly at device resolution', () => {
    expect(resolutionPlan(2, QUALITY_PRESETS.medium, 0.5, true, 920)).toEqual({ internal: 2, output: 2, upscaling: false, lod: 2, device: 2 });
  });
});

it('map toggles preserve flight attachments; a resize in map mode is applied on return', async () => {
  const { RenderPipeline } = await import('../src/render/core/renderer');
  const { Vector2 } = await import('three');
  const { vi } = await import('vitest');
  let ratio = 2;
  const size = new Vector2(1470, 920);
  // Exercise the real sizing methods without requiring a WebGL context.
  const p = Object.assign(Object.create(RenderPipeline.prototype), {
    width: 1470, height: 920, canvasSize: new Vector2(), mapHiRes: false,
    postWidth: 1470, postHeight: 920, postRatio: 1.4,
    computePlan() { return resolutionPlan(2, QUALITY_PRESETS.medium, 1, this.mapHiRes, 920); },
    renderer: {
      getSize: (out: InstanceType<typeof Vector2>) => out.copy(size), getPixelRatio: () => ratio,
      setPixelRatio: vi.fn((r: number) => { ratio = r; }),
      setSize: vi.fn((w: number, h: number) => size.set(w, h)),
    },
    composer: { setSize: vi.fn(), setPixelRatio: vi.fn() },
    hdrTarget: { setSize: vi.fn() }, upscalePass: { enabled: true },
  });
  p.setMapMode(true); p.setMapMode(false);
  expect(p.composer.setSize).not.toHaveBeenCalled();
  expect(p.hdrTarget.setSize).not.toHaveBeenCalled();
  expect(p.renderer.setSize).not.toHaveBeenCalled();
  expect(p.renderer.setPixelRatio).not.toHaveBeenCalled();
  p.setMapMode(true); p.setSize(1200, 800);
  expect(p.renderer.setSize).toHaveBeenCalledWith(1200, 800, false);
  expect(p.composer.setSize).not.toHaveBeenCalled();
  p.setMapMode(false);
  expect(p.composer.setSize).toHaveBeenCalledWith(1200, 800);
  expect(p.hdrTarget.setSize).toHaveBeenCalledWith(1680, 1120);
});
