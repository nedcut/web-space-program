// Real-GPU benchmark suite: drives a real Chrome (hardware GPU) over CDP and records, per scenario,
// frame pacing, the in-game frameProfiler CPU sections, long tasks, GC pauses and per-thread busy time
// (trace), CDP Performance metrics (heap, DOM nodes, listeners, layout/style counts, script/task time),
// React commit counts, worker message traffic, renderer.info and load timelines. It also runs a 3-minute
// memory soak and a scene-cycle leak test. Output: <out>.json and <out>.md (one table row per scenario).
//
// Runs under Windows Node (CDP of Windows Chrome is only reachable from Windows). From WSL:
//   npm run build && npx vite preview --port 5315 --strictPort --host 0.0.0.0 &
//   scripts/bench/gpu-bench.sh --label baseline --dpr 2 [--throttle 4] [--cases pad,orbit] [--seconds 10]
// Chrome must run with --remote-debugging-port=9333 (see docs/PERFORMANCE.md). Every case uses its own
// browser context (cold caches, isolated storage) and closes it, so concurrent users of the browser are safe.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base ?? 'http://localhost:5315';
const label = args.label ?? 'run';
const seconds = +(args.seconds ?? 10);
const settleMs = +(args.settle ?? 3000);
const dpr = +(args.dpr ?? 2);
const throttle = +(args.throttle ?? 1);
const quality = args.quality ?? 'medium';
const [vw, vh] = (args.size ?? '1470x920').split('x').map(Number);
const outDir = args.out ?? (args.local === '1' ? 'docs/performance/perfcpu' : 'C:\\wsp-tools\\bench');
const ALL = 'load,menu,pad,ascent,orbit,warp1k,warp100k,map,moon,saturn,editor,tracking,soak,cycles';
const cases = (args.cases ?? ALL).split(',');
const trace = args.trace !== '0';
// --profile 1: also save a sampled CPU profile per window (<out>/<label>-<case>.cpuprofile; see cpu-profile-report.mjs).
const cpuProfile = args.profile === '1';
const PRESETS = {
  low: { shadows: false, bloom: false, clouds: false, renderScale: 0.5 },
  medium: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  ultra: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  high: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
};
const settings = { quality, ...PRESETS[quality], scatter: true, adaptiveQuality: args.adaptive === '1', graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0, ...(args.settings ? JSON.parse(args.settings) : {}) };

const browser = args.local === '1'
  ? await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 30000 });
const results = { browser: await browser.version(), label, base, local: args.local === '1', noRaster: args['cpu-only'] === '1', noSubmission: args.nogpu === '1', dpr, throttle, quality, seconds, size: `${vw}x${vh}`, date: new Date().toISOString(), cases: {} };
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------------------------------------
// Page instrumentation, installed before any app script runs.
function instrument(s) {
  localStorage.setItem('wsp.settings.v1', JSON.stringify(s));
  localStorage.setItem('wsp.help.seen.v1', '1');
  const B = (window.__bench = { lt: [], commits: 0, fibers: 0, workers: {}, raf: null });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) B.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported */ }
  // Minimal React DevTools hook: count commits and function/class components that rendered in each.
  const COMPOSITE = new Set([0, 1, 11, 14, 15]);
  const walk = (next) => {
    for (let c = next.child; c; c = c.sibling) {
      const p = c.alternate;
      if (COMPOSITE.has(c.tag) && (!p || p.memoizedProps !== c.memoizedProps || p.memoizedState !== c.memoizedState)) B.fibers++;
      if (!p || c.child !== p.child) walk(c);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; }, checkDCE() {},
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, setStrictMode() {},
    onCommitFiberRoot(_id, root) { B.commits++; try { walk(root.current); } catch { /* ignore */ } },
  };
  // One scene cycle driven inside the page (a single, identical evaluate per cycle: harness-compiled scripts do
  // not accumulate in the heap): flight → map → editor → flight → menu.
  const until = async (f, ms = 60000) => { const t0 = performance.now(); while (!f()) { if (performance.now() - t0 > ms) throw new Error('cycle timeout'); await new Promise((r) => setTimeout(r, 100)); } };
  const flightUp = () => !!window.__flight && !document.querySelector('.loading-screen');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__benchCycle = async () => {
    const g = window.__game;
    g.set({ scene: 'flight', launchPending: true, resumeWorld: null }); await until(flightUp); await pause(1000);
    window.__flight.toggleMap(); await pause(1000); window.__flight.toggleMap();
    g.set({ scene: 'editor' }); await until(() => !!window.__editor?.view); await pause(1000);
    g.set({ scene: 'flight', launchPending: true, resumeWorld: null }); await until(flightUp); await pause(1000);
    g.set({ scene: 'menu' }); await pause(1000);
    return document.querySelectorAll('canvas').length;
  };
  // Worker traffic: messages each way, per worker script.
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts);
      const k = String(url).split('/').pop().replace(/-[\w-]{8}\.js.*$/, '').replace(/\?.*$/, '');
      const st = (B.workers[k] ??= { created: 0, out: 0, in: 0 });
      st.created++;
      this.addEventListener('message', () => { st.in++; });
      const pm = this.postMessage.bind(this);
      this.postMessage = (...a) => { st.out++; return pm(...a); };
    }
  };
}

