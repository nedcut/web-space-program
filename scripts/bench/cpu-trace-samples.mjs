// Attribute a page-scoped trace's sampled JS to original source locations.
// Usage: node cpu-trace-samples.mjs trace.json.gz dist-cpu-before
// Chrome places ProfileChunk events on its sampling thread; correlate by profile ID, not chunk tid.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
const [file, build] = process.argv.slice(2);
if (!file || !build) throw new Error('Supply a compressed trace and its matching sourcemapped production build');
const { traceEvents: events } = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
const tid = events.find(e => e.name === 'thread_name' && e.args.name === 'CrRendererMain').tid;
const main = events.filter(e => e.tid === tid);
const profiles = new Map(), maps = new Map();
for (const e of main.filter(e => e.name === 'Profile')) profiles.set(e.id, { t: e.args.data.startTime, nodes: new Map(), samples: [] });
for (const e of events) {
  if (e.name !== 'ProfileChunk') continue;
  const p = profiles.get(e.id); if (!p) continue;
  const d = e.args.data;
  for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
  for (let i = 0; i < (d.timeDeltas?.length ?? 0); i++) {
    p.t += d.timeDeltas[i];
    p.samples.push({ ts: p.t, id: d.cpuProfile.samples[i], dt: d.timeDeltas[i] });
  }
}
function label(n) {
  const c = n?.callFrame ?? {};
  if (!c.url) return c.functionName;
  const base = path.basename(c.url);
  if (!maps.has(base)) {
    try { maps.set(base, new TraceMap(fs.readFileSync(`${build}/assets/${base}.map`, 'utf8'))); }
    catch { maps.set(base, null); }
  }
  const m = maps.get(base);
  const o = m && originalPositionFor(m, { line: c.lineNumber + 1, column: c.columnNumber });
  return o?.source ? `${o.source.replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'node_modules/')}:${o.line} ${o.name ?? c.functionName}` : `${base}:${c.lineNumber + 1} ${c.functionName}`;
}
function top(from, to) {
  const self = new Map(), inclusive = new Map();
  for (const p of profiles.values()) for (let i = 0; i < p.samples.length; i++) {
    const s = p.samples[i]; if (s.ts < from || s.ts > to) continue;
    // Sparse samples must not assign a long unsampled native wait to the preceding JS frame.
    const dt = Math.min(p.samples[i + 1]?.dt ?? 0, to - s.ts, 5000);
    const k = label(p.nodes.get(s.id)); self.set(k, (self.get(k) ?? 0) + dt);
    let n = p.nodes.get(s.id); const seen = new Set();
    while (n) {
      const k = label(n);
      if (!seen.has(k)) { inclusive.set(k, (inclusive.get(k) ?? 0) + dt); seen.add(k); }
      n = p.nodes.get(n.parent);
    }
  }
  const sorted = map => [...map].filter(([k]) => k !== '(root)').sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +(v / 1000).toFixed(2)]);
  return { self: sorted(self), inclusive: sorted(inclusive) };
}
const marks = main.filter(e => e.name.startsWith('cpu2:'));
const start = marks.find(e => e.name.endsWith(':start'))?.ts ?? 0;
const end = marks.find(e => e.name.endsWith(':end'))?.ts ?? Infinity;
const tasks = main.filter(e => e.ph === 'X' && e.name === 'RunTask' && e.dur > 50000 && e.ts >= start && e.ts < end).sort((a, b) => b.dur - a.dur);
console.log(JSON.stringify({ file: path.basename(file), longTasks: tasks.length, all: top(start, end), tasks: tasks.slice(0, 12).map(t => ({ ms: t.dur / 1000, ts: t.ts, ...top(t.ts, t.ts + t.dur) })) }, null, 2));
