import type { GameMode } from '../sim/science/progression';
import { useSyncExternalStore } from 'react';
import type { ScalePresetId } from '../sim/bodies/scale';
import type { CraftDef } from '../sim/vessel/types';
import type { SavedWorld } from './persistence';

export type Scene = 'menu' | 'spaceCenter' | 'editor' | 'flight' | 'tracking' | 'research' | 'missions';
export type QualityPreset = 'low' | 'medium' | 'high';

export interface Settings {
  quality: QualityPreset;
  masterVolume: number;
  invertPitch: boolean;
  showFps: boolean;
  shadows: boolean; bloom: boolean; clouds: boolean; scatter: boolean; renderScale: number;
  musicVolume: number; sfxVolume: number;
  gamepadEnabled: boolean; deadZone: number; sensitivity: number; inputSmoothing: number; mouseFlight: boolean;
  units: 'metric' | 'imperial'; navballSize: number; hudScale: number; cameraFov: number; autoSaveInterval: number;
  uiScale: number; highContrast: boolean; reduceMotion: boolean; colourBlind: boolean;
}

export interface GameState {
  scene: Scene;
  mode: GameMode;
  saveId: string | null;
  scalePreset: ScalePresetId;
  /** Universal time, seconds since J2000. */
  ut: number;
  /** Craft currently loaded in the editor / being launched. */
  craft: CraftDef | null;
  /** World to resume when entering flight (from Continue / quickload); consumed by the flight scene. */
  resumeWorld: SavedWorld | null;
  /** True when entering flight should launch `craft` onto the pad (Launch button), false to just resume. */
  launchPending: boolean;
  settings: Settings;
}

const SETTINGS_KEY = 'wsp.settings.v1';

function loadSettings(): Settings {
  const defaults: Settings = { quality: 'medium', masterVolume: 0.8, invertPitch: false, showFps: false, shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, musicVolume: 1, sfxVolume: 1, gamepadEnabled: true, deadZone: 0.15, sensitivity: 1, inputSmoothing: 0, mouseFlight: false, units: 'metric', navballSize: 200, hudScale: 1, cameraFov: 60, autoSaveInterval: 60, uiScale: 1, highContrast: false, reduceMotion: false, colourBlind: false };
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

/** Dev hook: `?scene=editor` (etc.) opens a scene directly. */
function initialScene(): Scene {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scene') : null;
    if (q && ['menu', 'spaceCenter', 'editor', 'flight', 'tracking', 'research', 'missions'].includes(q)) return q as Scene;
  } catch {
    /* no location */
  }
  return 'menu';
}

export const game = createStore<GameState>({
  scene: initialScene(),
  mode: 'sandbox',
  saveId: null,
  scalePreset: 'standard',
  ut: DEFAULT_START_UT,
  craft: null,
  resumeWorld: null,
  launchPending: false,
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
