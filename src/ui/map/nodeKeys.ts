/**
 * Map-view keyboard editing of maneuver nodes. Pure: the flight map resolves the node and applies the command.
 *
 *   ↑ / ↓          prograde + / −
 *   → / ←          normal + / −
 *   Alt ↑ / ↓      radial out / in      (Option on Apple keyboards)
 *   Alt → / ←      next / previous node (opens its editor)
 *   Shift          ×10 step; the node editor's "Fine tune" divides the step by 10
 *
 * The arrows only orbit the (hidden) flight camera in map view, so they are free there. Ctrl/Cmd chords are left to
 * the browser and OS (Ctrl+arrows switch desktops on macOS).
 */
export type NodeAxis = 'prograde' | 'normal' | 'radial';
export type NodeKeyCommand =
  | { kind: 'nudge'; axis: NodeAxis; sign: 1 | -1; step: number }
  | { kind: 'cycle'; dir: 1 | -1 };

export interface NodeKeyEvent { code: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }

/** Base Δv step per key press, m/s. */
export const NODE_KEY_STEP = 1;

export function nodeKeyCommand(e: NodeKeyEvent, fineTune = false): NodeKeyCommand | null {
  if (e.ctrlKey || e.metaKey) return null;
  const step = NODE_KEY_STEP * (e.shiftKey ? 10 : 1) * (fineTune ? 0.1 : 1);
  switch (e.code) {
    case 'ArrowUp': return { kind: 'nudge', axis: e.altKey ? 'radial' : 'prograde', sign: 1, step };
    case 'ArrowDown': return { kind: 'nudge', axis: e.altKey ? 'radial' : 'prograde', sign: -1, step };
    case 'ArrowRight': return e.altKey ? { kind: 'cycle', dir: 1 } : { kind: 'nudge', axis: 'normal', sign: 1, step };
    case 'ArrowLeft': return e.altKey ? { kind: 'cycle', dir: -1 } : { kind: 'nudge', axis: 'normal', sign: -1, step };
    default: return null;
  }
}

/**
 * Node after `current` in time order (wrapping). Without a current node, forward starts at the next burn and
 * backward at the last one.
 */
export function cycleNodeId(nodes: readonly { id: number; time: number }[], current: number | null, dir: 1 | -1): number | null {
  if (!nodes.length) return null;
  const sorted = [...nodes].sort((a, b) => a.time - b.time);
  const i = current === null ? -1 : sorted.findIndex(n => n.id === current);
  if (i < 0) return sorted[dir > 0 ? 0 : sorted.length - 1].id;
  return sorted[(i + dir + sorted.length) % sorted.length].id;
}

/** Rounds away float noise from repeated 0.1 m/s steps (0.1 + 0.2 → 0.3). */
export function nudged(value: number, sign: 1 | -1, step: number): number {
  return Math.round((value + sign * step) * 1000) / 1000;
}

/** Platform name of the Alt key for hints (Option on Apple keyboards). */
export function altKeyLabel(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Option' : 'Alt';
}

/** Rows for the map help popover: [keys, description]. */
export function mapKeyHelp(focusNext: string, focusHome: string): [string, string][] {
  const alt = altKeyLabel();
  return [
    ['Click orbit', 'Add a maneuver node'],
    ['Drag handles', 'Shape the node (green prograde, magenta normal, cyan radial)'],
    ['Right-click', 'Actions for a body, vessel, marker or orbit point'],
    ['Double-click', 'Focus a body or vessel'],
    [`${focusNext} / Shift+${focusNext}`, 'Cycle focus'],
    [focusHome, 'Back to the active vessel'],
    ['↑ / ↓', 'Selected node: prograde + / −'],
    ['→ / ←', 'Selected node: normal + / −'],
    [`${alt}+↑ / ↓`, 'Selected node: radial out / in'],
    ['Shift', '×10 step (Fine tune: ÷10)'],
    [`${alt}+→ / ←`, 'Next / previous node'],
    ['Delete', 'Delete the selected node'],
  ];
}
