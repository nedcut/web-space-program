/**
 * Orbit-marker glyphs as inline SVG (crisp at any device pixel ratio). Original shapes: apoapsis ▲, periapsis ▼,
 * encounter ring with a centre dot, escape broken ring, impact cross, atmosphere entry arc, plane crossing diamond,
 * closest approach crosshair. Every glyph has a dark outline so it reads over bright planet discs.
 */
export type MarkerGlyph = 'ap' | 'pe' | 'encounter' | 'escape' | 'impact' | 'atmosphere' | 'crossing' | 'approach' | 'dot';

/** Glyph box, CSS px. */
export const GLYPH_PX = 16;

const DARK = '#03070f';

function shape(kind: MarkerGlyph, color: string): string {
  switch (kind) {
    case 'ap': return `<path d="M8 2.6 13.4 12.2H2.6Z" fill="${color}" stroke="${DARK}" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke"/>`;
    case 'pe': return `<path d="M8 13.4 2.6 3.8H13.4Z" fill="${color}" stroke="${DARK}" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke"/>`;
    case 'encounter': return `<circle cx="8" cy="8" r="5.2" fill="none" stroke="${DARK}" stroke-width="4"/><circle cx="8" cy="8" r="5.2" fill="none" stroke="${color}" stroke-width="2"/><circle cx="8" cy="8" r="1.8" fill="${color}"/>`;
    case 'escape': return `<circle cx="8" cy="8" r="5.2" fill="none" stroke="${DARK}" stroke-width="4"/><circle cx="8" cy="8" r="5.2" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4.2 2.6"/>`;
    case 'impact': return `<path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="${DARK}" stroke-width="5" stroke-linecap="round"/><path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
    case 'atmosphere': return `<path d="M2.8 11A5.2 5.2 0 0 1 13.2 11Z" fill="${color}" stroke="${DARK}" stroke-width="1.6" paint-order="stroke"/>`;
    case 'crossing': return `<path d="M8 2.2 13.8 8 8 13.8 2.2 8Z" fill="${DARK}" fill-opacity=".55" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/><path d="M8 2.2 13.8 8 8 13.8 2.2 8Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'approach': return `<circle cx="8" cy="8" r="4.6" fill="none" stroke="${DARK}" stroke-width="4"/><path d="M8 1v3.2M8 11.8V15M1 8h3.2M11.8 8H15" stroke="${DARK}" stroke-width="3.6"/><circle cx="8" cy="8" r="4.6" fill="none" stroke="${color}" stroke-width="1.8"/><path d="M8 1v3.2M8 11.8V15M1 8h3.2M11.8 8H15" stroke="${color}" stroke-width="1.8"/>`;
    default: return `<circle cx="8" cy="8" r="4" fill="${DARK}" fill-opacity=".6" stroke="${DARK}" stroke-width="3.6"/><circle cx="8" cy="8" r="4" fill="none" stroke="${color}" stroke-width="2"/>`;
  }
}

export function markerGlyphSvg(kind: MarkerGlyph, color: string): string {
  return `<svg width="${GLYPH_PX}" height="${GLYPH_PX}" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">${shape(kind, color)}</svg>`;
}

/** Glyph for an externally supplied marker, from its key (AN/DN, impact…). */
export function glyphForKey(key: string): MarkerGlyph {
  if (key === 'AN' || key === 'DN') return 'crossing';
  if (key === 'impact') return 'impact';
  if (key.startsWith('ca')) return 'approach';
  return 'dot';
}

/** '#rrggbb' for a 0xRRGGBB colour. */
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Outlined label text (a ring of tight dark shadows reads like a stroke at any DPR). */
export const LABEL_SHADOW = '0 0 2px #02050c, 0 0 2px #02050c, 0 0 3px #02050c, 0 1px 4px #000';
