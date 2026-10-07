import { afterEach, expect, it, vi } from 'vitest';
import { game, updateSettings } from '../src/game/store';
import { QUALITY_PRESETS, presetSettings, resolveQuality, getQuality, autoConfigureGraphics, GRAPHICS_PROFILE, type AdvancedGraphics, type QualityId } from '../src/render/core/quality';
import { FlightFx, FX_BUDGET } from '../src/render/fx/FlightFx';
import { createSkyMaterial, createOceanMaterial, createCloudMaterial } from '../src/render/planet/materials';
import { createPlanetUniforms } from '../src/render/planet/uniforms';
import { RenderPipeline } from '../src/render/core/renderer';

const initial = game.get().settings;
afterEach(() => { game.set({ settings: initial }); vi.unstubAllGlobals(); });
it('presets configure progressively finer renderer and particle resources', () => {
  const levels: QualityId[] = ['low', 'medium', 'high', 'ultra'];
  let previous = 0;
  for (const id of levels) {
    const q = resolveQuality(id, { ...initial, ...presetSettings(id) });
    expect(q.earth).toMatchObject({ textureQuality: id, atmosphereQuality: id, cloudQuality: id, oceanQuality: id, nightLights: true });
    expect(q.bakedTextureWidth).toBeGreaterThan(previous); previous = q.bakedTextureWidth;
    const fx = new FlightFx(q.particleQuality);
    expect(fx.pool.capacity).toBe(FX_BUDGET[id].count);
    expect(FX_BUDGET[q.particleQuality].count).toBe({ low: 128, medium: 512, high: 1024, ultra: 2048 }[id]);
    fx.dispose();
  }
});
const knobs: [keyof AdvancedGraphics, AdvancedGraphics[keyof AdvancedGraphics], string][] = [
  ['maxPixelRatio', 1, 'maxPixelRatio'], ['antiAliasing', 'off', 'aa'],
  ['shadowQuality', 'ultra', 'shadowMapSize'], ['terrainDetail', 'ultra', 'terrain'],
  ['groundClutter', 'off', 'scatter'], ['atmosphereQuality', 'ultra', 'atmosphere'],
  ['cloudQuality', 'off', 'earth'], ['textureQuality', 'ultra', 'bakedTextureWidth'],
  ['oceanQuality', 'ultra', 'earth'], ['nightLights', false, 'earth'],
  ['starQuality', 'off', 'stars'], ['particleQuality', 'ultra', 'particleQuality'], ['partDetail', 'low', 'partDetail'],
];
it.each(knobs)('%s changes the renderer configuration', (key, value, field) => {
  const s = { ...initial, ...presetSettings('medium') };
  const before = resolveQuality('medium', s);
  const after = resolveQuality('medium', { ...s, advancedGraphics: { [key]: value } });
  expect(after[field as keyof typeof after]).not.toEqual(before[field as keyof typeof before]);
});
it('updates live pipeline shadows and invokes composer reconfiguration for every preset/knob', () => {
  const receiver = { quality: QUALITY_PRESETS.low, renderer: { shadowMap: { enabled: false } }, buildComposer: vi.fn() };
  for (const id of Object.keys(QUALITY_PRESETS) as QualityId[]) {
    const q = resolveQuality(id, { ...initial, ...presetSettings(id) });
    RenderPipeline.prototype.setQuality.call(receiver as unknown as RenderPipeline, q);
    expect(receiver.quality).toBe(q);
    expect(receiver.renderer.shadowMap.enabled).toBe(q.shadowMapSize > 0);
  }
  for (const [key, value] of knobs) {
    const q = resolveQuality('medium', { ...initial, ...presetSettings('medium'), advancedGraphics: { [key]: value } });
    RenderPipeline.prototype.setQuality.call(receiver as unknown as RenderPipeline, q);
    expect(receiver.quality).toBe(q);
  }
  expect(receiver.buildComposer).toHaveBeenCalledTimes(4 + knobs.length);
});
it('AA, resolution, bloom and atmosphere toggles select distinct render configurations', () => {
  const s = { ...initial, ...presetSettings('high') };
  for (const aa of ['off', 'fxaa', 'smaa', 'msaa+smaa'] as const) {
    const q = resolveQuality('high', { ...s, advancedGraphics: { antiAliasing: aa } });
    expect([q.aa, q.msaaSamples]).toEqual(aa === 'off' ? ['none', 0] : aa === 'msaa+smaa' ? ['smaa', 4] : [aa, 0]);
  }
  expect(resolveQuality('high', { ...s, renderScale: .75 }).renderScale).toBe(.75);
  expect(resolveQuality('high', { ...s, bloom: false }).bloom.enabled).toBe(false);
  expect(resolveQuality('high', { ...s, scatter: false }).atmosphereScattering).toBe(false);
});
it('migrates profile 1 without resetting established preferences, persists overrides and resets Custom on preset selection', () => {
  const values: Record<string, string> = {};
  vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => { values[k] = v; } });
  game.set({ settings: { ...initial, graphicsProfile: 1, quality: 'high', renderScale: .8, adaptiveQuality: false } });
  expect(autoConfigureGraphics('Intel UHD 620')).toBeNull();
  expect(game.get().settings).toMatchObject({ graphicsProfile: GRAPHICS_PROFILE, quality: 'high', renderScale: .8, adaptiveQuality: false });
  updateSettings({ graphicsCustom: true, advancedGraphics: { particleQuality: 'ultra' } });
  expect(JSON.parse(values['wsp.settings.v1']).advancedGraphics.particleQuality).toBe('ultra');
  expect(getQuality('high').particleQuality).toBe('ultra');
  updateSettings(presetSettings('medium'));
  expect(game.get().settings.graphicsCustom).toBe(false);
  expect(getQuality('medium').particleQuality).toBe('medium');
});

it('atmosphere and cloud overrides reach actual shader defines', () => {
  const s = { ...initial, ...presetSettings('medium'), advancedGraphics: { atmosphereQuality: 'ultra' as const, cloudQuality: 'ultra' as const } };
  const q = resolveQuality('medium', s), u = createPlanetUniforms(637100, null, null);
  const sky = createSkyMaterial(u, q);
  expect(sky.defines.VIEW_STEPS).toBe(32);
  expect(sky.defines.AERIAL_STEPS).toBe(12);
  const ocean = createOceanMaterial(u, { ...q, atmosphere: QUALITY_PRESETS[q.earth.oceanQuality].atmosphere }, [.1, .2, .3]);
  expect(ocean.defines.AERIAL_STEPS).toBe(6);
  const clouds = createCloudMaterial(u, q, 638000);
  expect(clouds.defines.CLOUD_DETAIL).toBe(4);
  sky.dispose(); ocean.dispose(); clouds.dispose();
});

it('intentional 30 fps pacing retains full resolution and 120 fps uses its own frame budget', async () => {
  const { AdaptiveQuality } = await import('../src/render/core/adaptiveQuality');
  const adaptive = new AdaptiveQuality();
  adaptive.frameRateCap = 30;
  for (let i = 0; i < 600; i++) adaptive.update(1000 / 30, true, 10, 2);
  expect(adaptive.scale).toBe(1);
  expect(adaptive.targetMs).toBeCloseTo(1000 / 30);
  adaptive.frameRateCap = 120;
  adaptive.refreshMs = 1000 / 120;
  expect(adaptive.targetMs).toBeCloseTo(1000 / 120);
});
