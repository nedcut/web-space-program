/** Vessel-local translation axes, shared by the pad and keyboard input. */
export const TRANSLATION_CONTROLS = [
  { action: 'translateUp', label: 'Up', arrow: '↑', place: 'up' },
  { action: 'translateLeft', label: 'Left', arrow: '←', place: 'left' },
  { action: 'translateRight', label: 'Right', arrow: '→', place: 'right' },
  { action: 'translateDown', label: 'Down', arrow: '↓', place: 'down' },
  { action: 'translateForward', label: 'Forward', arrow: '▲', place: 'forward' },
  { action: 'translateBack', label: 'Back', arrow: '▼', place: 'back' },
] as const;
export type TranslationAction = typeof TRANSLATION_CONTROLS[number]['action'];
