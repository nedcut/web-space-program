/**
 * Earth terrain chunk-build timing. Run: node --import tsx --import ./scripts/earth-data/register.ts scripts/earth-data/benchmark.ts
 * To compare against another checkout (e.g. main), copy this file there and run it the same way from that checkout;
 * fixtures are found geometrically, so both trees time the same chunks.
 */
import { cpus } from 'node:os';
import { Universe } from '../../src/game/universe';
import { buildChunk, faceToSphere } from '../../src/render/planet/chunkBuilder';
import { latLonToUnit } from '../../src/sim/terrain/geo';

/** Chunk at `level` containing (lat, lon), found by descending the quadtree toward the nearest child centre. */
function chunkAt(lat: number, lon: number, level: number) {
  const d = latLonToUnit(lat, lon), out: [number, number, number] = [0, 0, 0];
  const near = (face: number, level: number, ix: number, iy: number) => {
    const size = 2 / (1 << level);
    faceToSphere(face, -1 + (ix + .5) * size, -1 + (iy + .5) * size, out);
    return out[0] * d.x + out[1] * d.y + out[2] * d.z;
  };
  let face = 0;
  for (let f = 1; f < 6; f++) if (near(f, 0, 0, 0) > near(face, 0, 0, 0)) face = f;
  let ix = 0, iy = 0;
  for (let l = 1; l <= level; l++) {
    let best = -2, bx = 0, by = 0;
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const v = near(face, l, ix * 2 + cx, iy * 2 + cy);
      if (v > best) { best = v; bx = ix * 2 + cx; by = iy * 2 + cy; }
    }
    ix = bx; iy = by;
  }
  return { face, level, ix, iy };
}

const fixtures = [
  { name: 'existing-earth-24', scale: 'standard', face: 0, level: 10, ix: 512, iy: 512 },
  { name: 'coastal-face-24', scale: 'standard', face: 3, level: 4, ix: 7, iy: 4 },
  { name: 'whole-face-24', scale: 'standard', face: 0, level: 0, ix: 0, iy: 0 },
  { name: 'cape-standard-L9-24', scale: 'standard', ...chunkAt(28.47, -80.6, 9) },
  { name: 'pad-standard-L12-24', scale: 'standard', ...chunkAt(28.5, -80.83, 12) },
  { name: 'cape-real-L12-24', scale: 'real', ...chunkAt(28.47, -80.6, 12) },
] as const;
const rows = [];
for (const fixture of fixtures) {
  const u = new Universe(fixture.scale), body = u.body('earth'), terrain = u.terrain('earth');
  const params = { face: fixture.face, level: fixture.level, ix: fixture.ix, iy: fixture.iy, res: 24, radius: body.radius, ocean: true };
  const samples: number[] = [];
  for (let round = -5; round < 15; round++) {
    const start = performance.now();
    for (let n = 0; n < 8; n++) buildChunk(terrain, params);
    if (round >= 0) samples.push((performance.now() - start) * 1000 / 8);
  }
  samples.sort((a, b) => a - b);
  rows.push({ name: fixture.name, chunk: `${params.face}/${params.level}/${params.ix}/${params.iy}`, medianUs: Math.round(samples[7]), p90Us: Math.round(samples[13]) });
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, warmups: 5, batches: 15, chunksPerBatch: 8, rows }, null, 2));
