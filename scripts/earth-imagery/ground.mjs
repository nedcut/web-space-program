/** Regional NASA imagery + Natural Earth urban footprints. Run after npm ci in this directory.
 * Source downloads stay in .cache; the ~1 km regional derivative streams as a pack.
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
sharp.cache(false); sharp.concurrency(2);
const cache = new URL('./.cache/ground/', import.meta.url);
const out = new URL('../../public/earth/imagery/packs/gulf-v2/', import.meta.url);
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
const u = await sharp(Buffer.from(svg)).removeAlpha().extractChannel(0).blur(1.6).raw().toBuffer();
const n = await sharp(night).removeAlpha().greyscale().raw().toBuffer();
const rgb = await sharp(day).removeAlpha().raw().toBuffer();
const density = Buffer.alloc(width*height);
for (let i=0; i<width*height; i++) {
  // Keep blue water and dark vegetation from the source visible inside metropolitan polygons.
  const land = Math.max(0, Math.min(1, (rgb[i*3+1] - rgb[i*3+2] * 0.95) / 18));
  density[i] = Math.round(u[i] * (0.2 + 0.8 * Math.pow(n[i] / 255, 0.8)) * land);
}
await save('day.webp', await sharp(rgb,{raw:{width,height,channels:3}}).webp({quality:90,effort:6}).toBuffer());
await save('urban.webp', await sharp(density,{raw:{width,height,channels:1}}).webp({lossless:true,effort:6}).toBuffer());
await save('night.webp', await sharp(n,{raw:{width,height,channels:1}}).webp({lossless:true,effort:6}).toBuffer());
// Original irregular neighbourhoods, built offline. Split parcels stop streets at different
// depths; parks interrupt the fabric, and two curved arterials cross the entire tile.
const tileSize = 2048, tile = Buffer.alloc(tileSize * tileSize * 4);
let seed = 31247;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const paint = (x, y, r, g, b, a = 255) => {
  const i = (((y + tileSize) % tileSize) * tileSize + (x + tileSize) % tileSize) * 4;
  tile[i] = r; tile[i+1] = g; tile[i+2] = b; tile[i+3] = a;
};
for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
  const district = 0.55 + 0.18 * Math.sin(x * 0.018 + Math.sin(y * 0.014)) + 0.22 * Math.cos(y * 0.027 - x * 0.009);
  paint(x, y, 40, 0, 0, Math.round(district * 255));
}
function parcel(x, y, w, h, depth) {
  if (w > 18 && h > 18) {
    const vertical = w / h > 1.25 || (w / h > 0.8 && random() > 0.5);
    const span = vertical ? w : h;
    const split = Math.floor(span * (0.3 + random() * 0.4));
    const road = depth < 4 ? 3 : depth < 7 ? 2 : 1;
    const lit = random() > 0.25;
    for (let t = 0; t < (vertical ? h : w); t++) for (let j = 0; j < road; j++) {
      const px = vertical ? x + split + j : x + t, py = vertical ? y + t : y + split + j;
      const i = (py * tileSize + px) * 4;
      paint(px, py, 28, lit && random() > 0.5 ? Math.round((depth < 4 ? 100 : 55) * random()) : 0, 160, tile[i+3]);
    }
    if (vertical) { parcel(x,y,split,h,depth+1); parcel(x+split+road,y,w-split-road,h,depth+1); }
    else { parcel(x,y,w,split,depth+1); parcel(x,y+split+road,w,h-split-road,depth+1); }
    return;
  }
  if (random() < 0.22) return;
  const tone = Math.round(70 + random() * 135), inset = 2 + Math.floor(random() * 3);
  const lamp = random() > 0.7 ? 20 + random() * 35 : 0;
  for (let py=y+inset; py<y+h-inset; py++) for (let px=x+inset; px<x+w-inset; px++) {
    const i = (py * tileSize + px) * 4;
    paint(px, py, tone, random() > 0.97 ? lamp : 0, 220, tile[i+3]);
  }
}
parcel(0, 0, tileSize, tileSize, 0);
for (let t=0; t<tileSize; t++) for (let j=-2; j<=2; j++) {
  const bend = Math.round(220 + 90 * Math.sin(t * Math.PI * 2 / tileSize) + 25 * Math.sin(t * Math.PI * 4 / tileSize));
  paint(t,bend+j,55,random() > 0.4 ? Math.round(60+random()*120) : 0,230);
  paint((bend+470+j)%tileSize,t,55,random() > 0.4 ? Math.round(50+random()*100) : 0,230);
}
await save('urban-detail.webp', await sharp(tile, {raw:{width:tileSize,height:tileSize,channels:4}}).webp({lossless:true,effort:6}).toBuffer());
await save('manifest.json', Buffer.from(JSON.stringify({version:1,width,height,bounds,
  projection:'EPSG:4326, pixel centres, rows north to south',
  description:'Static NASA GIBS Blue Marble Next Generation regional colour; 2016 Black Marble lights; Natural Earth 5.1.2 urban polygons. Street and land-cover detail in the game is illustrative, not surveyed.',
  channels:{urban:'soft urban coverage times (0.2 + 0.8 * night luminance ^ 0.8); merged into day alpha at runtime',night:'Black Marble luminance',urbanDetail:{r:'roof tone',g:'lamps',b:'built fraction',a:'neighbourhood density'}},urbanDetail:'Original procedural 2048px tile; not surveyed streets or buildings',sources,files},null,2)+'\n'));
