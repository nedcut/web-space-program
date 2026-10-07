/** Reproducible ETOPO -> signed metre grid. Node only; npm ci --prefix scripts/earth-data first. */
import { fromFile } from 'geotiff';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
const source = 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif';
const cache = new URL('./.cache/', import.meta.url), output = new URL('../../public/earth/', import.meta.url);
await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
const input = new URL('etopo.tif', cache);
if (!await stat(input).catch(() => null)) {
  const response = await fetch(source);
  if (!response.ok) throw Error(`ETOPO download: ${response.status}`);
  const tmp = new URL('etopo.tmp', cache);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
  await rename(tmp, input);
}
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sourceHash = sha256(await readFile(input));
if (sourceHash !== '9d27d4b8ea8e76977e2988bca667d7c8fa68b927355feffcddd6b4875a7fd08e') throw Error('Source checksum mismatch; remove incomplete cache or review changed upstream data');
const tif = await fromFile(input.pathname), raster = await tif.getImage();
const sw = raster.getWidth(), sh = raster.getHeight(), width = 4096, height = 2048;
if (sw !== 21600 || sh !== 10800) throw Error('Unexpected source dimensions');
const bytes = Buffer.alloc(width * height * 2);
// Target pixel centres: lon=-180+(x+.5)*360/W; lat=90-(y+.5)*180/H.
// Read bounded strips rather than a 933 MB float raster. Interpolate in float64, round once to metres.
for (let y0 = 0; y0 < height; y0 += 32) {
  const y1 = Math.min(height, y0 + 32);
  const sy0 = Math.max(0, Math.floor((y0 + .5) * sh / height - .5));
  const sy1 = Math.min(sh, Math.floor((y1 - .5) * sh / height - .5) + 2);
  const data = await raster.readRasters({ window: [0, sy0, sw, sy1], samples: [0], interleave: true });
  for (let y = y0; y < y1; y++) {
    const sy = (y + .5) * sh / height - .5 - sy0, iy = Math.floor(sy), fy = sy - iy;
    for (let x = 0; x < width; x++) {
      const sx = (x + .5) * sw / width - .5, ix = Math.floor(sx), fx = sx - ix;
      const a = data[iy * sw + ix], b = data[iy * sw + ix + 1];
      const c = data[(iy + 1) * sw + ix], d = data[(iy + 1) * sw + ix + 1];
      const value = Math.round((a + (b-a)*fx)*(1-fy) + (c+(d-c)*fx)*fy);
      if (!Number.isFinite(value) || value < -12000 || value > 9000) throw Error(`Invalid source at ${x},${y}: ${value}`);
      bytes.writeInt16LE(value, (y * width + x) * 2);
    }
  }
}
await tif.close();
await writeFile(new URL('height.i16', output), bytes);
const manifest = {
  version: 1, source: { title: 'NOAA NCEI ETOPO 2022 v1, 60 arc-second ice surface', url: source, sha256: sourceHash, license: 'CC0-1.0', doi: 'https://doi.org/10.25921/fd45-gt74' },
  files: [{ path: 'height.i16', width, height, bytes: bytes.length, sha256: sha256(bytes), encoding: 'int16 little-endian, signed metres above EGM2008 geoid; negative bathymetry', resampling: 'bilinear pixel-centre sampling, rounded to nearest metre' }],
  projection: 'equirectangular EPSG:4326 geographic coordinates',
  convention: { rows: 'north to south', columns: 'west to east', pixelCenterLongitudeDegrees: '-180 + (x + 0.5) * 360 / width', pixelCenterLatitudeDegrees: '90 - (y + 0.5) * 180 / height', unitVector: 'x=cos(lat)*cos(lon), y=cos(lat)*sin(lon), z=sin(lat); angles in radians (sim/terrain/geo.ts latLonToUnit)', u: '(longitudeDegrees + 180) / 360', v: '(90 - latitudeDegrees) / 180', sampling: 'wrap longitude; bilinear float64; outer half-row blends to the mean polar row at each pole' },
  limits: 'Approx. 9.8 km equatorial spacing. Narrow islands, coastlines, summits and trenches are smoothed. Ice surface, not bedrock. Climate/cover classes are approximate geographic rules, not measured land cover. Launch plateau is an explicit gameplay override.',
};
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest.files[0]);
