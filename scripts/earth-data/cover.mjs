/**
 * Reproducible Earth land-cover class grid (public/earth/cover.u4) from NASA MODIS IGBP land cover + Natural Earth lakes.
 * Run from the repository root: node scripts/earth-data/cover.mjs (build.mjs runs it too). No dependencies.
 * Grid, class order and nibble packing must match EARTH_COVER in src/sim/terrain/earthData.ts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

/** Game cover classes, in stored order (EARTH_COVER.classes). */
const CLASSES = ['Grasslands', 'Deserts', 'Forests', 'Rainforests', 'Tundra', 'Ice Caps', 'Wetlands', 'Lakes'];
const C = Object.fromEntries(CLASSES.map((name, i) => [name, i]));
const W = 2880, H = 1440, STEP = 360 / W;
/** Source samples per degree (0.025°). */
const PER_DEG = 40;
/** Source samples per output cell, per axis: MODIS is requested at 0.025° (~2.8 km), a 5 × 5 vote per 0.125° cell. */
const SUB = 5, SW = W * SUB, SH = H * SUB, TILE = 3600;
/** Year of the MODIS Combined (Terra + Aqua) MCD12Q1 v6.1 annual IGBP classification served by GIBS. */
const YEAR = '2023-01-01';
/** Permanent wetlands are usually a mosaic with open water and savanna at 500 m; weight them so marsh regions survive the vote. */
const WETLAND_WEIGHT = 2;
/** Regions smaller than this many cells merge into their dominant neighbour (no speckle when flying over). */
const MIN_REGION = 8;
/** Caspian Sea: absent from Natural Earth lakes (mapped as sea there); flood-filled from MODIS water inside this box. */
const CASPIAN = { seed: [42, 50.5], south: 36, north: 48, west: 46, east: 56 };

const COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml';
const LAKES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson';
/**
 * Florida (the CAPE_PATCH bounds) votes with USGS NLCD 2021 instead: MODIS calls Merritt Island and most Florida marsh
 * savanna or water at 500 m, NLCD maps woody and emergent wetlands at 30 m. Sampled at 1/400° (WMS nearest).
 */
const FLORIDA = { west: -87.75, north: 31, east: -79.5, south: 24.25, perDegree: 400 };
const NLCD_URL = 'https://www.mrlc.gov/geoserver/mrlc_display/wms?' + new URLSearchParams({
  SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: 'NLCD_2021_Land_Cover_L48', STYLES: '', CRS: 'EPSG:4326',
  BBOX: `${FLORIDA.south},${FLORIDA.west},${FLORIDA.north},${FLORIDA.east}`, FORMAT: 'image/png',
  WIDTH: String((FLORIDA.east - FLORIDA.west) * FLORIDA.perDegree), HEIGHT: String((FLORIDA.north - FLORIDA.south) * FLORIDA.perDegree),
});
const tileUrl = (south, west) => 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?' + new URLSearchParams({
  SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', CRS: 'EPSG:4326',
  BBOX: `${south},${west},${south + 90},${west + 90}`, WIDTH: String(TILE), HEIGHT: String(TILE), FORMAT: 'image/png', TIME: YEAR,
});
const TILES = [];
for (const south of [0, -90]) for (const west of [-180, -90, 0, 90]) TILES.push({ south, west });

const cache = new URL('./.cache/cover/', import.meta.url), output = new URL('../../public/earth/', import.meta.url);
await mkdir(cache, { recursive: true });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sources = [];
async function source(name, url, expected) {
  const path = new URL(name, cache);
  let bytes = await readFile(path).catch(() => null);
  if (!bytes) {
    console.log('download', name);
    const response = await fetch(url);
    if (!response.ok) throw Error(`${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path, bytes);
  }
  const hash = sha256(bytes);
  if (expected && hash !== expected) throw Error(`${name} checksum mismatch; remove the cached file or review changed upstream data`);
  sources.push({ url, sha256: hash });
  return bytes;
}
// Inputs are pinned by the hashes recorded in the manifest by the previous build (a first build records them).
const previous = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8')).files.find(f => f.path === 'cover.u4');
const pinned = new Map((previous?.source?.inputs ?? []).map(s => [s.url, s.sha256]));

/** Minimal PNG decoder for GIBS output: 8-bit RGB/RGBA/palette, non-interlaced. Returns RGBA. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw Error('not a PNG');
  let p = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, plte, trns; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') plte = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const ch = { 2: 3, 6: 4, 3: 1 }[type];
  if (depth !== 8 || interlace || !ch) throw Error(`Unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat)), stride = width * ch, px = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v;
    }
    prev = cur;
  }
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (type === 3) { const k = px[i]; out[i * 4] = plte[k * 3]; out[i * 4 + 1] = plte[k * 3 + 1]; out[i * 4 + 2] = plte[k * 3 + 2]; out[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255; }
    else { out[i * 4] = px[i * ch]; out[i * 4 + 1] = px[i * ch + 1]; out[i * 4 + 2] = px[i * ch + 2]; out[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255; }
  }
  return { width, height, data: out };
}

