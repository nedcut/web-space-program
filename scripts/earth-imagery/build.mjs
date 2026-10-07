/**
 * Reproducible Earth imagery build (Node only): NASA Blue Marble Next Generation (monthly, 2004), NASA Black
 * Marble 2016 night lights and the Blue Marble cloud composite, plus a water mask from the imagery itself and
 * Natural Earth coast/lake polygons. Writes WebP levels and `public/earth/imagery/manifest.json`.
 *
 *   npm ci --prefix scripts/earth-imagery
 *   node scripts/earth-imagery/build.mjs            # bundled base (2k/4k) + 8k pack
 *   node scripts/earth-imagery/build.mjs --ultra    # also the 16k pack (git-ignored; host it with the app)
 *
 * Sources are cached in scripts/earth-imagery/.cache (≈ 330 MB). All are public domain (see ATTRIBUTION).
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

sharp.cache(false);
sharp.concurrency(4);
const args = new Set(process.argv.slice(2));
const ULTRA = args.has('--ultra');
const ONLY_MONTH = [...args].find(a => a.startsWith('--month='))?.slice(8);

const cache = new URL('./.cache/', import.meta.url);
const out = new URL('../../public/earth/imagery/', import.meta.url);
const NASA = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const mm = i => String(i + 1).padStart(2, '0');

const SOURCES = {
  ...Object.fromEntries(MONTHS.map((m, i) => [`bmng-${mm(i)}`, {
    file: `world.2004${mm(i)}.3x21600x10800.jpg`, url: `${NASA}/bmng/bmng-base/${m}/world.2004${mm(i)}.3x21600x10800.jpg`,
    title: `NASA Blue Marble Next Generation, ${m} 2004 (land surface, shallow water; no shaded relief)`,
  }])),
  night: { file: 'BlackMarble_2016_3km_gray.jpg', url: `${NASA}/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg`, title: 'NASA Earth at Night (Black Marble) 2016, 3 km grayscale' },
  clouds: { file: 'cloud_combined_8192.tif', url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif', title: 'NASA Blue Marble cloud composite (Terra/MODIS, 2001–2002)' },
  land: { file: 'ne_10m_land.geojson', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_land.geojson', title: 'Natural Earth 1:10m land polygons v5.1.2' },
  lakes: { file: 'ne_10m_lakes.geojson', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson', title: 'Natural Earth 1:10m lakes v5.1.2' },
  shelves: { file: 'ne_10m_antarctic_ice_shelves_polys.geojson', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_antarctic_ice_shelves_polys.geojson', title: 'Natural Earth 1:10m Antarctic ice shelves v5.1.2' },
};

async function fetchSource(key) {
  const s = SOURCES[key];
  await mkdir(cache, { recursive: true });
  const path = new URL(s.file, cache);
  if (!await stat(path).catch(() => null)) {
    console.log(`download ${s.url}`);
    const res = await fetch(s.url);
    if (!res.ok) throw Error(`${s.url}: HTTP ${res.status}`);
    const tmp = new URL(`${s.file}.tmp`, cache);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    await rename(tmp, path);
  }
  return fileURLToPath(path);
}
const sha256 = data => createHash('sha256').update(data).digest('hex');
const files = [];
async function write(rel, buf) {
  const url = new URL(rel, out);
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, buf);
  files.push({ path: rel, bytes: buf.length, sha256: sha256(buf) });
  console.log(`  ${rel} ${(buf.length / 1e6).toFixed(2)} MB`);
}

// ------------------------------------------------------------------ Natural Earth water raster

/** Equirect SVG (x = (lon + 180)/360·W, y = (90 − lat)/180·H) of land minus lakes plus ice shelves. */
async function naturalEarthLand(W, H) {
  const cached = new URL(`land-${W}.png`, cache);
  if (await stat(cached).catch(() => null)) {
    return sharp(fileURLToPath(cached), { limitInputPixels: false }).extractChannel(0).raw().toBuffer();
  }
  const paths = { land: [], lakes: [], shelves: [] };
  for (const key of Object.keys(paths)) {
    const json = JSON.parse(await readFile(await fetchSource(key), 'utf8'));
    for (const f of json.features) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        let d = '';
        for (const ring of poly) {
          d += 'M' + ring.map(([lon, lat]) => `${((lon + 180) / 360 * W).toFixed(1)} ${((90 - lat) / 180 * H).toFixed(1)}`).join('L') + 'Z';
        }
        paths[key].push(d);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#000"/>`
    + `<path fill="#fff" fill-rule="evenodd" d="${paths.land.join('')}"/>`
    + `<path fill="#fff" fill-rule="evenodd" d="${paths.shelves.join('')}"/>`
    + `<path fill="#000" fill-rule="evenodd" d="${paths.lakes.join('')}"/></svg>`;
  const { data, info } = await sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true })
    .extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw Error(`land raster ${info.width}x${info.height}`);
  await sharp(data, { raw: { width: W, height: H, channels: 1 }, limitInputPixels: false }).png().toFile(fileURLToPath(cached));
  return data;
}

