/** Context-scoped, physical-key bindings; Ctrl means Ctrl or Command for editor shortcuts. */
export const DEFAULT_BINDINGS = {
  pitchDown: ['KeyS'], pitchUp: ['KeyW'], yawRight: ['KeyD'], yawLeft: ['KeyA'], rollRight: ['KeyE'], rollLeft: ['KeyQ'],
  translateRight: ['KeyL'], translateLeft: ['KeyJ'], translateForward: ['KeyI'], translateBack: ['KeyK'], translateUp: ['KeyH'], translateDown: ['KeyN'],
  throttleUp: ['ShiftLeft', 'ShiftRight'], throttleDown: ['ControlLeft', 'ControlRight'], throttleFull: ['KeyZ'], throttleCut: ['KeyX'],
  stage: ['Space'], toggleSas: ['KeyT'], toggleRcs: ['KeyR'], map: ['KeyM'], warpUp: ['Period'], warpDown: ['Comma'], warpStop: ['Slash'],
  menu: ['Escape'], help: ['Shift+F1'], screenshot: ['F1'], hideUi: ['F2'], flightResults: ['F3'], perfOverlay: ['F8'], flightData: ['Shift+F3'], stressOverlay: ['F4'], nightVision: ['F7'], photoMode: ['KeyP'],
  focusNext: ['BracketRight'], focusPrev: ['BracketLeft'], toggleCamMode: ['KeyV'], quicksave: ['F5'], quickload: ['F9'], eva: ['KeyO'], board: ['Enter', 'NumpadEnter'], plantFlag: ['KeyF'],
  toggleGear: ['KeyG'], brakes: ['KeyB'], toggleLights: ['KeyU'], abort: ['Backspace'], stageLock: ['Alt+KeyL'], sasHold: ['KeyF'],
  mapFocusNext: ['Tab'], mapFocusHome: ['Home', 'Backquote'],
  actionGroup1: ['Digit1'], actionGroup2: ['Digit2'], actionGroup3: ['Digit3'], actionGroup4: ['Digit4'], actionGroup5: ['Digit5'],
  actionGroup6: ['Digit6'], actionGroup7: ['Digit7'], actionGroup8: ['Digit8'], actionGroup9: ['Digit9'], actionGroup10: ['Digit0'], precision: ['CapsLock'], precisionHold: ['AltLeft', 'AltRight'], trimReset: ['Alt+KeyX'],
  cameraLeft: ['ArrowLeft'], cameraRight: ['ArrowRight'], cameraUp: ['ArrowUp'], cameraDown: ['ArrowDown'], cameraZoomIn: ['Equal', 'NumpadAdd'], cameraZoomOut: ['Minus', 'NumpadSubtract'],
  evaRight: ['KeyD'], evaLeft: ['KeyA'], evaForward: ['KeyW'], evaBack: ['KeyS'], evaUp: ['ShiftLeft', 'ShiftRight'], evaDown: ['ControlLeft', 'ControlRight'], evaRun: ['ShiftLeft', 'ShiftRight'], evaJump: ['Space'],
  editorUndo: ['Ctrl+KeyZ'], editorRedo: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'], editorSave: ['Ctrl+KeyS'], editorCancel: ['Escape'], editorDelete: ['Delete', 'Backspace'], editorSymmetry: ['KeyX'], editorSymmetryMode: ['KeyR'], editorFrame: ['KeyF'], editorReset: ['Space'],
  editorPitchUp: ['KeyW'], editorPitchDown: ['KeyS'], editorRollLeft: ['KeyA'], editorRollRight: ['KeyD'], editorYawLeft: ['KeyQ'], editorYawRight: ['KeyE'],
  editorToolPlace: ['Digit1'], editorToolOffset: ['Digit2'], editorToolRotate: ['Digit3'], editorToolReroot: ['Digit4'], editorAngleSnap: ['KeyC'],
} satisfies Record<string, string[]>;
export type Action = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<Action, string[]>;
const SHARED_ACTIONS = new Set<Action>(['cameraLeft', 'cameraRight', 'cameraUp', 'cameraDown', 'cameraZoomIn', 'cameraZoomOut', 'toggleSas', 'toggleRcs', 'map', 'warpUp', 'warpDown', 'warpStop', 'menu', 'help', 'perfOverlay', 'flightData', 'stressOverlay', 'nightVision', 'photoMode', 'screenshot', 'hideUi', 'flightResults', 'focusNext', 'focusPrev', 'toggleCamMode', 'quicksave', 'quickload', 'eva', 'toggleGear', 'precision', 'precisionHold']);
export const BINDINGS_KEY = 'wsp.bindings.v1';
/**
 * Layout revision of the default map. Layout 2 moved to the classic KSP 1.12 flight defaults: lights U, EVA O,
 * IVA C, F1 screenshot, F2 hide UI, F3 flight results, help Shift+F1, flight data Shift+F3.
 */
