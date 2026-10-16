/** Run: node --import tsx scripts/bench/vessel-contact.ts. Solver only; excludes the existing vessel integrator. */
import { performance } from 'node:perf_hooks';
import { PART_CATALOG } from '../../src/data/parts';
import { buildTender } from '../../src/editor/stockCrafts';
import { buildVessel } from '../../src/sim/vessel/assembly';
import { stepVesselContacts } from '../../src/sim/vessel/vesselContact';
import { v3 } from '../../src/util/vec3';

const vessels = Array.from({ length: 3 }, (_, i) => {
  const v = buildVessel(buildTender(), PART_CATALOG, { id: `bench-${i}` });
  v.position = v3(i * 60, 0, 0);
  return v;
});
let checksum = 0;
for (const count of [1, 2, 3]) {
  const list = vessels.slice(0, count), samples: number[] = [];
  for (let i = 0; i < 100000; i++) checksum += stepVesselContacts(list, 0.02);
  for (let rep = 0; rep < 9; rep++) {
    const start = performance.now();
    for (let i = 0; i < 500000; i++) checksum += stepVesselContacts(list, 0.02);
    samples.push((performance.now() - start) * 1e6 / 500000);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ neighbours: count - 1, partsEach: vessels[0].parts.length, separationMetres: 60, medianNs: samples[4], minNs: samples[0], maxNs: samples[8] }));
}
if (checksum !== 0) throw new Error('Separated vessels unexpectedly contacted');
vessels[1].position.x = 0.9; // Deliberately overlapping many hulls: near-contact stress case.
const pair = vessels.slice(0, 2);
for (let i = 0; i < 100; i++) checksum += stepVesselContacts(pair, 0.02);
const samples: number[] = [];
for (let rep = 0; rep < 9; rep++) {
  const start = performance.now();
  for (let i = 0; i < 500; i++) checksum += stepVesselContacts(pair, 0.02);
  samples.push((performance.now() - start) * 1e6 / 500);
}
samples.sort((a, b) => a - b);
if (checksum === 0) throw new Error('Stress case did not exercise the narrow phase');
console.log(JSON.stringify({ case: 'overlapping hull stress', medianNs: samples[4], minNs: samples[0], maxNs: samples[8], checksum }));

// Single face contact, including a fresh normal/friction impulse each call (not just geometric rejection).
const { TEST_CATALOG, stackCraft } = await import('../../src/sim/vessel/testing');
const boxes = [buildVessel(stackCraft(['probe']), TEST_CATALOG), buildVessel(stackCraft(['probe']), TEST_CATALOG)];
boxes[1].position.x = 0.999;
for (let i = 0; i < 10000; i++) stepVesselContacts(boxes, 0.02);
const faceSamples: number[] = [];
for (let rep = 0; rep < 9; rep++) {
  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    for (const v of boxes) {
      v.velocity.x = v.velocity.y = v.velocity.z = 0;
      v.angularVelocity.x = v.angularVelocity.y = v.angularVelocity.z = 0;
    }
    boxes[0].velocity.x = 0.3; boxes[0].velocity.y = 0.1;
    checksum += stepVesselContacts(boxes, 0.02);
  }
  faceSamples.push((performance.now() - start) * 1e6 / 10000);
}
faceSamples.sort((a, b) => a - b);
console.log(JSON.stringify({ case: 'single box face impulse', medianNs: faceSamples[4], minNs: faceSamples[0], maxNs: faceSamples[8], checksum }));