// ------------------------------------------------------------------ day colour + water mask

/**
 * Water fraction at the source resolution (255 = water). Blue Marble deep ocean is a flat (2, 5, 20) fill;
 * Natural Earth adds lakes, shallow banks and coastal water. Ice is excluded at runtime from the day colour
 * (snow-covered lakes, sea ice, ice shelves), so one mask serves every month.
 */
function waterMask(rgb, land, W, H) {
  const mask = Buffer.allocUnsafe(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += 3) {
    const dOcean = Math.abs(rgb[j] - 2) + Math.abs(rgb[j + 1] - 5) + Math.abs(rgb[j + 2] - 20);
    const oceanLike = dOcean <= 6 ? 1 : dOcean >= 16 ? 0 : (16 - dOcean) / 10;
    mask[i] = Math.round(Math.max(oceanLike, 1 - land[i] / 255) * 255);
  }
  return mask;
}

const webp = (img, quality) => img.webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
const webpLossless = img => img.webp({ lossless: true, effort: 6 }).toBuffer();
const rawImage = (buf, W, H, channels) => sharp(buf, { raw: { width: W, height: H, channels }, limitInputPixels: false });

const manifest = {
  version: 1,
  projection: 'equirectangular EPSG:4326 (same convention as public/earth/manifest.json)',
  convention: {
    rows: 'north to south (row 0 = 90°N); upload without a Y flip and sample v = 0.5 − lat/π',
    columns: 'west to east (column 0 = 180°W); u = lon/2π + 0.5 with lon = atan(y, x) in the body-fixed frame',
    tiles: 'a level with tiles > 1 is split west→east into equal squares',
    day: 'RGB = sRGB Blue Marble colour (monthly)',
    water: 'R = linear water fraction (255 = water; lossless). Ice is removed at runtime from the day colour',
    night: 'R = sRGB-encoded Black Marble radiance (saturated city cores = 255)',
    clouds: 'R = cloud reflectance (sRGB-ish greyscale as published)',
  },
  levels: [],
  sources: {},
  files,
};

