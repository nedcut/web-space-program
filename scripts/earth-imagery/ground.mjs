/** Regional NASA imagery + Natural Earth urban footprints. Run after npm ci in this directory.
 * Source downloads stay in .cache; the ~1 km regional derivative streams as a pack.
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
sharp.cache(false); sharp.concurrency(2);
const cache = new URL('./.cache/ground/', import.meta.url);
const out = new URL('../../public/earth/imagery/packs/gulf-v1/', import.meta.url);
await mkdir(cache, { recursive: true }); await mkdir(out, { recursive: true });
const width = 4096, height = 2560;
const bounds = { west: -100, east: -60, south: 10, north: 35 };
const hash = b => createHash('sha256').update(b).digest('hex');
const sources = [], files = [];
async function source(name, url, licence = 'Public domain (NASA)') {
  const path = new URL(name, cache);
  let b;
  try { b = await readFile(path); } catch {
    console.log('download', name);
    const r = await fetch(url); if (!r.ok) throw Error(`${r.status}: ${url}`);
    b = Buffer.from(await r.arrayBuffer()); await writeFile(path, b);
  }
  sources.push({ name, url, bytes: b.length, sha256: hash(b), licence });
  return b;
}
async function save(path, b) {
  await writeFile(new URL(path, out), b);
  files.push({ path, bytes: b.length, sha256: hash(b) });
  console.log(path, b.length);
}
function wms(layer, time = '') {
  return 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?' + new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, CRS: 'EPSG:4326',
    BBOX: '10,-100,35,-60', WIDTH: String(width), HEIGHT: String(height), FORMAT: 'image/png',
    ...(time ? { TIME: time } : {}),
  });
}
const day = await source('bmng.png', wms('BlueMarble_NextGeneration'));
const night = await source('black-marble-2016.png', wms('VIIRS_Black_Marble', '2016-01-01'));
const urban = JSON.parse((await source('urban.geojson', 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_urban_areas.geojson', 'Public domain (Natural Earth)')).toString());
const paths = [];
for (const f of urban.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    if (!poly[0].some(([x, y]) => x >= bounds.west && x <= bounds.east && y >= bounds.south && y <= bounds.north)) continue;
    paths.push(poly.map(ring => 'M' + ring.map(([x,y]) => `${((x-bounds.west)/40*width).toFixed(2)},${((bounds.north-y)/25*height).toFixed(2)}`).join('L') + 'Z').join(''));
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><path d="${paths.join('')}" fill="white" fill-rule="evenodd"/></svg>`;
const u = await sharp(Buffer.from(svg)).removeAlpha().extractChannel(0).raw().toBuffer();
const n = await sharp(night).removeAlpha().greyscale().raw().toBuffer();
const rgb = await sharp(day).removeAlpha().raw().toBuffer();
const density = Buffer.alloc(width*height);
for (let i=0; i<width*height; i++) density[i] = Math.round(u[i] * (0.5 + n[i] / 510));
await save('day.webp', await sharp(rgb,{raw:{width,height,channels:3}}).webp({quality:90,effort:6}).toBuffer());
await save('urban.webp', await sharp(density,{raw:{width,height,channels:1}}).webp({lossless:true,effort:6}).toBuffer());
await save('night.webp', await sharp(n,{raw:{width,height,channels:1}}).webp({lossless:true,effort:6}).toBuffer());
// Original repeating urban detail: roofs, green yards and intermittent street lamps. Hardware mips
// average sub-pixel buildings/lamps without per-fragment grid hashes or analytic filtering.
const tileSize = 256, tile = Buffer.alloc(tileSize * tileSize * 3);
const random = (x, y) => { let n = Math.imul(x + 17, 1597334677) ^ Math.imul(y + 23, 3812015801); n = Math.imul(n ^ (n >>> 15), 1597334677); return (n >>> 0) / 4294967296; };
for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
  const parcelX = Math.floor(x / 8), parcelY = Math.floor(y / 8);
  const seed = random(parcelX, parcelY);
  const px = x % 8, py = y % 8;
  const road = x % 32 < 2 || y % 32 < 2;
  const roof = !road && px >= 2 && px < 5 + (seed > 0.6 ? 1 : 0) && py >= 2 && py < 6 && seed > 0.15;
  const lamp = road && ((x % 32 === 1 && y % 8 === 1) || (y % 32 === 1 && x % 8 === 1));
  const i = (y * tileSize + x) * 3;
  tile[i] = Math.round((roof ? 0.35 + seed * 0.6 : road ? 0.12 : 0.2) * 255);
  tile[i+1] = lamp ? 255 : roof && seed > 0.7 ? 36 : 0;
  tile[i+2] = roof ? 255 : road ? 100 : 0;
}
await save('urban-detail.webp', await sharp(tile, {raw:{width:tileSize,height:tileSize,channels:3}}).webp({lossless:true,effort:6}).toBuffer());
await save('manifest.json', Buffer.from(JSON.stringify({version:1,width,height,bounds,
  projection:'EPSG:4326, pixel centres, rows north to south',
  description:'Static NASA GIBS Blue Marble Next Generation regional colour; 2016 Black Marble lights; Natural Earth 5.1.2 urban polygons. Street and land-cover detail in the game is illustrative, not surveyed.',
  channels:{urban:'urban fraction times (0.5 + 0.5 * night luminance); merged into day alpha at runtime',night:'Black Marble luminance',urbanDetail:{r:'roof tone',g:'lamps',b:'built fraction'}},urbanDetail:'Original procedural 256px tile; not surveyed streets or buildings',sources,files},null,2)+'\n'));
