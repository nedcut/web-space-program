import { memo, type ReactElement } from 'react';

/**
 * Original HUD glyphs. SAS mode glyphs reproduce the navball marker shapes drawn in `navball.ts` (same geometry on
 * a 32-unit grid) so a button and the marker it steers to read as the same symbol.
 */
export type SasGlyph = 'stabilityAssist' | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radialOut' | 'radialIn' | 'target' | 'antiTarget' | 'portAlign' | 'maneuver';

/** Marker colours, matching the navball (colour-blind palette follows the navball's too). */
export const SAS_COLORS: Record<SasGlyph, { normal: string; colourBlind: string }> = {
  stabilityAssist: { normal: '#e8f0f6', colourBlind: '#e8f0f6' },
  prograde: { normal: '#d8ff3c', colourBlind: '#f0e442' },
  retrograde: { normal: '#d8ff3c', colourBlind: '#f0e442' },
  normal: { normal: '#d066ff', colourBlind: '#ffffff' },
  antinormal: { normal: '#d066ff', colourBlind: '#ffffff' },
  radialOut: { normal: '#4fd8ff', colourBlind: '#56b4e9' },
  radialIn: { normal: '#4fd8ff', colourBlind: '#56b4e9' },
  target: { normal: '#ff4fb8', colourBlind: '#e69f00' },
  antiTarget: { normal: '#ff4fb8', colourBlind: '#e69f00' },
  portAlign: { normal: '#64ead7', colourBlind: '#56b4e9' },
  maneuver: { normal: '#3c8cff', colourBlind: '#cc79a7' },
};

const ray = (a: number, r0: number, r1: number) => {
  const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
  return `M${16 + c * r0} ${16 + s * r0}L${16 + c * r1} ${16 + s * r1}`;
};

const SAS: Record<SasGlyph, ReactElement> = {
  // Hold: a level wing bar with a fixed centre — "keep this attitude".
  stabilityAssist: <><circle cx="16" cy="16" r="5" /><path d="M3 16h7M22 16h7M16 6v4" /></>,
  prograde: <><circle cx="16" cy="16" r="6.5" /><circle cx="16" cy="16" r="1.5" fill="currentColor" /><path d="M9.5 16H3M22.5 16H29M16 9.5V3" /></>,
  retrograde: <><circle cx="16" cy="16" r="6.5" /><path d="M11.5 11.5l9 9M11.5 20.5l9-9M11.5 20.5L6 26M20.5 20.5L26 26M16 9.5V3" /></>,
  normal: <><path d="M16 8l7 12H9z" /><circle cx="16" cy="16" r="1.4" fill="currentColor" /></>,
  antinormal: <><path d="M16 24L9 12h14z" /><path d="M16 24v5" /><circle cx="16" cy="16" r="1.4" fill="currentColor" /></>,
  radialOut: <><circle cx="16" cy="16" r="5.5" /><path d={[45, 135, 225, 315].map(a => ray(a, 5.5, 12)).join('')} /></>,
  radialIn: <><circle cx="16" cy="16" r="9" /><path d={[45, 135, 225, 315].map(a => ray(a, 9, 4)).join('')} /></>,
  target: <><circle cx="16" cy="16" r="6.5" /><path d="M6 16h5M21 16h5M16 6v5M16 21v5" /></>,
  antiTarget: <><circle cx="16" cy="16" r="6.5" /><path d="M6 16h5M21 16h5M16 6v5M16 21v5M11.5 11.5l9 9M11.5 20.5l9-9" /></>,
  portAlign: <><path d="M4 8h7v16H4M28 8h-7v16h7M11 16h10M16 4v5" /><circle cx="16" cy="16" r="2" /></>,
  maneuver: <><circle cx="16" cy="16" r="7" strokeWidth="2.6" /><path d="M16 9V3M10 19.5l-5.5 3.5M22 19.5l5.5 3.5" strokeWidth="2.6" /></>,
};

/** Glyphs are memoised: the HUD re-renders with every telemetry publication, their props rarely change. */
export const SasIcon = memo(function SasIcon({ mode, size = 22, color }: { mode: SasGlyph; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color ?? 'currentColor'} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {SAS[mode]}
    </svg>
  );
});

