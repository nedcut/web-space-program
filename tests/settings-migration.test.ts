import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('migrates an old graphics/audio settings object with finite defaults for every new option', async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'wsp.settings.v1' ? JSON.stringify({ quality: 'low', masterVolume: 0.2, invertPitch: true }) : null });
  const { game } = await import('../src/game/store');
  const settings = game.get().settings;
  expect(settings).toMatchObject({ quality: 'low', masterVolume: 0.2, invertPitch: true, adaptiveQuality: true, perfOverlay: false, graphicsProfile: 0, musicVolume: 1, sfxVolume: 1, reduceMotion: false, commsEnabled: null, commsRestrictControl: null, commsOverlay: true, autoSaveInterval: 60 });
  for (const value of Object.values(settings)) { expect(value).not.toBeUndefined(); if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); }
});
it('auto-configures graphics once per profile: weak GPUs start on Low with adaptive resolution', async () => {
  vi.resetModules();
  const store: Record<string, string> = { 'wsp.settings.v1': JSON.stringify({ quality: 'high', adaptiveQuality: false, renderScale: 1.2 }) };
  vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  const { game } = await import('../src/game/store');
  const { autoConfigureGraphics, GRAPHICS_PROFILE } = await import('../src/render/core/quality');
  expect(autoConfigureGraphics('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toMatch(/Low/);
  expect(game.get().settings).toMatchObject({ quality: 'low', adaptiveQuality: true, renderScale: 0.5, shadows: false, graphicsProfile: GRAPHICS_PROFILE });
  expect(JSON.parse(store['wsp.settings.v1']).graphicsProfile).toBe(GRAPHICS_PROFILE);
  // Later choices are respected.
  expect(autoConfigureGraphics('Mali-G78')).toBeNull();
  vi.resetModules();
  const again = await import('../src/game/store');
  const q = await import('../src/render/core/quality');
  again.updateSettings({ quality: 'high' });
  expect(q.autoConfigureGraphics('Mali-G78')).toBeNull();
  expect(again.game.get().settings.quality).toBe('high');
});