async function newPage() {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  if (args['cpu-only'] === '1') await context.addInitScript(() => {
    // CPU diagnostic only: keep three's traversal/submission but omit software rasterisation in WSL.
    // This does NOT measure real rendered frame pacing or GPU cost.
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (name in proto) proto[name] = () => {};
      }
    }
  });
  await context.addInitScript(instrument, settings);
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('Performance.enable');
  return { context, page, cdp };
}

const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const flightReady = (page, timeout = 120000) => page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout, polling: 100 });
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

// ---------------------------------------------------------------------------------------------------------
// Trace: GC pauses on the page's main thread and busy time per renderer thread (main, workers, compositor).
async function startTrace(cdp) {
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['toplevel', 'devtools.timeline', 'v8', 'disabled-by-default-devtools.timeline'], excludedCategories: ['*'] } });
}
async function stopTrace(cdp, pageUrl, name) {
  const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
  await cdp.send('Tracing.end');
  const { stream } = await done;
  // Parse complete event objects while draining the stream: a two-minute
  // whole-browser trace can exceed V8's 512 MiB string limit on a shared GPU harness.
  let pending = '', pid = null;
  let inEvents = false, ended = false, depth = 0, quoted = false, escaped = false, event = '';
  let ev = [];
  const consume = (line) => {
    const value = line.trim().replace(/,$/, '');
    if (!value.startsWith('{') || value.startsWith('{"traceEvents"')) return;
    const e = JSON.parse(value);
    if (!e.ph) return;
    const frames = e.args?.data?.frames;
    if ((e.name === 'TracingStartedInBrowser' || e.name === 'TracingStartedInPage') && frames) {
      const f = frames.find(x => x.url && pageUrl.startsWith(x.url.split('#')[0].split('?')[0]));
      if (f) { pid = f.processId ?? e.pid; ev = ev.filter(x => x.pid === pid); }
    }
    if (pid === null || e.pid === pid) ev.push(e);
  };
  for (;;) {
    const r = await cdp.send('IO.read', { handle: stream, size: 1 << 22 });
    let chunk = r.base64Encoded ? Buffer.from(r.data, 'base64').toString() : r.data;
    if (!inEvents) {
      pending += chunk;
      const start = pending.indexOf('[');
      if (start < 0) continue;
      chunk = pending.slice(start + 1); pending = ''; inEvents = true;
    }
    for (const ch of chunk) {
      if (ended) break;
      if (!depth) {
        if (ch === ']') { ended = true; break; }
        if (ch !== '{') continue;
        depth = 1; event = '{'; continue;
      }
      event += ch;
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { consume(event); event = ''; }
    }
    if (r.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const names = new Map();
  for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  if (pid == null) { const main = [...names.entries()].find(([, n]) => n === 'CrRendererMain'); pid = main ? +main[0].split(':')[0] : null; }
  if (args['save-traces'] === '1') {
    mkdirSync(outDir, { recursive: true });
    // Chrome traces the shared browser. Retain only our renderer process (including its workers),
    // not unrelated tabs. Metadata keeps the process identifiable on later analysis.
    writeFileSync(`${outDir}/${label}-${name}.trace.json.gz`, gzipSync(JSON.stringify({
      traceEvents: ev.filter(e => e.pid === pid), metadata: { pageUrl, pagePid: pid },
    })));
  }
  let t0 = Infinity, t1 = -Infinity;
  const busy = {}; const gc = { minor: [], major: [] }; const mainEv = {};
  for (const e of ev) {
    if (e.pid !== pid || e.ph !== 'X' || !e.dur) continue;
    t0 = Math.min(t0, e.ts); t1 = Math.max(t1, e.ts + e.dur);
    const tn = names.get(`${e.pid}:${e.tid}`) ?? 'unknown';
    if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') { const k = `${e.tid}|${/DedicatedWorker/.test(tn) ? 'workers' : tn}`; (busy[k] ??= []).push([e.ts, e.ts + e.dur]); }
    if (tn === 'CrRendererMain' && e.name !== 'RunTask' && e.name !== 'ThreadControllerImpl::RunTask') mainEv[e.name] = (mainEv[e.name] ?? 0) + e.dur;
    if (tn === 'CrRendererMain') {
      if (e.name === 'MinorGC' || e.name === 'V8.GC_SCAVENGER' || e.name === 'MinorMS') gc.minor.push(e.dur / 1000);
      if (e.name === 'MajorGC' || e.name === 'V8.GC_MARK_COMPACTOR') gc.major.push(e.dur / 1000);
    }
  }
  const span = Math.max(1, (t1 - t0) / 1000);
  // Nested task events overlap: merge intervals per thread, then sum per thread kind (µs).
  const busyUs = {};
  for (const [k, iv] of Object.entries(busy)) {
    iv.sort((a, b) => a[0] - b[0]); let tot = 0, cs = -1, ce = -1;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else if (b > ce) ce = b; }
    if (ce > cs) tot += ce - cs;
    const kind = k.split('|')[1]; busyUs[kind] = (busyUs[kind] ?? 0) + tot;
  }
  const workerThreads = [...names.entries()].filter(([k, n]) => +k.split(':')[0] === pid && /DedicatedWorker/.test(n)).length;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  return {
    spanMs: r2(span), workerThreads,
    // Main-thread trace events by name (inclusive ms per second; nested events overlap their parents).
    mainTop: Object.fromEntries(Object.entries(mainEv).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, us]) => [k, r2(us / span)])),
    busyPct: Object.fromEntries(Object.entries(busyUs).map(([k, us]) => [k, r2((100 * us) / 1000 / span)])),
    // Blink's main-thread "Commit" blocks until the compositor/GPU side takes the frame (vsync back-pressure):
    // it is waiting, not work. Main-thread work = busy − Commit.
    mainWorkPct: r2((100 * ((busyUs.CrRendererMain ?? 0) - (mainEv.Commit ?? 0))) / 1000 / span),
    commitWaitPct: r2((100 * (mainEv.Commit ?? 0)) / 1000 / span),
    gc: { minorCount: gc.minor.length, minorMs: r2(sum(gc.minor)), majorCount: gc.major.length, majorMs: r2(sum(gc.major)), maxPauseMs: r2(Math.max(0, ...gc.minor, ...gc.major)), msPerSec: r2((sum(gc.minor) + sum(gc.major)) / (span / 1000)) },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Measurement window: rAF pacing, frameProfiler, long tasks, React commits, workers, CDP metrics, trace.
