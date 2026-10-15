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
const data = Buffer.alloc(width*height*3);
for (let i=0; i<width*height; i++) {
  // No coast/height override: regional green is unused; alpha is kept opaque to avoid premultiplication.
  data[3*i]=u[i]; data[3*i+1]=0; data[3*i+2]=n[i];
}
await save('day.webp', await sharp(rgb,{raw:{width,height,channels:3}}).webp({quality:90,effort:6}).toBuffer());
await save('settlements.webp', await sharp(data,{raw:{width,height,channels:3}}).webp({lossless:true,effort:6}).toBuffer());
await save('manifest.json', Buffer.from(JSON.stringify({version:1,width,height,bounds,
  projection:'EPSG:4326, pixel centres, rows north to south',
  description:'Static NASA GIBS Blue Marble Next Generation regional colour; 2016 Black Marble lights; Natural Earth 5.1.2 urban polygons. Street and land-cover detail in the game is illustrative, not surveyed.',
  channels:{settlements:{r:'urban fraction',g:'reserved',b:'Black Marble luminance'}},sources,files},null,2)+'\n'));
