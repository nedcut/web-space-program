/** Context-scoped, physical-key bindings; Ctrl means Ctrl or Command for editor shortcuts. */
export const DEFAULT_BINDINGS = {
  pitchDown: ['KeyS'], pitchUp: ['KeyW'], yawRight: ['KeyD'], yawLeft: ['KeyA'], rollRight: ['KeyE'], rollLeft: ['KeyQ'],
  translateRight: ['KeyL'], translateLeft: ['KeyJ'], translateForward: ['KeyI'], translateBack: ['KeyK'], translateUp: ['KeyH'], translateDown: ['KeyN'],
  throttleUp: ['ShiftLeft', 'ShiftRight'], throttleDown: ['ControlLeft', 'ControlRight'], throttleFull: ['KeyZ'], throttleCut: ['KeyX'],
  stage: ['Space'], toggleSas: ['KeyT'], toggleRcs: ['KeyR'], map: ['KeyM'], warpUp: ['Period'], warpDown: ['Comma'], warpStop: ['Slash'],
  menu: ['Escape'], help: ['F1'], flightData: ['F3'], stressOverlay: ['F4'], photoMode: ['KeyP'], focusNext: ['BracketRight'], toggleCamMode: ['KeyV'], quicksave: ['F5'], quickload: ['F9'], eva: ['KeyU'], board: ['Enter'], plantFlag: ['KeyF'], toggleGear: ['KeyG'], brakes: ['KeyB'], precision: ['CapsLock'], precisionHold: ['AltLeft', 'AltRight'],
  evaRight: ['KeyD', 'KeyE'], evaLeft: ['KeyA', 'KeyQ'], evaForward: ['KeyW'], evaBack: ['KeyS'], evaUp: ['ShiftLeft', 'ShiftRight'], evaDown: ['ControlLeft', 'ControlRight'], evaRun: ['ShiftLeft', 'ShiftRight'],
  editorUndo: ['Ctrl+KeyZ'], editorRedo: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'], editorSave: ['Ctrl+KeyS'], editorCancel: ['Escape'], editorDelete: ['Delete', 'Backspace'], editorSymmetry: ['KeyX'], editorSymmetryMode: ['KeyR'], editorFrame: ['KeyF'], editorReset: ['Space'],
  editorPitchUp: ['KeyW'], editorPitchDown: ['KeyS'], editorRollLeft: ['KeyA'], editorRollRight: ['KeyD'], editorYawLeft: ['KeyQ'], editorYawRight: ['KeyE'],
} satisfies Record<string, string[]>;
export type Action = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<Action, string[]>;
export const BINDINGS_KEY = 'wsp.bindings.v1';
export function defaultBindings(): Bindings { return Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([a, keys]) => [a, [...keys]])) as Bindings; }
export function loadBindings(storage?: Pick<Storage, 'getItem'>): Bindings {
  const result = defaultBindings();
  try {
    const data: unknown = JSON.parse((storage ?? globalThis.localStorage)?.getItem(BINDINGS_KEY) ?? '{}');
    if (data && typeof data === 'object') for (const a of Object.keys(result) as Action[]) {
      const keys = (data as Partial<Bindings>)[a];
      if (Array.isArray(keys) && keys.every(k => typeof k === 'string' && k.length < 80)) result[a] = [...keys];
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
  try { (storage ?? globalThis.localStorage)?.setItem(BINDINGS_KEY, JSON.stringify(current)); } catch { /* Session-only when storage is unavailable. */ }
  listeners.forEach(fn => fn());
}
export function isTyping(target: EventTarget | null): boolean {
  return typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-settings-modal]');
}
export function keyChord(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string {
  return `${(e.ctrlKey || e.metaKey) && !/^(Control|Meta)/.test(e.code) ? 'Ctrl+' : ''}${e.altKey && !e.code.startsWith('Alt') ? 'Alt+' : ''}${e.shiftKey && !e.code.startsWith('Shift') ? 'Shift+' : ''}${e.code}`;
}
export function matches(action: Action, e: KeyboardEvent): boolean {
  const chord = keyChord(e);
  return current[action].some(k => k === chord || (!k.includes('+') && k === e.code && !e.metaKey && !e.ctrlKey));
}
export function context(action: Action) { return action.startsWith('editor') ? 'editor' : action.startsWith('eva') || action === 'board' || action === 'plantFlag' ? 'eva' : 'flight'; }
const SHARED_ACTIONS = new Set<Action>(['stage', 'toggleSas', 'toggleRcs', 'map', 'warpUp', 'warpDown', 'warpStop', 'menu', 'help', 'flightData', 'stressOverlay', 'photoMode', 'focusNext', 'toggleCamMode', 'quicksave', 'quickload', 'eva', 'toggleGear', 'precision', 'precisionHold']);
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
export function actionLabel(a: Action) { return a.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()); }

/** Human-readable names shared by tutorial prose, help and shortcut hints. */
export function bindingLabel(action: Action, bindings = current): string {
  return [...new Set(bindings[action].map(k => k.replace(/Key|Digit/g, '').replace(/(Shift|Control|Alt|Meta)(Left|Right)/g, '$1').replace('Control', 'Ctrl')))].join(' / ') || 'Unbound';
}
export function bindingText(text: string, bindings = current): string {
  return text.replace(/\{(\w+)\}/g, (token, action: string) => action in DEFAULT_BINDINGS ? bindingLabel(action as Action, bindings) : token);
}