async function measure(page, cdp, name, ms = seconds * 1000, extra = {}) {
  await page.evaluate(() => {
    const B = window.__bench;
    B.ltStart = B.lt.length; B.commits0 = B.commits; B.fibers0 = B.fibers;
    B.workers0 = JSON.parse(JSON.stringify(B.workers));
    if (window.__perf) { window.__perf.enabled = true; window.__perf.reset(); }
    const r = (B.raf = { t: [], on: true, last: performance.now(), start: performance.now() });
    const tick = (n) => { if (!r.on) return; r.t.push(n - r.last); r.last = n; requestAnimationFrame(tick); };
    requestAnimationFrame((n) => { r.last = n; requestAnimationFrame(tick); });
  });
  const m0 = await metrics(cdp);
  if (trace) await startTrace(cdp);
  if (cpuProfile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  await page.waitForTimeout(ms);
  if (cpuProfile) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(join(outDir, `${label}-${name.replace(/[^\w-]/g, '_')}.cpuprofile`), JSON.stringify(profile));
  }
  const tr = trace ? await stopTrace(cdp, page.url(), name).catch((e) => ({ error: String(e) })) : undefined;
  const m1 = await metrics(cdp);
  const inPage = await page.evaluate(() => {
    const B = window.__bench; B.raf.on = false;
    const dur = performance.now() - B.raf.start;
    const lt = B.lt.slice(B.ltStart).filter((x) => x[0] >= B.raf.start);
    const w = {}; for (const [k, v] of Object.entries(B.workers)) { const o = B.workers0[k] ?? { created: 0, out: 0, in: 0 }; w[k] = { created: v.created - o.created, out: v.out - o.out, in: v.in - o.in }; }
    const f = window.__flight; const p = f?.pipeline; const info = p?.renderer.info ?? window.__editor?.view?.renderer?.info;
    const s = window.__perf?.enabled && f ? window.__perf.summary() : null;
    return {
      dur, frames: B.raf.t.slice(1), commits: B.commits - B.commits0, fibers: B.fibers - B.fibers0, workers: w,
      longTasks: lt.length, longTaskMs: lt.reduce((a, x) => a + x[1], 0), longTaskMax: lt.reduce((a, x) => Math.max(a, x[1]), 0),
      prof: s && { cpuAvg: s.cpuMs.avg, cpuP95: s.cpuMs.p95, sections: s.sections },
      gl: p ? { calls: p.stats.calls, tris: p.stats.triangles, programs: info.programs?.length ?? 0, geometries: info.memory.geometries, textures: info.memory.textures, canvas: `${p.renderer.domElement.width}x${p.renderer.domElement.height}`, scale: p.effectiveRenderScale, gpuMs: p.gpuMs, gpuName: p.gpuName, glError: p.renderer.getContext().getError() } : null,
      journey: f && window.__journeyStart ? { elapsedSim: f.world.ut - window.__journeyStart, assist: f.assist?.status ?? null, body: f.world.active?.body, orbit: f.world.active ? f.world.orbitSummary(f.world.active) : null } : undefined,
      heapLimitMB: performance.memory ? performance.memory.jsHeapSizeLimit / 1e6 : null,
    };
  });
  const fr = inPage.frames; const n = fr.length || 1; const secs = inPage.dur / 1000;
  const avg = fr.reduce((a, b) => a + b, 0) / n;
  const d = (k) => m1[k] - m0[k];
  const out = {
    fps: fr.length ? r2(1000 / avg) : null, frames: fr.length, frameP50: r2(pct(fr, 0.5)), frameP95: r2(pct(fr, 0.95)), frameP99: r2(pct(fr, 0.99)), frameMax: r2(Math.max(0, ...fr)),
    hitches25: fr.filter((x) => x > 25).length, hitches50: fr.filter((x) => x > 50).length,
    cpuMs: inPage.prof ? r2(inPage.prof.cpuAvg) : null, cpuP95: inPage.prof ? r2(inPage.prof.cpuP95) : null,
    sections: inPage.prof ? Object.fromEntries(Object.entries(inPage.prof.sections).map(([k, v]) => [k, r2(v)])) : null,
    scriptMsPerFrame: r2((d('ScriptDuration') * 1000) / n), taskMsPerFrame: r2((d('TaskDuration') * 1000) / n),
    layoutsPerSec: r2(d('LayoutCount') / secs), styleRecalcsPerSec: r2(d('RecalcStyleCount') / secs),
    layoutMsPerSec: r2((d('LayoutDuration') * 1000) / secs), styleMsPerSec: r2((d('RecalcStyleDuration') * 1000) / secs),
    sampleSeconds: r2(secs), longTasks: inPage.longTasks,
    longTasksPerMin: r2((inPage.longTasks / secs) * 60), longTaskMsPerMin: r2((inPage.longTaskMs / secs) * 60), longTaskMax: r2(inPage.longTaskMax),
    heapMB: r2(m1.JSHeapUsedSize / 1e6), heapGrowthMBPerMin: r2(((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1e6 / secs) * 60),
    domNodes: m1.Nodes, listeners: m1.JSEventListeners,
    reactCommitsPerSec: r2(inPage.commits / secs), reactRendersPerSec: r2(inPage.fibers / secs),
    journey: inPage.journey, workers: inPage.workers, gl: inPage.gl, trace: tr, ...extra,
  };
  results.cases[name] = { ...(results.cases[name] ?? {}), ...out };
  const sec = out.sections ? Object.entries(out.sections).filter(([, v]) => v >= 0.01).map(([k, v]) => `${k} ${v}`).join(' · ') : '';
  log(`== ${name}: ${out.fps} fps p50/p95/p99 ${out.frameP50}/${out.frameP95}/${out.frameP99} ms (max ${out.frameMax}, >25ms ${out.hitches25}) cpu ${out.cpuMs} (p95 ${out.cpuP95}) script/frame ${out.scriptMsPerFrame} task/frame ${out.taskMsPerFrame}`);
  log(`   ${sec}`);
  log(`   longtasks/min ${out.longTasksPerMin} (${out.longTaskMsPerMin} ms/min, max ${out.longTaskMax}) heap ${out.heapMB} MB (${out.heapGrowthMBPerMin} MB/min) nodes ${out.domNodes} listeners ${out.listeners} layouts/s ${out.layoutsPerSec} styles/s ${out.styleRecalcsPerSec} react ${out.reactCommitsPerSec} commits/s ${out.reactRendersPerSec} renders/s`);
  if (tr && !tr.error) log(`   trace: main work ${tr.mainWorkPct}% (+${tr.commitWaitPct}% commit wait) busy% ${JSON.stringify(tr.busyPct)} gc ${JSON.stringify(tr.gc)}`);
  if (inPage.gl) log(`   gl: ${JSON.stringify(inPage.gl)}`);
  if (Object.keys(inPage.workers).length) log(`   workers: ${JSON.stringify(inPage.workers)}`);
  return out;
}

async function flightCase(name, url, setup, settle = 3000, timing = true) {
  const { context, page, cdp } = await newPage();
  log(`starting ${name}`);
  try {
    const t0 = Date.now();
    await page.goto(`${base}${url}`);
    await flightReady(page);
    const readyMs = Date.now() - t0;
    if (args.nogpu === '1') await page.evaluate(() => {
      window.__flight.pipeline.render = () => {}; window.__flight.pipeline.renderMap = () => {};
      window.__flight.pipeline.renderer.render = () => {};
    });
    const marks = timing ? await page.evaluate(() => Object.fromEntries([...performance.getEntriesByType('measure'), ...performance.getEntriesByType('mark')].filter((e) => e.name.startsWith('wsp:')).map((e) => [e.name, Math.round(e.startTime + e.duration)]))) : {};
    if (setup) await setup(page);
    if (args.nightly === '1') await page.evaluate(() => { window.__flight.paused = true; });
    await page.waitForFunction(() => performance.getEntriesByName('wsp:flight:firstFrame').length > 0);

    await page.waitForTimeout(settle);
    await measure(page, cdp, name, seconds * 1000, { readyMs, marks, firstFrameMs: await page.evaluate(() => { const e = performance.getEntriesByName('wsp:flight:firstFrame')[0]; return e ? e.startTime + e.duration : null; }) });
  } catch (e) { log(`!! ${name} failed: ${e.message}`); results.cases[name] = { error: e.message }; } finally { await context.close(); }
}

// Time from first ready to the first 1 s window whose frames are all under 20 ms.
async function stableMs(page, limit = 20000) {
  return page.evaluate((limit) => new Promise((res) => {
    const t0 = performance.now(); let win = []; let last = t0;
    const tick = (n) => { win.push([n, n - last]); last = n; win = win.filter((x) => n - x[0] <= 1000);
      if (n - t0 > 1000 && win.every((x) => x[1] < 20)) return res(n - t0);
      if (n - t0 > limit) return res(-1); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), limit);
}

// ---------------------------------------------------------------------------------------------------------
if (cases.includes('load')) {
  for (const run of ['cold', 'warm']) {
    const { context, page } = await newPage();
    try {
      const reps = run === 'cold' ? 1 : 2; // warm = second visit in the same context (HTTP + IndexedDB caches)
      for (let i = 0; i < reps; i++) {
        const t0 = Date.now();
        await page.goto(base);
        await page.waitForSelector('.menu-actions button', { state: 'visible' });
        const menuMs = Date.now() - t0;
        const bytes = await page.evaluate(() => performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0));
        const t1 = Date.now();
        await page.goto(`${base}/?flight=stock-kestrel`);
        await page.waitForFunction(() => !!window.__flight, null, { timeout: 120000, polling: 50 });
        const ctorMs = Date.now() - t1;
        await flightReady(page);
        const readyMs = Date.now() - t1;
        const stable = await stableMs(page);
        const marks = await page.evaluate(() => Object.fromEntries([...performance.getEntriesByType('measure'), ...performance.getEntriesByType('mark')].filter((e) => e.name.startsWith('wsp:')).map((e) => [e.name, Math.round(e.startTime + e.duration)])));
        const lt = await page.evaluate(() => window.__bench.lt.map((x) => x[1]));
        if (i === reps - 1) {
          results.cases[`load:${run}`] = { menuMs, menuKB: r2(bytes / 1024), flightCtorMs: ctorMs, flightReadyMs: readyMs, stableAfterReadyMs: r2(stable), marks, loadLongTasks: lt.length, loadLongTaskMs: r2(lt.reduce((a, b) => a + b, 0)), loadLongTaskMax: r2(Math.max(0, ...lt)) };
          log(`== load:${run}: menu ${menuMs} ms (${(bytes / 1024).toFixed(0)} kB) flight controller ${ctorMs} ms ready ${readyMs} ms stable +${stable.toFixed(0)} ms; long tasks ${lt.length} (${lt.reduce((a, b) => a + b, 0).toFixed(0)} ms, max ${Math.max(0, ...lt).toFixed(0)}) ${JSON.stringify(marks)}`);
        }
      }
    } catch (e) { log(`!! load:${run} failed: ${e.message}`); } finally { await context.close(); }
  }
  void 0;
}

if (cases.includes('menu')) {
  const { context, page, cdp } = await newPage();
  try { await page.goto(base); await page.waitForSelector('.menu-actions button', { state: 'visible' }); await page.waitForTimeout(4000); await measure(page, cdp, 'menu'); }
  catch (e) { log(`!! menu failed: ${e.message}`); } finally { await context.close(); }
}
if (cases.includes('pad')) await flightCase('pad', '/?flight=stock-kestrel', undefined, settleMs);
if (cases.includes('ascent') && args.nightly === '1') {
  await flightCase('ascent', '/?flight=stock-meridian', async page => {
    await page.evaluate(() => {
      const f = window.__flight, w = f.world, v = w.active;
      const b = w.universe.ephem.getBodyState(v.body, w.ut);
      const p = v.state.position;
      const r = Math.hypot(p.x-b.position.x, p.y-b.position.y, p.z-b.position.z);
      const radius = w.universe.body(v.body).radius + 10000;
      for (const k of ['x','y','z']) p[k] = b.position[k] + (p[k]-b.position[k])/r*radius;
      v.mode = 'physics'; v.fixed = undefined; v.state.situation = 'flying';
      f.paused = true;
    });
  }, settleMs);
}
if (cases.includes('ascent') && args.nightly !== '1') {
  // Meridian off the pad at full throttle with physics warp 4×: measured through the dense lower atmosphere (max-Q).
  await flightCase('ascent', '/?flight=stock-meridian', async (page) => {
    await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__flight.world.warp = { mode: 'physics', index: 3 }; });
  }, 1500);
  // Keep the measurement inside the ascent: at 4× the dense atmosphere passes in roughly 10–20 s.
}
if (cases.includes('journey')) {
  await flightCase('journey', '/?flight=stock-meridian', async (page) => {
    await page.evaluate(() => {
      const f = window.__flight;
      f.startAssist('orbit');
      f.world.warp = { mode: 'physics', index: 3 };
      window.__journeyStart = f.world.ut;
      window.__game.set({ settings: { ...window.__game.get().settings, autoSaveInterval: 15 } });
      // Include actual map entry/exit while guidance, staging and autosave continue.
      setTimeout(() => f.toggleMap(), 15000);
      setTimeout(() => f.toggleMap(), 18000);
    });
  }, 0);
  // A bounded run is not automatically a successful orbit; retain its actual final state.
}
if (cases.includes('orbit')) await flightCase('orbit', '/?flight=stock-kestrel&scenario=orbit', undefined, settleMs);
if (cases.includes('warp1k')) await flightCase('warp1k', '/?flight=stock-kestrel&scenario=highorbit', async (page) => { await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 5 }; }); });
if (cases.includes('warp100k')) await flightCase('warp100k', '/?flight=stock-kestrel&scenario=highorbit', async (page) => { await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 7 }; }); });
if (cases.includes('map')) await flightCase('map', '/?flight=stock-kestrel&scenario=orbit', async (page) => { await page.evaluate(() => window.__flight.toggleMap()); });
if (cases.includes('moon') && args.nightly === '1') {
  await flightCase('moon', '/?flight=stock-selene&scenario=moon', async page => {
    await page.evaluate(() => {
      const f = window.__flight, w = f.world, v = w.active, u = w.universe;
      const q = u.ephem.bodyRotation('moon', w.ut);
      const up = { x: 1-2*(q.y*q.y+q.z*q.z), y: 2*(q.x*q.y+q.w*q.z), z: 2*(q.x*q.z-q.w*q.y) };
      const r = u.body('moon').radius + u.terrain('moon').heightAt(1,0,0) + w.bottomOffset(v.state) + 0.05;
      const b = u.ephem.getBodyState('moon', w.ut);
      for (const k of ['x','y','z']) v.state.position[k] = b.position[k] + up[k]*r;
      const h = Math.SQRT1_2;
      v.state.orientation = { x: h*(q.x-q.y), y: h*(q.y+q.x), z: h*(q.z-q.w), w: h*(q.w+q.z) };
      v.state.situation = 'landed'; f.paused = true;
    });
  }, settleMs);
}
if (cases.includes('moon') && args.nightly !== '1') await flightCase('moon', '/?mission=suicide-burn', async (page) => { await page.evaluate(() => { const f = window.__flight; f.input.state.throttle = 0.35; }); }, 2000);
if (cases.includes('saturn')) await flightCase('saturn', '/?mission=ring-skimmer');