// 1. MODIS IGBP classes (0/17 water, 1–16 land, 255 fill) at 0.025°, decoded through the pinned GIBS colormap.
const colormap = (await source('colormap.xml', COLORMAP_URL, pinned.get(COLORMAP_URL))).toString();
const igbp = new Map();
for (const [, rgb, values] of colormap.matchAll(/rgb="(\d+,\d+,\d+)"[^>]*?sourceValue="([\d,]+)"/g)) igbp.set(rgb, +values.split(',').at(-1));
if (igbp.size !== 18) throw Error(`Unexpected colormap: ${igbp.size} entries`);
const modis = new Uint8Array(SW * SH).fill(255);
for (const tile of TILES) {
  const url = tileUrl(tile.south, tile.west);
  const png = decodePng(await source(`igbp-${YEAR.slice(0, 4)}-${tile.south}-${tile.west}.png`, url, pinned.get(url)));
  if (png.width !== TILE || png.height !== TILE) throw Error('Unexpected tile size');
  const ox = (tile.west + 180) * PER_DEG, oy = -tile.south * PER_DEG;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const i = (y * TILE + x) * 4;
    if (png.data[i + 3] === 0) continue;
    const value = igbp.get(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
    if (value === undefined) throw Error(`Unknown colour ${png.data.subarray(i, i + 3).join(',')} in tile ${tile.south},${tile.west}`);
    modis[(oy + y) * SW + ox + x] = value;
  }
}

// 2. Lake mask at source resolution: Natural Earth 1:10m lakes (even-odd scanline fill at sample centres), plus the Caspian.
const lake = new Uint8Array(SW * SH);
const lakes = JSON.parse((await source('ne_10m_lakes.geojson', LAKES_URL, pinned.get(LAKES_URL))).toString());
for (const feature of lakes.features) {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const rings of polygons) {
    let north = -90, south = 90;
    for (const [, lat] of rings[0]) { north = Math.max(north, lat); south = Math.min(south, lat); }
    for (let y = Math.max(0, Math.floor((90 - north) * PER_DEG)); y <= Math.min(SH - 1, Math.ceil((90 - south) * PER_DEG)); y++) {
      const lat = 90 - (y + .5) / PER_DEG, xs = [];
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j], [x1, y1] = ring[i];
        if ((y0 > lat) !== (y1 > lat)) xs.push(x0 + (lat - y0) / (y1 - y0) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.ceil((xs[k] + 180) * PER_DEG - .5), b = Math.floor((xs[k + 1] + 180) * PER_DEG - .5);
        for (let x = Math.max(0, a); x <= Math.min(SW - 1, b); x++) lake[y * SW + x] = 1;
      }
    }
  }
}
{
  const water = i => modis[i] === 0 || modis[i] === 17;
  const at = (lat, lon) => Math.floor((90 - lat) * PER_DEG) * SW + Math.floor((lon + 180) * PER_DEG);
  const y0 = (90 - CASPIAN.north) * PER_DEG, y1 = (90 - CASPIAN.south) * PER_DEG;
  const x0 = (CASPIAN.west + 180) * PER_DEG, x1 = (CASPIAN.east + 180) * PER_DEG;
  const stack = [at(...CASPIAN.seed)];
  if (!water(stack[0])) throw Error('Caspian seed is not water');
  while (stack.length) {
    const i = stack.pop(), x = i % SW, y = (i - x) / SW;
    if (lake[i] || !water(i) || x < x0 || x > x1 || y < y0 || y > y1) continue;
    lake[i] = 1;
    stack.push(i - 1, i + 1, i - SW, i + SW);
  }
}

