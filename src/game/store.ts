import { useSyncExternalStore } from 'react';
import type { ScalePresetId } from '../sim/bodies/scale';
import type { CraftDef } from '../sim/vessel/types';

export type Scene = 'menu' | 'spaceCenter' | 'editor' | 'flight' | 'tracking';
export type QualityPreset = 'low' | 'medium' | 'high';

export interface Settings {
  quality: QualityPreset;
  masterVolume: number;
  invertPitch: boolean;
  showFps: boolean;
}

export interface GameState {
  scene: Scene;
  saveId: string | null;
  scalePreset: ScalePresetId;
  /** Universal time, seconds since J2000. */
  ut: number;
  /** Craft currently loaded in the editor / being launched. */
  craft: CraftDef | null;
  settings: Settings;
}

const SETTINGS_KEY = 'wsp.settings.v1';

function loadSettings(): Settings {
  const defaults: Settings = { quality: 'medium', masterVolume: 0.8, invertPitch: false, showFps: false };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

/** Tiny observable store — UI subscribes via useGame(); game loop reads `game.get()` directly. */
function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// Mission start: 2030-07-20 12:00 UTC (UTC≈TT is close enough for gameplay).
export const DEFAULT_START_UT = (Date.UTC(2030, 6, 20, 12) - Date.UTC(2000, 0, 1, 12)) / 1000;

export const game = createStore<GameState>({
  scene: 'menu',
  saveId: null,
  scalePreset: 'standard',
  ut: DEFAULT_START_UT,
  craft: null,
  settings: loadSettings(),
});

export function updateSettings(patch: Partial<Settings>) {
  game.set((s) => ({ settings: { ...s.settings, ...patch } }));
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(game.get().settings));
  } catch {
    /* storage unavailable */
  }
}

export function useGame<R>(selector: (s: GameState) => R): R {
  return useSyncExternalStore(game.subscribe, () => selector(game.get()));
}
