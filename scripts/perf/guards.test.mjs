import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compare } from './compare.mjs';

test('CPU guard fails stable regressions and labels noisy/tiny operations informational', () => {
  assert.equal(compare([10, 10, 100], [12, 12, 1], 0.02).failed, true);
  assert.equal(compare([10], [12], 0.1).stable, false);
  assert.equal(compare([0.01], [0.02], 0).stable, false);
  assert.equal(compare([10], [10.5], 0.02).failed, false);
});
test('GPU history seeds, compares compatible runs, fails regression and rejects missing shots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perf-test-'));
  try {
    const input = join(dir, 'input.json');
    const shot = { frames: 600, cpuFrameP50: 2, gpuP50: 2, work: { cpu: Array(600).fill(2), gpu: Array(600).fill(2), visible: 'visible', focused: true }, frameP50: 10, frameP95: 12, frameP99: 15, heapMB: 40, hitches25: 0, hitches50: 0, firstFrameMs: 1000, gl: { gpuName: 'NVIDIA test' } };
    const run = { browser: 'test', date: 'test', size: '1470x920', dpr: 2, quality: 'medium', seconds: 10, cases: Object.fromEntries(['pad','ascent','orbit','moon','map','editor:orbit'].map(s => [s, structuredClone(shot)])) };
    const execute = () => {
      writeFileSync(input, JSON.stringify(run));
      return spawnSync(process.execPath, [resolve('scripts/perf/nightly-gpu.mjs'), input, 'test-sha', dir], { encoding: 'utf8' });
    };
    for (let i = 0; i < 3; i++) assert.equal(execute().status, 0);
    run.cases.orbit.frameP50 = 33.3; // Refresh quantization never gates real work.
    run.cases.orbit.frameP95 = 40;
    assert.equal(execute().status, 0); // tail jitter is informational
    run.cases.orbit.gpuP50 = 4;
    assert.equal(execute().status, 1);
    assert.match(readFileSync(join(dir, 'latest.md'), 'utf8'), /REGRESSION/);
    run.cases.orbit.gpuP50 = 2;
    run.cases.orbit.cpuFrameP50 = 4;
    assert.equal(execute().status, 1); // CPU callback regressions also gate.
    run.browser = 'different';
    assert.equal(execute().status, 0); // hardware/browser cohorts must not mix
    run.cases.moon.work.focused = false;
    assert.equal(execute().status, 1);
    run.cases.moon.work.focused = true;
    run.cases.moon.work.gpu = [];
    assert.equal(execute().status, 1);
    delete run.cases.moon;
    assert.equal(execute().status, 1);
    assert.equal(readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').length, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