export const BINDINGS_LAYOUT = 2;
/** Defaults of earlier layouts: a saved binding still equal to its old default follows the new default. */
const LAYOUT_1_DEFAULTS: Partial<Record<string, string[]>> = { help: ['F1'], flightData: ['F3'], eva: ['KeyU'], toggleLights: ['KeyC'] };
export function defaultBindings(): Bindings { return Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([a, keys]) => [a, [...keys]])) as Bindings; }
export function loadBindings(storage?: Pick<Storage, 'getItem'>): Bindings {
  const result = defaultBindings();
  try {
    const data: unknown = JSON.parse((storage ?? globalThis.localStorage)?.getItem(BINDINGS_KEY) ?? '{}');
    if (data && typeof data === 'object') {
      const saved = data as Partial<Bindings> & { __layout?: unknown };
      const layout = typeof saved.__layout === 'number' ? saved.__layout : 1;
      const valid = (keys: unknown): keys is string[] => Array.isArray(keys) && keys.every(k => typeof k === 'string' && k.length < 80);
      const same = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);
      // Saved keys of actions the player has explicitly customised (not merely stored defaults).
      const migrating = new Set<Action>();
      for (const a of Object.keys(result) as Action[]) {
        const keys = saved[a];
        if (!valid(keys)) continue;
        const old = layout < 2 ? LAYOUT_1_DEFAULTS[a] : undefined;
        if (old && same(keys, old)) migrating.add(a);
        else result[a] = [...keys];
      }
      // An untouched old default moves to its new key unless the player already uses that key for something else.
      // Reverting one action can free or block another, so settle until nothing changes (each reverts at most once).
      for (let changed = true; changed;) {
        changed = false;
        for (const a of migrating) {
          const old = LAYOUT_1_DEFAULTS[a]!;
          if (same(result[a], old)) continue;
          const clash = (Object.keys(result) as Action[]).some(o => o !== a && contextsOverlap(a, o) && result[o].some(k => result[a].includes(k)));
          if (clash) { result[a] = [...old]; changed = true; }
        }
      }
    }
  } catch { /* Use defaults if storage is unavailable or corrupt. */ }
  return result;
}
let current = loadBindings();
const listeners = new Set<() => void>();
export const getBindings = () => current;
export const subscribeBindings = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function saveBindings(bindings: Bindings, storage?: Pick<Storage, 'setItem'>) {
  current = Object.fromEntries(Object.entries(bindings).map(([a, keys]) => [a, [...keys]])) as Bindings;
  try { (storage ?? globalThis.localStorage)?.setItem(BINDINGS_KEY, JSON.stringify({ ...current, __layout: BINDINGS_LAYOUT })); } catch { /* Session-only when storage is unavailable. */ }
  listeners.forEach(fn => fn());
}
/** Inputs that take no text: a focused switch, slider or button must not swallow flight or editor keys. */
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'];
export const TYPING_SELECTOR = `input${NON_TEXT_INPUTS.map(t => `:not([type="${t}"])`).join('')}, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-settings-modal], [data-key-owner]`;
/** Keyboard focus is in a text field, list box, the settings modal or a key-owning control (resize grip): keys belong to it, not to game controls. */
export function isTyping(target: EventTarget | null): boolean {
  return typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && !!target.closest(TYPING_SELECTOR);
}
export function keyChord(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string {
  return `${(e.ctrlKey || e.metaKey) && !/^(Control|Meta)/.test(e.code) ? 'Ctrl+' : ''}${e.altKey && !e.code.startsWith('Alt') ? 'Alt+' : ''}${e.shiftKey && !e.code.startsWith('Shift') ? 'Shift+' : ''}${e.code}`;
}
/** Chords (with modifiers) bound anywhere: such a chord never also fires the plain key's action. */
let chordCache: { bindings: Bindings; chords: Set<string> } | null = null;
function boundChords(): Set<string> {
  if (chordCache?.bindings !== current) chordCache = { bindings: current, chords: new Set(Object.values(current).flat().filter(k => k.includes('+'))) };
  return chordCache.chords;
}
/**
 * Modifier rules in flight. Alt (precisionHold) is hold-for-fine-control, so Alt + a plain key still acts at fine
 * authority (Alt+I/J/K/H/N translate at 35 %). Alt + attitude keys (W/S/A/D/Q/E) trim instead of deflecting
 * (FlightInput zeroes their deflection while Alt is held) — intentional, the trim keys. A chord bound to its own
 * action (Alt+L stage lock, Alt+X trim reset, Shift+F1 help…) consumes its key: it never also fires the plain key's
 * action (`matches`) nor drives the plain key's continuous axis (`isFlightChord`; L would translate right), until
 * that key is released.
 */
let flightChordCache: { bindings: Bindings; chords: Set<string> } | null = null;
export function isFlightChord(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  if (flightChordCache?.bindings !== current) {
    const chords = (Object.keys(current) as Action[]).filter(a => context(a) !== 'editor').flatMap(a => current[a]).filter(k => k.includes('+'));
    flightChordCache = { bindings: current, chords: new Set(chords) };
  }
  const chord = keyChord(e);
  return chord.includes('+') && flightChordCache.chords.has(chord);
}
export function matches(action: Action, e: KeyboardEvent): boolean {
  const chord = keyChord(e);
  // A plain binding still fires with Shift/Alt held (e.g. staging while holding throttle-up), unless that exact
  // chord belongs to another action (Shift+F1 help must not also take an F1 screenshot).
  return current[action].some(k => k === chord || (!k.includes('+') && k === e.code && !e.metaKey && !e.ctrlKey && !boundChords().has(chord)));
}
function contextsOverlap(a: Action, b: Action) {
  const scopes = (x: Action) => SHARED_ACTIONS.has(x) ? ['flight', 'eva'] : [context(x)];
  return scopes(a).some(s => scopes(b).includes(s));
}
export function context(action: Action) { return action.startsWith('editor') ? 'editor' : action.startsWith('eva') || action === 'board' || action === 'plantFlag' ? 'eva' : 'flight'; }
export function conflicts(bindings: Bindings): { key: string; actions: Action[] }[] {
  const groups = new Map<string, Action[]>();
  for (const a of Object.keys(bindings) as Action[]) for (const k of new Set(bindings[a])) {
    for (const scope of SHARED_ACTIONS.has(a) ? ['flight', 'eva'] : [context(a)]) {
      const id = `${scope}:${k}`; groups.set(id, [...(groups.get(id) ?? []), a]);
    }
  }
  const found = new Map<string, { key: string; actions: Action[] }>();
  for (const [id, actions] of groups) if (actions.length > 1) {
    const key = id.slice(id.indexOf(':') + 1);
    found.set(`${key}:${actions.join(',')}`, { key, actions });
  }
  return [...found.values()];
}
export function actionLabel(a: Action) { return a.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/(\D)(\d+)$/, '$1 $2'); }

/** Human-readable names shared by tutorial prose, help and shortcut hints. */
/** Labels by key list: the HUD asks for dozens of labels per telemetry update (titles, action groups). */
const labelCache = new Map<string, string>();
export function bindingLabel(action: Action, bindings = current): string {
  const keys = bindings[action];
  const id = keys.join('\n');
  let label = labelCache.get(id);
  if (label === undefined) {
    label = [...new Set(keys.map(k => k.replace(/Key|Digit/g, '').replace(/(Shift|Control|Alt|Meta)(Left|Right)/g, '$1').replace('Control', 'Ctrl').replace('NumpadEnter', 'Enter')))].join(' / ') || 'Unbound';
    if (labelCache.size > 512) labelCache.clear();
    labelCache.set(id, label);
  }
  return label;
}
export function bindingText(text: string, bindings = current): string {
  return text.replace(/\{(\w+)\}/g, (token, action: string) => action in DEFAULT_BINDINGS ? bindingLabel(action as Action, bindings) : token);
}