if (cases.includes('editor')) {
  const { context, page, cdp } = await newPage();
  log(`starting editor`);
  try {
    const t0 = Date.now();
    await page.goto(`${base}/?scene=editor&stock=stock-ringrunner-real`);
    await page.waitForFunction(() => !!(window.__editor?.view && window.__editor.session), null, { timeout: 60000 });
    const readyMs = Date.now() - t0;
    const parts = await page.evaluate(() => window.__editor.session.craft?.parts?.length ?? window.__editor.session.parts?.length ?? null);
    await page.waitForTimeout(3000);
    await measure(page, cdp, 'editor:idle', 5000, { readyMs, parts });
    // Orbit the camera with the mouse (continuous re-render) for the measurement window.
    const box = { x: vw * 0.5, y: vh * 0.5 };
    const drag = (async () => { await page.mouse.move(box.x, box.y); await page.mouse.down({ button: 'right' }); for (let i = 0; i < seconds * 30; i++) { await page.mouse.move(box.x + 200 * Math.sin(i / 20), box.y + 60 * Math.cos(i / 25)); await page.waitForTimeout(33); } await page.mouse.up({ button: 'right' }); })();
    await measure(page, cdp, 'editor:orbit', seconds * 1000, { parts });
    await drag;
  } catch (e) { log(`!! editor failed: ${e.message}`); } finally { await context.close(); }
}
if (cases.includes('tracking')) {
  const { context, page, cdp } = await newPage();
  try { await page.goto(`${base}/?scene=tracking`); await page.waitForSelector('canvas', { timeout: 60000 }); await page.waitForTimeout(4000); await measure(page, cdp, 'tracking'); }
  catch (e) { log(`!! tracking failed: ${e.message}`); } finally { await context.close(); }
}

