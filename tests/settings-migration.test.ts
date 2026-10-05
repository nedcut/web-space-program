import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('migrates an old graphics/audio settings object with finite defaults for every new option', async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'wsp.settings.v1' ? JSON.stringify({ quality: 'low', masterVolume: 0.2, invertPitch: true }) : null });
  const { game } = await import('../src/game/store');
  const settings = game.get().settings;
  expect(settings).toMatchObject({ quality: 'low', masterVolume: 0.2, invertPitch: true, adaptiveQuality: false, musicVolume: 1, sfxVolume: 1, reduceMotion: false, commsEnabled: null, commsRestrictControl: null, commsOverlay: true, autoSaveInterval: 60 });
  for (const value of Object.values(settings)) { expect(value).not.toBeUndefined(); if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); }
});
