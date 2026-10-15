import { EARTH_COVER, earthData } from './earthData';

/** Land-cover classes stored in cover.u4, in index order (must match scripts/earth-data/cover.mjs and the manifest). */
export const COVER_CLASSES = ['Grasslands', 'Deserts', 'Forests', 'Rainforests', 'Tundra', 'Ice Caps', 'Wetlands', 'Lakes'] as const;
export type CoverClass = typeof COVER_CLASSES[number];
/** Measured land cover (MODIS/NLCD classes, see public/earth/manifest.json) plus elevation rules for sea, shore, peaks. */
export type EarthCover = CoverClass | 'Oceans' | 'Shores' | 'Mountains';

/** Land-cover class of the 0.125° cell containing latitude/longitude (degrees). */
export function coverClass(lat: number, lon: number): CoverClass {
  return COVER_CLASSES[earthData().coverCell(Math.floor((lon + 180) * EARTH_COVER.perDegree), Math.floor((90 - lat) * EARTH_COVER.perDegree))];
}
/** Peaks above this always count as ice; lower glaciers come from the measured snow/ice class. */
const PEAK_ICE = 5500;

export function earthCover(lat: number, lon: number, elevation: number, coastal = false): EarthCover {
  // No lake bed is this deep (Baikal ≈ −1190 m, Caspian ≈ −1020 m): open sea skips the cover lookup.
  if (elevation < -1500) return 'Oceans';
  if (lat < -60) return elevation < 0 ? 'Oceans' : 'Ice Caps';
  if (elevation > PEAK_ICE) return 'Ice Caps';
  const land = coverClass(lat, lon);
  // Lakes keep their name over lake-bed bathymetry (Great Lakes, Caspian) and over lakes the height grid shows flat.
  if (land === 'Lakes') return land;
  if (elevation < 0) return 'Oceans';
  if (land === 'Ice Caps') return land;
  if (land === 'Wetlands') return land;
  if (elevation < 25 && coastal) return 'Shores';
  if (elevation > 2200) return 'Mountains';
  return land;
}