// 3-minute flight: orbit at 1000× with the map toggled every 15 s; heap after forced GC, DOM, GPU objects.
if (cases.includes('soak')) {
  const { context, page, cdp } = await newPage();
  try {
    await page.goto(`${base}/?flight=stock-kestrel&scenario=highorbit`); await flightReady(page); await page.waitForTimeout(3000);
    await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 5 }; });
    const total = +(args.soak ?? 180); const samples = [];
    const sample = async (t) => {
      await cdp.send('HeapProfiler.collectGarbage');
      const m = await metrics(cdp);
      const gl = await page.evaluate(() => { const i = window.__flight.pipeline.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 }; });
      samples.push({ t, heapMB: r2(m.JSHeapUsedSize / 1e6), nodes: m.Nodes, listeners: m.JSEventListeners, ...gl });
    };
    await sample(0);
    for (let t = 15; t <= total; t += 15) {
      await page.evaluate(() => window.__flight.toggleMap());
      await page.waitForTimeout(15000);
      if (t % 30 === 0) await sample(t);
    }
    const n = samples.length; const xs = samples.map((s) => s.t / 60); const ys = samples.map((s) => s.heapMB);
    const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0));
    results.cases.soak = { samples, heapSlopeMBPerMin: r2(slope) };
    log(`== soak ${total}s: heap slope ${slope.toFixed(2)} MB/min; ${samples.map((s) => `${s.t}s ${s.heapMB}MB n${s.nodes} l${s.listeners} g${s.geometries} t${s.textures}`).join(' | ')}`);
  } catch (e) { log(`!! soak failed: ${e.message}`); } finally { await context.close(); }
}

