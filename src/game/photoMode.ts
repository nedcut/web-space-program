import { useSyncExternalStore } from 'react';
export interface PhotoSettings { fov: number; exposure: number; focus: number; dof: number; vignette: number; grain: number; letterbox: number }
export interface PhotoRuntime { enter(): boolean; leave(): void; capture(scale: 1 | 2): Promise<void>; /** Instant PNG of the current flight view (F1), outside photo mode. */ screenshot?(): Promise<void> }
let runtime: PhotoRuntime | null = null;
let state = { active: false, available: false, settings: { fov: 50, exposure: 1, focus: 20, dof: 0, vignette: 0.25, grain: 0, letterbox: 0 } as PhotoSettings };
const listeners = new Set<() => void>();
function emit() { listeners.forEach(fn => fn()); }
export const photoMode = {
  get: () => state,
  register(next: PhotoRuntime) {
    runtime = next; state = { ...state, available: true }; emit();
    return () => { if (runtime !== next) return; if (state.active) photoMode.close(); runtime = null; state = { ...state, available: false }; emit(); };
  },
  open() { if (!runtime || state.active || !runtime.enter()) return; state = { ...state, active: true }; emit(); },
  close() { if (!state.active) return; runtime?.leave(); state = { ...state, active: false }; emit(); },
  set(patch: Partial<PhotoSettings>) { state = { ...state, settings: { ...state.settings, ...patch } }; emit(); },
  capture: (scale: 1 | 2) => runtime?.capture(scale),
  screenshot: () => runtime?.screenshot?.(),
};
export function usePhotoMode() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, photoMode.get); }
