/** Map overlay colours (sRGB) and fill strength per biome name; shared by the overlay shader, labels and legends. */
const STYLE: Record<string, { color: string; alpha: number }> = {
  Oceans: { color: '#3b7be0', alpha: 0.22 },
  Shores: { color: '#f2dc84', alpha: 0.7 },
  Grasslands: { color: '#a6dc5e', alpha: 0.5 },
  Deserts: { color: '#f4a64a', alpha: 0.55 },
  Mountains: { color: '#b88a6a', alpha: 0.55 },
  'Ice Caps': { color: '#eaf6ff', alpha: 0.55 },
  'Launch Complex': { color: '#ff5ca8', alpha: 0.8 },
  Forests: { color: '#2fae57', alpha: 0.55 },
  Rainforests: { color: '#18e0b0', alpha: 0.6 },
  Tundra: { color: '#a9b8c9', alpha: 0.5 },
  Highlands: { color: '#e0c98f', alpha: 0.45 },
  'Lowland Maria': { color: '#6b80b0', alpha: 0.5 },
  'Polar Craters': { color: '#7fd8ff', alpha: 0.5 },
  'Crater Rims': { color: '#ff9b5c', alpha: 0.5 },
  Plains: { color: '#e09a5c', alpha: 0.35 },
  Canyons: { color: '#c0402c', alpha: 0.6 },
  'Polar Caps': { color: '#eef6ff', alpha: 0.55 },
  'Volcanic Rise': { color: '#ff5f8a', alpha: 0.55 },
  'Hydrocarbon Seas': { color: '#5468c8', alpha: 0.5 },
  Dunes: { color: '#d9a85a', alpha: 0.45 },
  Lowlands: { color: '#78a8e0', alpha: 0.4 },
  Ridges: { color: '#e8805e', alpha: 0.55 },
  'Polar Regions': { color: '#e6f2ff', alpha: 0.5 },
};

const FALLBACK = ['#c58cff', '#5ce0e0', '#ffd25c', '#ff7a7a', '#8cff9e'];

export function biomeStyle(name: string): { color: string; alpha: number } {
  const known = STYLE[name];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { color: FALLBACK[h % FALLBACK.length], alpha: 0.5 };
}

/** Target highlight colour (contract and mission objectives). */
export const BIOME_TARGET_CSS = '#ffd25c';
