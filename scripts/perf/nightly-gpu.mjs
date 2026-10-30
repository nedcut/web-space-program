// Aggregate the existing GPU driver's output; wrapper serializes capture AND append.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { median } from './compare.mjs';
const [input, sha, directory, harness = 'test'] = process.argv.slice(2);
const run = JSON.parse(readFileSync(input, 'utf8'));
const shots = ['pad', 'ascent', 'orbit', 'moon', 'map', 'editor:orbit'];
for (const name of shots) {
  const c = run.cases[name];
  if (!c || c.error || !(c.frames > 60) || !['frameP50','frameP95','frameP99','heapMB'].every(k => Number.isFinite(c[k]) && c[k] > 0)) throw new Error(`Invalid shot: ${name}`);
}
const gpu = run.cases.pad.gl?.gpuName;
if (!gpu || /swiftshader|llvmpipe|software/i.test(gpu)) throw new Error('Hardware GPU required');
if (!(run.cases.pad.firstFrameMs > 0)) throw new Error('Missing first flight frame timing');
mkdirSync(directory, { recursive: true });
const file = join(directory, 'history.jsonl');
const key = JSON.stringify([1, harness, run.browser, gpu, run.size, run.dpr, run.quality, run.seconds]);
const history = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const previous = history.filter(r => r.key === key).slice(-7);
const record = { schema: 1, harness, sha, date: run.date, key, browser: run.browser, gpu, shots: Object.fromEntries(shots.map(s => [s, run.cases[s]])) };
let failed = false;
let report = `# Nightly GPU: ${sha}\n\n${run.date}; ${run.browser}; ${gpu}. RTX proxy, not M-series / Zen / 120 Hz validation. Fixed paused camera shots exclude simulation progression. Long frames: >25 / >50 ms. Baseline: ${previous.length} of last 7 compatible runs.\n\n| Shot | median / p95 / p99 ms | >25 / >50 ms | Heap MB | Change median / p95 / p99 | Status |\n|---|---:|---:|---:|---|---|\n`;
for (const name of shots) {
  const c = record.shots[name], deltas = [];
  let flag = false;
  for (const metric of ['frameP50','frameP95','frameP99']) {
    const values = previous.map(r => r.shots[name][metric]);
    const delta = values.length ? c[metric]/median(values)-1 : 0;
    deltas.push(values.length ? (delta*100).toFixed(1)+'%' : 'seed');
    if (previous.length >= 3 && delta > 0.05) flag = true;
  }
  failed ||= flag;
  report += `| ${name} | ${c.frameP50} / ${c.frameP95} / ${c.frameP99} | ${c.hitches25} / ${c.hitches50} | ${c.heapMB} | ${deltas.join(' / ')} | ${flag ? 'REGRESSION' : previous.length < 3 ? 'seed' : 'pass'} |\n`;
}
const loads = previous.map(r => r.shots.pad.firstFrameMs);
const loadDelta = loads.length ? record.shots.pad.firstFrameMs/median(loads)-1 : 0;
const loadFlag = previous.length >= 3 && loadDelta > 0.10;
failed ||= loadFlag;
report += `\nNavigation to first flight frame: ${record.shots.pad.firstFrameMs.toFixed(1)} ms; change ${(loadDelta*100).toFixed(1)}%; ${loadFlag ? 'REGRESSION' : 'pass/seed'}. Flags: >5% frame percentiles, >10% load; inspect noise before attributing to a commit.\n`;
record.flagged = failed;
appendFileSync(file, JSON.stringify(record)+'\n');
writeFileSync(join(directory, 'latest.md'), report);
console.log(report);
process.exitCode = failed ? 1 : 0;
