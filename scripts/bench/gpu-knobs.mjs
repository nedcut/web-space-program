// Knob sweep on the real-GPU Chrome: loads one scenario once, then for each named JS "knob" (applied in the page,
// reverted afterwards) measures rAF pacing, GPU timer ms, frameProfiler CPU ms and — from a trace — the busy time
// of Chrome's GPU-process main thread (command decoding / ANGLE translation, invisible to GPU timer queries) and the
// compositor. Used to find what actually limits a frame (pixels, passes, draw-call count, …).
//   scripts/bench/gpu-knobs.sh --base http://localhost:5320 --url "/?flight=stock-kestrel" --knobs knobs.json [--dpr 2]
// knobs.json: [{ "name": "half res", "on": "<js>", "off": "<js>" }, …]; "base" (no-op) is always measured first and last.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base ?? 'http://localhost:5320';
const url = args.url ?? '/?flight=stock-kestrel';
const dpr = +(args.dpr ?? 2);
const ms = +(args.ms ?? 4000);
const knobs = JSON.parse(readFileSync(args.knobs, 'utf8'));
const settings = { quality: args.quality ?? 'medium', shadows: true, bloom: true, clouds: true, renderScale: 1, scatter: true, adaptiveQuality: args.adaptive === '1', graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0, ...(args.settings ? JSON.parse(args.settings) : {}) };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
await context.addInitScript((s) => { localStorage.setItem('wsp.settings.v1', JSON.stringify(s)); localStorage.setItem('wsp.help.seen.v1', '1'); }, settings);
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const cdp = await context.newCDPSession(page);
const browserCdp = await browser.newBrowserCDPSession();

async function traceBusy(fn) {
  await browserCdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['toplevel', 'gpu', 'viz', 'disabled-by-default-devtools.timeline'], excludedCategories: ['*'] } });
  const r = await fn();
  const done = new Promise((res) => browserCdp.once('Tracing.tracingComplete', res));
  await browserCdp.send('Tracing.end');
  const { stream } = await done;
  const chunks = [];
  for (;;) { const x = await browserCdp.send('IO.read', { handle: stream, size: 1 << 22 }); chunks.push(x.base64Encoded ? Buffer.from(x.data, 'base64').toString() : x.data); if (x.eof) break; }
  await browserCdp.send('IO.close', { handle: stream });
  const parsed = JSON.parse(chunks.join(''));
  const ev = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const names = new Map(); const pnames = new Map();
  for (const e of ev) { if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name); if (e.ph === 'M' && e.name === 'process_name') pnames.set(e.pid, e.args.name); }
  let t0 = Infinity, t1 = -Infinity; const busy = {};
  for (const e of ev) {
    if (e.ph !== 'X' || !e.dur) continue;
    const p = pnames.get(e.pid); if (p !== 'GPU Process') continue;
    t0 = Math.min(t0, e.ts); t1 = Math.max(t1, e.ts + e.dur);
    if (e.name !== 'ThreadControllerImpl::RunTask' && e.name !== 'RunTask') continue;
    const tn = names.get(`${e.pid}:${e.tid}`) ?? 'gpu?';
    (busy[tn] ??= []).push([e.ts, e.ts + e.dur]);
  }
  const span = Math.max(1, t1 - t0); const out = {};
  for (const [k, iv] of Object.entries(busy)) {
    iv.sort((a, b) => a[0] - b[0]); let tot = 0, cs = -1, ce = -1;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else if (b > ce) ce = b; }
    if (ce > cs) tot += ce - cs;
    out[k] = Math.round((1000 * tot) / span) / 10;
  }
  return { ...r, gpuProc: out };
}

const measure = () => page.evaluate(async (ms) => {
  const f = window.__flight; const p = f.pipeline;
  if (window.__perf) { window.__perf.enabled = true; window.__perf.reset(); }
  const times = []; let last = performance.now();
  await new Promise((res) => { const t0 = last; const tick = (n) => { times.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  times.shift();
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const s = window.__perf?.summary();
  return { fps: +(1000 / avg).toFixed(1), h25: times.filter((x) => x > 25).length, gpuMs: +p.gpuMs.toFixed(2), cpu: s ? +s.cpuMs.avg.toFixed(2) : null, render: s ? +(s.sections.render ?? 0).toFixed(2) : null, calls: p.stats.calls, canvas: `${p.renderer.domElement.width}x${p.renderer.domElement.height}` };
}, ms);

try {
  await page.goto(`${base}${url}`);
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 100 });
  if (args.setup) console.log('setup:', JSON.stringify(await page.evaluate(args.setup)));
  await page.waitForTimeout(+(args.settle ?? 4000));
  const all = [{ name: 'base' }, ...knobs, { name: 'base' }];
  for (const k of all) {
    if (k.on) await page.evaluate(k.on);
    await page.waitForTimeout(800);
    const r = await traceBusy(measure);
    if (k.off) await page.evaluate(k.off);
    console.log(`${k.name.padEnd(28)} ${JSON.stringify(r)}`);
  }
} finally { await context.close(); await browser.close().catch(() => {}); }
