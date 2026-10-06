// Aggregates gpu-ab.sh runs: median per case and side (A = before, B = after) → ab-<name>.json / .md.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [name, dir, outDir] = process.argv.slice(2);
const runs = {};
for (const f of readdirSync(dir).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.json'))) {
  const m = f.match(new RegExp(`^${name}-([AB])-(.+)-r\\d+-dpr`)); if (!m) continue;
  const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  for (const [k, c] of Object.entries(d.cases)) ((runs[k] ??= { A: [], B: [] })[m[1]]).push(c);
}
const med = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] + (v.length % 2 ? 0 : (v[v.length / 2] - v[v.length / 2 - 1]) / 2) : null; };
const pick = { fps: (c) => c.fps, p50: (c) => c.frameP50, p99: (c) => c.frameP99, hitch: (c) => c.hitches25, cpu: (c) => c.cpuMs, sim: (c) => c.sections?.sim, render: (c) => c.sections?.render, planets: (c) => c.sections?.planets, telemetry: (c) => c.sections?.telemetry, hud: (c) => c.sections?.hud, script: (c) => c.scriptMsPerFrame, work: (c) => c.trace?.mainWorkPct, lt: (c) => c.longTasksPerMin, gc: (c) => c.trace?.gc?.msPerSec, gcMax: (c) => c.trace?.gc?.maxPauseMs, heap: (c) => c.heapMB, alloc: (c) => c.heapGrowthMBPerMin, react: (c) => c.reactRendersPerSec,
  menu: (c) => c.menuMs, ctor: (c) => c.flightCtorMs, ready: (c) => c.flightReadyMs, loadLt: (c) => c.loadLongTaskMs, loadLtMax: (c) => c.loadLongTaskMax };
const out = {};
for (const [k, s] of Object.entries(runs)) { out[k] = {}; for (const side of ['A', 'B']) { out[k][side] = { n: s[side].length }; for (const [m, f] of Object.entries(pick)) { const v = med(s[side].map(f)); if (v !== null) out[k][side][m] = Math.round(v * 100) / 100; } } }
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/ab-${name}.json`, JSON.stringify(out, null, 1));
const cols = ['fps', 'p50', 'p99', 'hitch', 'cpu', 'sim', 'render', 'planets', 'telemetry', 'hud', 'script', 'work', 'lt', 'gc', 'gcMax', 'heap', 'react'];
let md = `| Scenario | ${cols.map((c) => `${c} before → after`).join(' | ')} |\n|---|${cols.map(() => '---:').join('|')}|\n`;
for (const [k, s] of Object.entries(out)) { if (s.A.fps === undefined && s.B.fps === undefined) continue; md += `| ${k} | ${cols.map((c) => `${s.A[c] ?? '–'} → ${s.B[c] ?? '–'}`).join(' | ')} |\n`; }
for (const [k, s] of Object.entries(out)) if (k.startsWith('load')) md += `\n${k}: menu ${s.A.menu} → ${s.B.menu} ms, controller ${s.A.ctor} → ${s.B.ctor} ms, ready ${s.A.ready} → ${s.B.ready} ms, load long tasks ${s.A.loadLt} → ${s.B.loadLt} ms (max ${s.A.loadLtMax} → ${s.B.loadLtMax})`;
writeFileSync(`${outDir}/ab-${name}.md`, md + '\n');
console.log(md);