// NLCD legend colours (official class palette) → game class; open water and no-data (white) abstain.
const counts = new Float64Array(CLASSES.length);
const nlcd = await source('nlcd-2021-florida.png', NLCD_URL, pinned.get(NLCD_URL)).then(decodePng);
const NLCD = new Map(Object.entries({
  '71,107,160': -1, '255,255,255': -1, // 11 open water, outside coverage
  '221,201,201': C.Grasslands, '216,147,130': C.Grasslands, '237,0,0': C.Grasslands, '170,0,0': C.Grasslands, // 21–24 developed
  '178,173,163': C.Grasslands, '204,186,124': C.Grasslands, '226,226,193': C.Grasslands, // 31 barren, 52 shrub, 71 grassland
  '219,216,61': C.Grasslands, '170,112,40': C.Grasslands, // 81 pasture, 82 crops
  '104,170,99': C.Forests, '28,99,48': C.Forests, '181,201,142': C.Forests, // 41–43 forest
  '186,216,234': C.Wetlands, '112,163,186': C.Wetlands, // 90 woody, 95 emergent herbaceous wetlands
}));
const nlcdClass = new Int8Array(nlcd.width * nlcd.height);
for (let i = 0; i < nlcdClass.length; i++) {
  const value = NLCD.get(`${nlcd.data[i * 4]},${nlcd.data[i * 4 + 1]},${nlcd.data[i * 4 + 2]}`);
  if (value === undefined) throw Error(`Unknown NLCD colour ${nlcd.data.subarray(i * 4, i * 4 + 3).join(',')}`);
  nlcdClass[i] = value;
}
const NLCD_SUB = FLORIDA.perDegree / 8; // samples per 0.125° cell, per axis
const fx0 = (FLORIDA.west + 180) * 8, fy0 = (90 - FLORIDA.north) * 8;
/** Adds NLCD votes for a Florida cell; returns false outside the box or where NLCD has no land. */
function nlcdVotes(cx, cy) {
  const ox = (cx - fx0) * NLCD_SUB, oy = (cy - fy0) * NLCD_SUB;
  if (ox < 0 || oy < 0 || ox >= nlcd.width || oy >= nlcd.height) return false;
  let any = false;
  for (let y = 0; y < NLCD_SUB; y++) for (let x = 0; x < NLCD_SUB; x++) {
    const v = nlcdClass[(oy + y) * nlcd.width + ox + x];
    if (v >= 0) { counts[v]++; any = true; }
  }
  return any;
}

// 3. One vote per source sample; water outside lakes and fill pixels abstain.
const UNSET = 255;
function vote(value, lat) {
  const polar = Math.abs(lat);
  switch (value) {
    case 1: case 3: case 4: case 5: return C.Forests;
    case 2: return polar < 30 ? C.Rainforests : C.Forests;
    case 6: return polar >= 55 ? C.Tundra : C.Grasslands;
    case 7: return polar >= 55 ? C.Tundra : C.Deserts;
    // Boreal savannas are sparse larch/spruce taiga (10–60% tree cover), not grassland.
    case 8: case 9: return polar >= 50 ? C.Forests : C.Grasslands;
    case 10: return polar >= 60 ? C.Tundra : C.Grasslands;
    case 11: return C.Wetlands;
    case 12: case 13: case 14: return C.Grasslands;
    case 15: return C['Ice Caps'];
    case 16: return polar >= 60 ? C.Tundra : C.Deserts;
    default: return UNSET;
  }
}
let cells = new Uint8Array(W * H).fill(UNSET);
for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
  counts.fill(0);
  const lat = 90 - (cy + .5) * STEP;
  let lakes = 0;
  const florida = nlcdVotes(cx, cy);
  for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) {
    const i = (cy * SUB + sy) * SW + cx * SUB + sx;
    if (lake[i]) { lakes++; continue; }
    if (florida) continue;
    const v = vote(modis[i], lat);
    if (v !== UNSET) counts[v] += v === C.Wetlands ? WETLAND_WEIGHT : 1;
  }
  // Lakes need a majority of the cell; otherwise land votes decide (a lake shore stays land).
  if (lakes * 2 > SUB * SUB) { cells[cy * W + cx] = C.Lakes; continue; }
  let best = UNSET, most = 0;
  for (let k = 0; k < CLASSES.length; k++) if (counts[k] > most) { most = counts[k]; best = k; }
  cells[cy * W + cx] = best;
}

