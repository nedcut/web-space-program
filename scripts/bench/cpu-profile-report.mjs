// Bottom-up/inclusive report for a CDP .cpuprofile, mapped through a sourcemapped production build.
// Usage: node cpu-profile-report.mjs window.cpuprofile dist-dir [top=40] [frames]
// With `frames`, times are divided by that frame count (ms per frame).
import fs from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
const [file, build, topArg = '40', framesArg] = process.argv.slice(2);
if (!file || !build) throw new Error('Supply a .cpuprofile and its sourcemapped build directory');
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const per = framesArg ? +framesArg : 1;
const nodes = new Map(p.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const maps = new Map();
function label(n) {
  const c = n.callFrame;
  if (!c.url) return c.functionName || '(anonymous)';
  const base = path.basename(c.url.split('?')[0]);
  if (!maps.has(base)) {
    try { maps.set(base, new TraceMap(fs.readFileSync(`${build}/assets/${base}.map`, 'utf8'))); } catch { maps.set(base, null); }
  }
  const m = maps.get(base);
  const o = m && c.lineNumber >= 0 && originalPositionFor(m, { line: c.lineNumber + 1, column: c.columnNumber });
  return o?.source ? `${o.source.replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, '')}:${o.line} ${o.name ?? c.functionName}` : `${base}:${c.lineNumber + 1} ${c.functionName}`;
}
const labels = new Map();
const lab = id => { if (!labels.has(id)) labels.set(id, label(nodes.get(id))); return labels.get(id); };
const self = new Map(), incl = new Map();
for (let i = 0; i < p.samples.length; i++) {
  const dt = (p.timeDeltas[i + 1] ?? 0) / 1000;
  let id = p.samples[i];
  const k = lab(id); self.set(k, (self.get(k) ?? 0) + dt);
  const seen = new Set();
  while (id !== undefined) {
    const k2 = lab(id);
    if (!seen.has(k2)) { incl.set(k2, (incl.get(k2) ?? 0) + dt); seen.add(k2); }
    id = parent.get(id);
  }
}
// CALLERS=<substring>: time in matching functions split by their caller chain (two levels).
if (process.env.CALLERS) {
  const callers = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i + 1] ?? 0) / 1000;
    for (let id = p.samples[i]; id !== undefined; id = parent.get(id)) {
      if (!lab(id).includes(process.env.CALLERS)) continue;
      const a = parent.get(id), b = a === undefined ? undefined : parent.get(a);
      const k = `${a === undefined ? '-' : lab(a)}  <-  ${b === undefined ? '-' : lab(b)}`;
      callers.set(k, (callers.get(k) ?? 0) + dt);
      break;
    }
  }
  console.log(`== callers of ${process.env.CALLERS}`);
  for (const [k, v] of [...callers].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log((v / per).toFixed(3).padStart(9), k);
}
const total = (p.endTime - p.startTime) / 1000;
console.log(`profile ${total.toFixed(0)} ms${framesArg ? `, ${per} frames` : ''}`);
for (const [name, m] of [['self', self], ['inclusive', incl]]) {
  console.log(`== ${name}${framesArg ? ' (ms/frame)' : ' (ms)'}`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, +topArg)) console.log((v / per).toFixed(3).padStart(9), k);
}