async function main() {
  const months = ONLY_MONTH ? [Number(ONLY_MONTH) - 1] : MONTHS.map((_, i) => i);
  const SW = 21600, SH = 10800;
  console.log('rasterising Natural Earth coastlines');
  const land = await naturalEarthLand(SW, SH);

  const levels = [
    { id: '2k', width: 2048, quality: 86, dir: 'base', bundled: true },
    { id: '4k', width: 4096, quality: 86, dir: 'base', bundled: true },
    { id: '8k', width: 8192, quality: 80, dir: 'packs/8k', bundled: false },
    { id: '16k', width: 16384, quality: 82, dir: 'packs/16k', bundled: false, tiles: 2, build: ULTRA },
  ];
  /** Resample a full-resolution buffer to a level and write it as one file or west→east square tiles. */
  const emit = async (buf, channels, L, name, encode) => {
    const H = L.width / 2, tiles = L.tiles ?? 1;
    const img = rawImage(buf, SW, SH, channels).resize(L.width, H, { kernel: 'lanczos3' });
    if (tiles === 1) return write(`${L.dir}/${name}.webp`, await encode(img));
    const full = await img.raw().toBuffer();
    const tw = L.width / tiles;
    for (let t = 0; t < tiles; t++) {
      await write(`${L.dir}/${name}-${t}.webp`, await encode(rawImage(full, L.width, H, channels).extract({ left: t * tw, top: 0, width: tw, height: H })));
    }
  };
  let maskDone = false;
  for (const m of [6, ...months.filter(i => i !== 6)]) {
    const key = `bmng-${mm(m)}`;
    const path = await fetchSource(key);
    console.log(`month ${mm(m)}`);
    const { data: rgb, info } = await sharp(path, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== SW || info.height !== SH) throw Error(`${key}: ${info.width}x${info.height}`);
    // The static water mask comes from July (northern lakes unfrozen); a fill colour is the same every month.
    if (!maskDone) {
      const mask = waterMask(rgb, land, SW, SH);
      for (const L of levels) if (L.build !== false) await emit(mask, 1, L, `water-${L.id}`, webpLossless);
      maskDone = true;
    }
    if (!months.includes(m)) continue;
    for (const L of levels) if (L.build !== false) await emit(rgb, 3, L, `day-${L.id}-${mm(m)}`, img => webp(img, L.quality));
  }

  // Night lights and clouds are static: 4k bundled, 8k in the pack (Ultra reuses the 8k pack).
  const nightPath = await fetchSource('night');
  const cloudPath = await fetchSource('clouds');
  for (const [w, dir, q] of [[4096, 'base', 86], [8192, 'packs/8k', 76]]) {
    const night = sharp(nightPath, { limitInputPixels: false }).greyscale().resize(w, w / 2, { kernel: 'lanczos3' });
    await write(`${dir}/night-${w === 4096 ? '4k' : '8k'}.webp`, await webp(night, q));
    const clouds = sharp(cloudPath, { limitInputPixels: false }).greyscale().resize(w, w / 2, { kernel: 'lanczos3' });
    await write(`${dir}/clouds-${w === 4096 ? '4k' : '8k'}.webp`, await webp(clouds, q));
  }

  for (const L of levels) {
    const night = L.width >= 8192 ? 'packs/8k/night-8k.webp' : 'base/night-4k.webp';
    const clouds = L.width >= 8192 ? 'packs/8k/clouds-8k.webp' : 'base/clouds-4k.webp';
    manifest.levels.push({
      id: L.id, width: L.width, height: L.width / 2, tiles: L.tiles ?? 1, bundled: L.bundled,
      // The 16k pack is not in git: it is built with --ultra and hosted with the app; clients fall back to 8k.
      ...(L.id === '16k' ? { optional: true } : {}),
      day: L.tiles > 1 ? `${L.dir}/day-${L.id}-{MM}-{T}.webp` : `${L.dir}/day-${L.id}-{MM}.webp`,
      water: L.tiles > 1 ? `${L.dir}/water-${L.id}-{T}.webp` : `${L.dir}/water-${L.id}.webp`,
      night: L.width <= 2048 ? 'base/night-4k.webp' : night, clouds,
    });
  }
  for (const [key, s] of Object.entries(SOURCES)) {
    const buf = await readFile(new URL(s.file, cache)).catch(() => null);
    if (buf) manifest.sources[key] = { title: s.title, url: s.url, sha256: sha256(buf), license: key.startsWith('land') || ['lakes', 'shelves'].includes(key) ? 'Public domain (Natural Earth)' : 'Public domain (NASA)' };
  }
  if (!ONLY_MONTH) await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2) + '\n');
  else console.log('single-month build: manifest not written');
}

await main();
