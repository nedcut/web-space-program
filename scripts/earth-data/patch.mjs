/**
 * Reproducible Florida height patch: native ETOPO 2022 15 arc-second pixels, no resampling.
 * Run from the repository root after `npm ci --prefix scripts/earth-data`: node scripts/earth-data/patch.mjs
 * (build.mjs runs it too). Bounds must match CAPE_PATCH in src/sim/terrain/earthData.ts.
 */
import { fromFile } from 'geotiff';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
const base = 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/15s/15s_surface_elev_gtif/';
/** Each tile is 15° × 15°, named by its north-west corner, 3600 × 3600 pixels of 1/240°. */
const tiles = [
  { name: 'N45W090', north: 45, west: -90, sha256: '7132212ec84a2c0382802940622ea383fece86f5808e56a9d641100bac9319fb' },
  { name: 'N30W090', north: 30, west: -90, sha256: '7dec8b97564d9cb940c864843f87b7ec364987a6bf9b0315cf575ad8f55c5925' },
];
const step = 1 / 240, west = -87.75, north = 31, width = 1980, height = 1620;
const cache = new URL('./.cache/', import.meta.url), output = new URL('../../public/earth/', import.meta.url);
await mkdir(cache, { recursive: true });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const bytes = Buffer.alloc(width * height * 2);
const filled = new Uint8Array(width * height);
const sources = [];
for (const tile of tiles) {
  const url = `${base}ETOPO_2022_v1_15s_${tile.name}_surface.tif`, input = new URL(`etopo15-${tile.name}.tif`, cache);
  if (!await stat(input).catch(() => null)) {
    const response = await fetch(url);
    if (!response.ok) throw Error(`ETOPO tile ${tile.name}: ${response.status}`);
    const tmp = new URL(`etopo15-${tile.name}.tmp`, cache);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
    await rename(tmp, input);
  }
  const hash = sha256(await readFile(input));
  if (hash !== tile.sha256) throw Error(`${tile.name} checksum mismatch; remove the cached tile or review changed upstream data`);
  sources.push({ url, sha256: hash });
  const tif = await fromFile(input.pathname), raster = await tif.getImage();
  const origin = raster.getOrigin(), resolution = raster.getResolution();
  if (raster.getWidth() !== 3600 || raster.getHeight() !== 3600 || origin[0] !== tile.west || origin[1] !== tile.north
    || resolution[0] !== step || resolution[1] !== -step || raster.getGeoKeys().GTRasterTypeGeoKey !== 1) throw Error(`Unexpected ${tile.name} projection`);
  // Patch pixel (x, y) is tile pixel (x + ox, y + oy): both grids share the 1/240° lattice.
  const ox = Math.round((west - tile.west) / step), oy = Math.round((tile.north - north) / step);
  const y0 = Math.max(0, -oy), y1 = Math.min(height, 3600 - oy);
  if (y0 >= y1) continue;
  const data = await raster.readRasters({ window: [ox, y0 + oy, ox + width, y1 + oy], samples: [0], interleave: true });
  for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) {
    const value = Math.round(data[(y - y0) * width + x]);
    if (!Number.isFinite(value) || value < -12000 || value > 9000) throw Error(`Invalid ${tile.name} source at ${x},${y}: ${value}`);
    bytes.writeInt16LE(value, (y * width + x) * 2);
    filled[y * width + x] = 1;
  }
  await tif.close();
}
if (filled.includes(0)) throw Error('Patch not fully covered by source tiles');
await writeFile(new URL('height-cape.i16', output), bytes);
const manifestUrl = new URL('manifest.json', output);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
manifest.files = manifest.files.filter(f => f.path !== 'height-cape.i16');
manifest.files.push({
  path: 'height-cape.i16', width, height, bytes: bytes.length, sha256: sha256(bytes),
  source: { title: 'NOAA NCEI ETOPO 2022 v1, 15 arc-second ice surface tiles', tiles: sources, license: 'CC0-1.0', doi: 'https://doi.org/10.25921/fd45-gt74' },
  bounds: { westLongitude: west, northLatitude: north, eastLongitude: west + width * step, southLatitude: north - height * step, stepDegrees: '1/240' },
  encoding: 'int16 little-endian, signed metres above EGM2008 geoid; negative bathymetry',
  resampling: 'none: native source pixels, rounded to nearest metre',
  convention: 'rows north to south; pixel centre longitude west + (x + 0.5) / 240, latitude north - (y + 0.5) / 240',
  use: 'Regional detail for Florida. Loaded after height.i16 into one buffer; sampled inside the bounds and blended into the global grid over its outer margin.',
});
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest.files.at(-1));
