import { createContext, useContext } from 'react';
import { conflicts, defaultBindings, type Action, type Bindings } from '../input/bindings';
import type { Settings } from '../game/store';

export const SETTINGS_TABS = ['Graphics', 'Audio', 'Controls', 'Gameplay', 'Accessibility'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];

/** Case-insensitive: every word of `query` appears somewhere in `texts`. An empty query matches everything. */
export function matchesQuery(query: string, ...texts: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

/** Current search text and the section being rendered; rows hide themselves when they do not match. */
export const SettingsSearch = createContext<{ query: string; tab: SettingsTab }>({ query: '', tab: 'Graphics' });
export function useSettingVisible(...texts: (string | undefined)[]): boolean {
  const { query, tab } = useContext(SettingsSearch);
  return matchesQuery(query, tab, ...texts);
}

/** Per-tab settings restored by "Reset". Graphics is handled separately (it re-runs device detection). */
export const TAB_SETTINGS: Record<Exclude<SettingsTab, 'Graphics'>, (keyof Settings)[]> = {
  Audio: ['masterVolume', 'musicVolume', 'sfxVolume', 'uiVolume'],
  Controls: ['invertPitch', 'mouseFlight', 'inputSmoothing', 'gamepadEnabled', 'deadZone', 'sensitivity'],
  Gameplay: ['units', 'navballSize', 'hudScale', 'cameraFov', 'autoSaveInterval', 'commsEnabled', 'commsRestrictControl', 'commsOverlay', 'launchCountdown', 'flightHints'],
  Accessibility: ['uiScale', 'highContrast', 'reduceMotion', 'cameraShake', 'colourBlind'],
};
export function resetPatch(tab: Exclude<SettingsTab, 'Graphics'>, defaults: Settings): Partial<Settings> {
  return Object.fromEntries(TAB_SETTINGS[tab].map(k => [k, defaults[k]])) as Partial<Settings>;
}

/**
 * Key clashes the player introduced: for each action, the other actions sharing one of its keys in the same
 * context. Clashes already present in the default layout (deliberate shares such as EVA up/run on Shift) are left out.
 */
export function bindingClashes(bindings: Bindings): Map<Action, Action[]> {
  const intended = new Set<string>();
  for (const c of conflicts(defaultBindings())) for (const a of c.actions) for (const b of c.actions) intended.add(`${c.key}:${a}:${b}`);
  const out = new Map<Action, Set<Action>>();
  for (const c of conflicts(bindings)) for (const a of c.actions) for (const b of c.actions) {
    if (a === b || intended.has(`${c.key}:${a}:${b}`)) continue;
    if (!out.has(a)) out.set(a, new Set());
    out.get(a)!.add(b);
  }
  return new Map([...out].map(([a, s]) => [a, [...s]]));
}

/** True when an action's keys differ from the default layout. */
export function bindingChanged(bindings: Bindings, a: Action, defaults = defaultBindings()): boolean {
  const x = bindings[a], d = defaults[a];
  return x.length !== d.length || x.some((k, i) => k !== d[i]);
}