// 4. Sea and unclassified cells take the nearest land class (breadth first; lakes do not spread), so land at a
//    coarser coastline than the height grid's always has a class. The runtime decides sea by elevation.
const neighbours = (i, visit) => {
  const x = i % W, y = (i - x) / W;
  visit(y * W + (x + W - 1) % W); visit(y * W + (x + 1) % W);
  if (y > 0) visit(i - W);
  if (y < H - 1) visit(i + W);
};
{
  let frontier = [];
  for (let i = 0; i < W * H; i++) if (cells[i] !== UNSET && cells[i] !== C.Lakes) frontier.push(i);
  while (frontier.length) {
    const next = [];
    for (const i of frontier) neighbours(i, j => { if (cells[j] === UNSET) { cells[j] = cells[i]; next.push(j); } });
    frontier = next;
  }
}

// 5. Two 3 × 3 majority passes (centre counts double; ties keep the centre), then merge regions below MIN_REGION.
for (let pass = 0; pass < 2; pass++) {
  const next = new Uint8Array(cells);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    counts.fill(0);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = Math.min(H - 1, Math.max(0, y + dy));
      for (let dx = -1; dx <= 1; dx++) counts[cells[yy * W + (x + dx + W) % W]] += dx || dy ? 1 : 2;
    }
    let best = cells[y * W + x];
    for (let k = 0; k < CLASSES.length; k++) if (counts[k] > counts[best]) best = k;
    next[y * W + x] = best;
  }
  cells = next;
}
for (let round = 0; round < 8; round++) {
  const label = new Int32Array(W * H).fill(-1);
  let merged = 0;
  for (let start = 0; start < W * H; start++) {
    if (label[start] >= 0) continue;
    const cls = cells[start], members = [start], border = new Float64Array(CLASSES.length);
    label[start] = start;
    for (let k = 0; k < members.length; k++) neighbours(members[k], j => {
      if (cells[j] === cls) { if (label[j] < 0) { label[j] = start; members.push(j); } }
      else border[cells[j]]++;
    });
    if (members.length >= MIN_REGION) continue;
    let best = cls, most = 0;
    for (let k = 0; k < CLASSES.length; k++) if (border[k] > most) { most = border[k]; best = k; }
    if (best === cls) continue;
    for (const i of members) cells[i] = best;
    merged++;
  }
  console.log(`cleanup round ${round}: merged ${merged} small regions`);
  if (!merged) break;
}

// 6. Two cells per byte: even column in the low nibble. Rows north to south.
const bytes = Buffer.alloc(W * H / 2);
for (let i = 0; i < W * H; i += 2) bytes[i >> 1] = cells[i] | cells[i + 1] << 4;
await writeFile(new URL('cover.u4', output), bytes);
const histogram = Object.fromEntries(CLASSES.map((name, k) => [name, cells.reduce((n, c) => n + (c === k ? 1 : 0), 0)]));
console.log('cover.u4', bytes.length, histogram);

const manifestUrl = new URL('manifest.json', output);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
manifest.files = manifest.files.filter(f => f.path !== 'cover.u4');
manifest.files.push({
  path: 'cover.u4', width: W, height: H, bytes: bytes.length, sha256: sha256(bytes),
  source: {
    title: `NASA MODIS Combined (Terra + Aqua) MCD12Q1 v6.1 IGBP land cover, ${YEAR.slice(0, 4)}, via NASA GIBS; Natural Earth 1:10m lakes v5.1.2`,
    license: 'MODIS: NASA data, no restrictions on use (public domain). Natural Earth: public domain.',
    inputs: sources,
  },
  classes: CLASSES,
  encoding: 'two 4-bit class indices per byte, even column in the low nibble; index into `classes`',
  convention: 'rows north to south; cell centre longitude -180 + (x + 0.5) * 0.125, latitude 90 - (y + 0.5) * 0.125',
  derivation: `MODIS sampled at 0.025° (WMS nearest), 5 × 5 votes per cell (permanent wetlands weighted ${WETLAND_WEIGHT}×; latitude splits tundra/rainforest); lakes where Natural Earth lakes (+ Caspian flood fill) cover over half the cell; sea and unclassified cells take the nearest land class; two 3 × 3 majority passes; regions under ${MIN_REGION} cells merged into their main neighbour.`,
  use: 'Science biome and terrain colour classes over land. Loaded after the height files into one buffer. Sea, shores, mountains and snowline stay elevation rules at runtime.',
});
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
