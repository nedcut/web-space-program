/** Approximate geographic climate/cover regions; not measured vegetation or political boundaries. */
export type EarthCover = 'Oceans' | 'Shores' | 'Grasslands' | 'Deserts' | 'Mountains' | 'Ice Caps' | 'Forests' | 'Rainforests' | 'Tundra';
function ellipse(lat: number, lon: number, la: number, lo: number, ry: number, rx: number): boolean {
  return ((lat - la) / ry) ** 2 + ((lon - lo) / rx) ** 2 < 1;
}
export function earthCover(lat: number, lon: number, elevation: number, coastal = false): EarthCover {
  if (elevation < 0) return 'Oceans';
  if (lat < -60 || (lat > 60 && lon > -73 && lon < -12 && elevation > 500)) return 'Ice Caps';
  const snowline = Math.max(800, 5100 - Math.abs(lat) * 50);
  if (elevation > snowline) return 'Ice Caps';
  if (elevation < 25 && coastal) return 'Shores';
  if (elevation > 2200) return 'Mountains';
  if (Math.abs(lat) > 66 || (lat > 58 && elevation > 700)) return 'Tundra';
  if (ellipse(lat, lon, 24, 12, 10, 29) || ellipse(lat, lon, 24, 46, 10, 14)
    || ellipse(lat, lon, -25, 134, 10, 15) || ellipse(lat, lon, -24, 16, 12, 4)
    || ellipse(lat, lon, -24, -69, 10, 3) || ellipse(lat, lon, 41, 96, 7, 21)
    || ellipse(lat, lon, 34, -114, 8, 7)) return 'Deserts';
  if (ellipse(lat, lon, -4, -63, 10, 17) || ellipse(lat, lon, 0, 24, 7, 12)
    || (lat > -12 && lat < 20 && lon > 94 && lon < 155)) return 'Rainforests';
  if (lat > 45 || (lon > -90 && lon < -60 && lat > 25 && lat < 48)
    || (lon > 100 && lat > 20 && lat < 45) || (lon > 140 && lat < -20)) return 'Forests';
  return 'Grasslands';
}