// Scene-cycle leak test: menu → flight → map → editor → flight → menu, ×N. Heap after forced GC in the menu.
if (cases.includes('cycles')) {
  const { context, page, cdp } = await newPage();
  try {
    await page.goto(`${base}/?flight=stock-kestrel`); await flightReady(page); await page.waitForTimeout(1500);
    const setScene = (s, extra = {}) => page.evaluate(([s, e]) => window.__game.set({ scene: s, ...e }), [s, extra]);
    const samples = []; const N = +(args.cycles ?? 10);
    const sample = async (i, canvases) => {
      await page.waitForTimeout(1000);
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const m = await metrics(cdp);
      samples.push({ cycle: i, heapMB: r2(m.JSHeapUsedSize / 1e6), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, canvases });
    };
    await setScene('menu'); await sample(0, null);
    for (let i = 1; i <= N; i++) await sample(i, await page.evaluate(() => window.__benchCycle()));
    const first = samples[1] ?? samples[0]; const last = samples[samples.length - 1];
    results.cases.cycles = { samples, heapPerCycleMB: r2((last.heapMB - first.heapMB) / Math.max(1, samples.length - 2)), nodesPerCycle: r2((last.nodes - first.nodes) / Math.max(1, samples.length - 2)), listenersPerCycle: r2((last.listeners - first.listeners) / Math.max(1, samples.length - 2)) };
    log(`== cycles: ${samples.map((s) => `#${s.cycle} ${s.heapMB}MB n${s.nodes} l${s.listeners} c${s.canvases}`).join(' | ')}`);
    log(`   per cycle: heap ${results.cases.cycles.heapPerCycleMB} MB, nodes ${results.cases.cycles.nodesPerCycle}, listeners ${results.cases.cycles.listenersPerCycle}`);
  } catch (e) { log(`!! cycles failed: ${e.message}`); } finally { await context.close(); }
}

await browser.close().catch(() => {});

// ---------------------------------------------------------------------------------------------------------
mkdirSync(outDir, { recursive: true });
const file = `${outDir}/${label}-dpr${dpr}${throttle > 1 ? `-cpu${throttle}x` : ''}`;
writeFileSync(`${file}.json`, JSON.stringify(results, null, 1));
const rows = Object.entries(results.cases).filter(([, c]) => c.fps !== undefined);
const secCols = ['sim', 'vessels', 'planets', 'map', 'render', 'telemetry', 'hud', 'navball'];
let md = `### ${label} — DPR ${dpr}${throttle > 1 ? `, CPU ${throttle}× throttled` : ''}, ${quality}, ${results.size} CSS px, ${results.date}\n\n`;
md += `| Scenario | fps | p50 / p99 ms | >25 ms | CPU ms (p95) | ${secCols.join(' | ')} | script ms/f | long tasks/min (ms/min) | main work % | GC ms/s (max) | heap MB (MB/min) | DOM nodes | React commits/s (renders/s) | style+layout /s | worker busy % |\n`;
md += `|---|---:|---:|---:|---:|${secCols.map(() => '---:').join('|')}|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
for (const [k, c] of rows) {
  const s = c.sections ?? {};
  const t = c.trace && !c.trace.error ? c.trace : null;
  md += `| ${k} | ${c.fps} | ${c.frameP50} / ${c.frameP99} | ${c.hitches25} | ${c.cpuMs ?? '–'} (${c.cpuP95 ?? '–'}) | ${secCols.map((x) => s[x] ?? '–').join(' | ')} | ${c.scriptMsPerFrame} | ${c.longTasksPerMin} (${c.longTaskMsPerMin}) | ${t?.mainWorkPct ?? '–'} | ${t ? `${t.gc.msPerSec} (${t.gc.maxPauseMs})` : '–'} | ${c.heapMB} (${c.heapGrowthMBPerMin}) | ${c.domNodes} | ${c.reactCommitsPerSec} (${c.reactRendersPerSec}) | ${r2(c.styleRecalcsPerSec + c.layoutsPerSec)} | ${t?.busyPct?.workers ?? 0} |\n`;
}
for (const k of ['load:cold', 'load:warm']) {
  const c = results.cases[k]; if (!c) continue;
  md += `\n${k}: menu interactive ${c.menuMs} ms (${c.menuKB} kB), flight controller ${c.flightCtorMs} ms, ready ${c.flightReadyMs} ms, stable fps +${c.stableAfterReadyMs} ms, ${c.loadLongTasks} long tasks (${c.loadLongTaskMs} ms total, max ${c.loadLongTaskMax} ms).`;
}
if (results.cases.soak) md += `\n\nSoak: heap slope ${results.cases.soak.heapSlopeMBPerMin} MB/min; ${results.cases.soak.samples.map((s) => `${s.t}s ${s.heapMB} MB/${s.nodes} nodes/${s.geometries} geo/${s.textures} tex`).join(', ')}.`;
if (results.cases.cycles) md += `\n\nCycles: per cycle heap ${results.cases.cycles.heapPerCycleMB} MB, DOM nodes ${results.cases.cycles.nodesPerCycle}, listeners ${results.cases.cycles.listenersPerCycle}; ${results.cases.cycles.samples.map((s) => `#${s.cycle} ${s.heapMB} MB`).join(', ')}.`;
writeFileSync(`${file}.md`, md + '\n');
log(`\nwrote ${file}.json / .md`);
