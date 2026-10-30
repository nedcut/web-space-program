import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { cpus, platform, arch } from 'node:os';

export const median = a => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
export function compare(a, b, noise) {
  const delta = median(b) / median(a) - 1;
  const stable = noise < 0.075 && median(a) >= 0.1;
  return { delta, noise, stable, failed: stable && delta > 0.15 };
}
function sample(dir) {
  const rows = {};
  for (const suite of ['run', 'kernels', 'render']) {
    const output = execFileSync(resolve(dir, 'node_modules/.bin/tsx'), [`scripts/bench/${suite}.ts`], { cwd: dir, encoding: 'utf8', timeout: 45000 });
    for (const line of output.trim().split('\n')) {
      if (!line.startsWith('{')) continue;
      const row = JSON.parse(line), value = row.medianUs ?? row.updateUs;
      if (row.name && Number.isFinite(value) && value > 0) rows[`${suite}/${row.name}`] = value;
    }
  }
  if (Object.keys(rows).length < 30) throw new Error('Incomplete benchmark output');
  return rows;
}
function bundle(dir) {
  const sums = { js: 0, css: 0 };
  function walk(path) {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      if (e.isDirectory()) walk(p);
      else for (const ext of Object.keys(sums)) if (p.endsWith('.' + ext)) sums[ext] += gzipSync(readFileSync(p)).length;
    }
  }
  walk(join(dir, 'dist'));
  return sums;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [base, head, out = 'perf-results'] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const aa = [[], []], ab = [[], []];
  // Alternating AB/BA balances thermal/order bias; each invocation warms itself.
  for (let r = 0; r < 3; r++) for (const side of r % 2 ? [1, 0] : [0, 1]) aa[side].push(sample(base));
  for (let r = 0; r < 3; r++) for (const side of r % 2 ? [1, 0] : [0, 1]) ab[side].push(sample(side ? head : base));
  const names = Object.keys(aa[0][0]).sort();
  for (const row of [...aa.flat(), ...ab.flat()]) if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(names)) throw new Error('Operation set changed');
  let failed = false;
  const rows = names.map(name => {
    const a = ab[0].map(x => x[name]), b = ab[1].map(x => x[name]);
    const calibration = aa.flat().map(x => x[name]);
    const noise = (Math.max(...calibration) - Math.min(...calibration)) / median(calibration);
    const c = compare(a, b, noise); failed ||= c.failed;
    return { name, base: median(a), head: median(b), ...c };
  });
  const sizes = [bundle(base), bundle(head)];
  let md = '# CPU and bundle regression guard\n\nSame runner, 3 interleaved A/A pairs then 3 A/B pairs. Threshold: >15% on operations with A/A range/median <7.5%; noisy and sub-0.1µs operations informational. CPU/RTX proxies do not establish M-series Mac / 120 Hz performance. Not a required check.\n\n| Operation | Base µs | Head µs | Change | A/A spread | Status |\n|---|---:|---:|---:|---:|---|\n';
  for (const r of rows) md += `| ${r.name} | ${r.base.toFixed(3)} | ${r.head.toFixed(3)} | ${(r.delta*100).toFixed(1)}% | ${(r.noise*100).toFixed(1)}% | ${r.failed ? 'REGRESSION' : r.stable ? 'pass' : 'informational'} |\n`;
  md += '\n| Gzip assets (sum per file) | Base bytes | Head bytes | Change |\n|---|---:|---:|---:|\n';
  for (const ext of ['js', 'css']) md += `| ${ext} | ${sizes[0][ext]} | ${sizes[1][ext]} | ${sizes[1][ext]-sizes[0][ext]} |\n`;
  writeFileSync(join(out, 'results.json'), JSON.stringify({ aa, ab, rows, sizes, node: process.version, cpu: cpus()[0]?.model, platform: platform(), arch: arch() }, null, 2));
  writeFileSync(join(out, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  if (failed) process.exitCode = 1;
}
