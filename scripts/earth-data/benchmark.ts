import { createHash } from 'node:crypto';
import { World } from '../../src/game/world';
import { PART_CATALOG } from '../../src/data/parts';
import { STOCK_CRAFTS } from '../../src/editor/stockCrafts';
import { neutralInput } from '../../src/sim/vessel';
/** Run: node --import tsx --import ./scripts/earth-data/register.ts scripts/earth-data/benchmark.ts */
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { cpus } from 'node:os';
import { Universe } from '../../src/game/universe';
import { makeContext } from '../../src/sim/terrain/presets/common';
import { buildChunk } from '../../src/render/planet/chunkBuilder';
import { latLonToUnit } from '../../src/sim/terrain/geo';
import type { Terrain } from '../../src/sim/terrain/api';
const baselineRevision = '0b3f8cb2ef3ef3f7dbeebe0df1f03bdfe0419706';
const file = new URL('../../src/sim/terrain/presets/earth.baseline.ts', import.meta.url);
writeFileSync(file, execFileSync('git', ['show', `${baselineRevision}:src/sim/terrain/presets/earth.ts`]));
try {
  const { earthPreset } = await import(file.href);
  const u = new Universe('standard'), body = u.body('earth'), current = u.terrain('earth');
  const p = earthPreset(makeContext(body));
  const baseline: Terrain = { heightAt: (x,y,z) => Math.max(p.minHeight, Math.min(p.maxHeight, p.height(x,y,z))), minHeight: p.minHeight, maxHeight: p.maxHeight, colorAt: p.colorAt, ocean: true, liquid: { level: 0, density: 1000, kind: 'water' } };
  const fixtures = [
    { name: 'existing-earth-24', face: 0, level: 10, ix: 512, iy: 512 },
    { name: 'coastal-face-24', face: 3, level: 4, ix: 7, iy: 4 },
    { name: 'whole-face-24', face: 0, level: 0, ix: 0, iy: 0 },
  ];
  const rows = [];
  for (const fixture of fixtures) {
    const samples = [[], []] as number[][];
    const params = { ...fixture, res: 24, radius: body.radius, ocean: true };
    for (let round = -5; round < 9; round++) for (const which of round % 2 === 0 ? [0, 1] : [1, 0]) {
      const t = which ? current : baseline, start = performance.now();
      for (let n = 0; n < 8; n++) buildChunk(t, params);
      if (round >= 0) samples[which].push((performance.now() - start) * 1000 / 8);
    }
    const stats = samples.map(v => { v.sort((a,b)=>a-b); return { medianUs: v[4], p95Us: v[8], samplesUs: v }; });
    rows.push({ name: fixture.name, baseline: stats[0], realEarth: stats[1] });
  }
  // Central-difference normals on the plateau must remain exactly equal, not just within tolerance.
  for (let lat = 28.49; lat < 28.52; lat += .002) for (let lon = -80.61; lon < -80.59; lon += .002) {
    const d = latLonToUnit(lat, lon);
    if (baseline.heightAt(d.x,d.y,d.z) !== current.heightAt(d.x,d.y,d.z)) throw Error('Pad height changed');
  }
  const ascentHash = (terrain: Terrain) => {
    const universe = new Universe('standard'), original = universe.terrain.bind(universe);
    universe.terrain = id => id === 'earth' ? terrain : original(id);
    const world = new World(universe, PART_CATALOG, 0);
    world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-kestrel')!.build());
    const hash = createHash('sha256');
    for (let step = 0; step < 1000; step++) {
      world.tick(.02, neutralInput({ throttle: 1, stage: step === 0 }));
      const v = world.active!.state;
      hash.update(JSON.stringify([v.position, v.velocity, v.orientation, v.angularVelocity, v.mass, v.stage]));
    }
    return hash.digest('hex');
  };
  const ascent = { baseline: ascentHash(baseline), realEarth: ascentHash(current), seconds: 20, steps: 1000 };
  if (ascent.baseline !== ascent.realEarth) throw Error('Ascent physics changed');
  console.log(JSON.stringify({ ascent, node: process.version, cpu: cpus()[0].model, baselineRevision, warmups: 5, batches: 9, chunksPerBatch: 8, alternatingOrder: true, rows }, null, 2));
} finally { unlinkSync(file); }