export type AppGlyph = 'rcs' | 'resources' | 'flightData' | 'science' | 'crew' | 'assist' | 'target' | 'comms' | 'orbit' | 'settings' | 'help' | 'map' | 'camera' | 'stage' | 'lock' | 'unlock' | 'docking' | 'menu' | 'alarm' | 'engineering';

const APP: Record<AppGlyph, ReactElement> = {
  rcs: <path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" />,
  // Three level gauges.
  resources: <path d="M5 20V9M5 20h3V9H5M10.5 20h3V5h-3zM16 20h3v-7h-3z" />,
  // Dial with needle.
  flightData: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5M4 19h16" /></>,
  science: <path d="M9 3h6M10 3v6l-5 10c-.5 1 .2 2 1.3 2h11.4c1.1 0 1.8-1 1.3-2l-5-10V3M7.5 15h9" />,
  // Helmet with visor.
  crew: <><path d="M5 19v-6a7 7 0 0 1 14 0v6z" /><path d="M8 13.5a4 4 0 0 1 8 0v1.5H8zM4 19h16" /></>,
  // Stylised hands-off control column.
  assist: <><circle cx="12" cy="12" r="8" /><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /><circle cx="12" cy="12" r="1.6" /></>,
  target: <><circle cx="12" cy="12" r="5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>,
  comms: <><path d="M12 13v8M9 21h6" /><circle cx="12" cy="11" r="1.5" /><path d="M8.5 7.5a5 5 0 0 0 0 7M15.5 7.5a5 5 0 0 1 0 7M5.7 4.7a9 9 0 0 0 0 12.6M18.3 4.7a9 9 0 0 1 0 12.6" /></>,
  orbit: <><ellipse cx="12" cy="12" rx="10" ry="5.5" /><circle cx="12" cy="12" r="2.5" /><circle cx="21" cy="10" r="1.2" fill="currentColor" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  help: <><circle cx="12" cy="12" r="9.5" /><path d="M9.3 9.4a2.8 2.8 0 1 1 3.6 2.7c-.6.2-.9.7-.9 1.3v.8M12 17.2v.2" /></>,
  map: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="9" ry="3.5" /><path d="M12 3v18" /></>,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></>,
  stage: <path d="M12 3v13M6 10l6 6 6-6M5 21h14" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
  docking: <><path d="M4 9h5v6H4zM15 9h5v6h-5zM9 12h2M13 12h2" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  alarm: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2M4 5l3-2.5M20 5l-3-2.5" /></>,
  engineering: <path d="M12 4L4 19h16zM12 10l-3 6h6" />,
};

export const AppIcon = memo(function AppIcon({ name, size = 18 }: { name: AppGlyph; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {APP[name]}
    </svg>
  );
});

export type StagePartGlyph = 'engine' | 'solid' | 'decoupler' | 'chute' | 'fairing' | 'port' | 'science' | 'other';

const PART: Record<StagePartGlyph, ReactElement> = {
  engine: <path d="M9 3h6v4H9zM10 7l-3 9h10l-3-9M8 19l1-3M16 19l-1-3M12 20v-4" />,
  solid: <path d="M9 2h6v14H9zM9 16l-1.5 4h9L15 16M9 6h6" />,
  decoupler: <path d="M4 7h16v3H4zM4 14h16v3H4zM8 3v4M16 3v4M8 17v4M16 17v4" />,
  chute: <path d="M3 11a9 9 0 0 1 18 0zM3 11l8 9h2l8-9M12 11v9" />,
  fairing: <path d="M12 2c-4 3-6 8-6 13v6h5V7M12 2c4 3 6 8 6 13v6h-5V7" />,
  port: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  science: <path d="M9 3h6M10 3v6l-5 10c-.5 1 .2 2 1.3 2h11.4c1.1 0 1.8-1 1.3-2l-5-10V3" />,
  other: <rect x="6" y="6" width="12" height="12" rx="2" />,
};

export function StagePartIcon({ icon, size = 22 }: { icon: StagePartGlyph; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PART[icon]}
    </svg>
  );
}
