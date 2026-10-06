// CPU profile attribution on the real-GPU Chrome (companion to gpu-bench.mjs). Records a V8 CPU profile over
// a load or a scenario window and prints top self/inclusive functions plus, for every long frame (> --long ms,
// default 25) or long task, the functions that ran inside it. Use an unminified build for readable names:
//   npx vite build --minify false --outDir dist-prof && npx vite preview --outDir dist-prof --port 5317 --strictPort --host 0.0.0.0
//   scripts/bench/gpu-profile.sh --base http://localhost:5317 --url "/?flight=stock-kestrel" --after 12000 [--dpr 2]
//        [--setup "<js run once ready>"] [--from ready|start] [--out name]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base ?? 'http://localhost:5317';
const url = args.url ?? '/?flight=stock-kestrel';
const dpr = +(args.dpr ?? 2);
const after = +(args.after ?? 10000);
const longMs = +(args.long ?? 25);
const from = args.from ?? 'start';
const settings = { quality: args.quality ?? 'medium', shadows: true, bloom: true, clouds: true, renderScale: 1, scatter: true, adaptiveQuality: false, graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0 };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
await context.addInitScript((s) => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify(s)); localStorage.setItem('wsp.help.seen.v1', '1');
  const B = (window.__prof = { lt: [], frames: [] });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) B.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  let last = 0; const tick = (n) => { if (last) B.frames.push([last, n - last]); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}, settings);
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const cdp = await context.newCDPSession(page);
if (+(args.throttle ?? 1) > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +args.throttle });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: +(args.interval ?? 250) });
try {
  if (from === 'start') await cdp.send('Profiler.start');
  await page.goto(`${base}${url}`);
  const waitFor = args.wait ?? (/flight=|mission=/.test(url) ? 'flight' : /editor/.test(url) ? 'editor' : 'any');
  if (waitFor !== 'none') await page.waitForFunction((w) => w === 'flight' ? (window.__flight && !document.querySelector('.loading-screen'))
    : w === 'editor' ? !!window.__editor?.view : !!document.querySelector('canvas, .menu-actions button'), waitFor, { timeout: 180000, polling: 100 });
  if (args.setup) await page.evaluate(args.setup);
  let profStart = 0;
  if (from === 'ready') { await page.waitForTimeout(+(args.settle ?? 2000)); profStart = await page.evaluate(() => performance.now()); await cdp.send('Profiler.start'); }
  const perfOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(after);
  const { profile } = await cdp.send('Profiler.stop');
  const { lt, frames, marks } = await page.evaluate(() => ({ ...window.__prof, marks: [...performance.getEntriesByType('mark'), ...performance.getEntriesByType('measure')].filter((e) => e.name.startsWith('wsp:')).map((e) => [e.name, Math.round(e.startTime), Math.round(e.duration)]) }));
  if (args.out) writeFileSync(`C:\\wsp-tools\\bench\\${args.out}.cpuprofile`, JSON.stringify(profile));

  // Sample timestamps (profile clock is µs, monotonic; align to performance.now via the first sample ≈ start).
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = (cf) => `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().replace(/-[\w-]{8}\.js$/, '')}:${cf.lineNumber + 1}`;
  const times = []; let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i]; times.push(t); }
  // Map profile µs → page ms: performance.now() = (profileUs - origin) where origin from timeOrigin (both monotonic in Chrome).
  // Chrome's profile timestamps share the clock with trace events (µs since boot); calibrate with the last sample ≈ now.
  const nowPage = await page.evaluate(() => performance.now());
  const offset = times[times.length - 1] / 1000 - nowPage; // approx; samples end just before stop
  void perfOrigin;
  const agg = (i0, i1) => {
    const self = new Map(); const incl = new Map();
    for (let i = i0; i < i1; i++) {
      const dt = profile.timeDeltas[i + 1] ?? 0; const id = profile.samples[i]; const n = byId.get(id);
      const k = key(n.callFrame); if (/^\((idle|program|root)\)/.test(k)) continue;
      self.set(k, (self.get(k) ?? 0) + dt);
      const seen = new Set(); for (let x = id; x !== undefined; x = parent.get(x)) { const kk = key(byId.get(x).callFrame); if (seen.has(kk)) continue; seen.add(kk); incl.set(kk, (incl.get(kk) ?? 0) + dt); }
    }
    return { self, incl };
  };
  const top = (m, n, div = 1000) => [...m.entries()].filter(([k]) => !/^\((root|program|idle)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / div).toFixed(1).padStart(8)} ms  ${k}`).join('\n');
  const all = agg(0, profile.samples.length);
  console.log(`marks: ${marks.map((m) => `${m[0]}@${m[1]}+${m[2]}`).join(' ')}`);
  console.log(`\n== self time (total ${((times[times.length - 1] - profile.startTime) / 1000).toFixed(0)} ms profiled)\n${top(all.self, +(args.top ?? 35))}`);
  console.log(`\n== inclusive\n${top(all.incl, +(args.top ?? 35))}`);
  const inWin = ([, st]) => st >= profStart;
  lt.splice(0, lt.length, ...lt.filter(inWin)); frames.splice(0, frames.length, ...frames.filter((f) => f[0] >= profStart));
  const windows = [...lt.map(([s, d]) => ['task', s, d]), ...frames.filter(([, d]) => d > longMs).map(([s, d]) => ['frame', s, d])].sort((a, b) => a[1] - b[1]);
  console.log(`\n== ${lt.length} long tasks, ${frames.filter(([, d]) => d > longMs).length} frames > ${longMs} ms (of ${frames.length})`);
  for (const [kind, s, d] of windows.slice(0, +(args.windows ?? 40))) {
    const a = (s + offset) * 1000, b = (s + d + offset) * 1000;
    let i0 = times.findIndex((x) => x >= a); if (i0 < 0) continue; let i1 = times.findIndex((x) => x > b); if (i1 < 0) i1 = times.length;
    const w = agg(i0, i1);
    const tops = [...w.self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, us]) => `${(us / 1000).toFixed(0)}ms ${k}`).join(' | ');
    const inc = [...w.incl.entries()].filter(([k]) => !/^\(|^(anon)|frame |loop |tick /.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, us]) => `${(us / 1000).toFixed(0)}ms ${k}`).join(' | ');
    console.log(`${kind.padEnd(5)} @${s.toFixed(0)} ${d.toFixed(0)} ms\n    self: ${tops}\n    incl: ${inc}`);
  }
} finally { await context.close(); await browser.close().catch(() => {}); }
