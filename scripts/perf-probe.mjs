// Headless performance probe (Chromium + SwiftShader). GPU time is NOT representative; use it for
// main-thread CPU breakdown, allocation rate, draw calls/programs, and load timing comparisons.
//
//   npm run build && npx vite preview --port 5201 --strictPort &
//   node scripts/perf-probe.mjs [--base http://localhost:5201] [--quality medium] [--seconds 8]
//        [--cases startup,pad,orbit,map,saturn] [--cpu] [--heap] [--json out.json] [--size 1280x720]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base ?? 'http://localhost:5201';
const quality = args.quality ?? 'medium';
const seconds = +(args.seconds ?? 8);
const cases = (args.cases ?? 'startup,pad,orbit,map,saturn').split(',');
const [vw, vh] = (args.size ?? '1280x720').split('x').map(Number);
const craft = args.craft ?? 'stock-kestrel';
const PRESETS = {
  low: { shadows: false, bloom: false, clouds: false, renderScale: 0.5 },
  medium: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  high: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
};
const settings = { quality, ...PRESETS[quality], scatter: true, adaptiveQuality: false, graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0, ...(args.settings ? JSON.parse(args.settings) : {}) };

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(args.unthrottled ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const results = { quality, seconds, size: `${vw}x${vh}`, craft, cases: {} };

async function newPage() {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, serviceWorkers: 'block' });
  await context.addInitScript((s) => {
    localStorage.setItem('wsp.settings.v1', JSON.stringify(s));
    localStorage.setItem('wsp.help.seen.v1', '1');
  }, settings);
  if (args.shaders) await context.addInitScript(() => {
    // Record the main-thread time of the first blocking query on each linked program (compile+link wait).
    const P = WebGL2RenderingContext.prototype; const info = new Map(); const shaderSrc = new WeakMap(); window.__shaderLog = [];
    const ss = P.shaderSource; P.shaderSource = function (sh, src) { shaderSrc.set(sh, src); return ss.call(this, sh, src); };
    const at = P.attachShader; P.attachShader = function (pr, sh) { const i = info.get(pr) ?? { src: [] }; i.src.push(shaderSrc.get(sh) ?? ''); info.set(pr, i); return at.call(this, pr, sh); };
    const lk = P.linkProgram; P.linkProgram = function (pr) { const i = info.get(pr); if (i) i.linkAt = performance.now(); return lk.call(this, pr); };
    const first = (method) => { const o = P[method]; P[method] = function (pr, ...rest) {
      const i = info.get(pr); const t = performance.now(); const r = o.call(this, pr, ...rest);
      if (i && !i.done && !(method === 'getProgramParameter' && rest[0] === 0x91B1 /* COMPLETION_STATUS_KHR */)) { i.done = true; const fs = i.src.find((x) => /gl_FragColor|pc_fragColor|out highp vec4/.test(x)) ?? i.src[1] ?? '';
        const name = (fs.match(/#define SHADER_NAME (.*)/) ?? [])[1] ?? ''; const uni = [...fs.matchAll(/uniform\s+\w+\s+(u\w+)/g)].slice(0, 4).map((m) => m[1]).join(',');
        window.__shaderLog.push({ ms: +(performance.now() - t).toFixed(1), sinceLink: +(performance.now() - i.linkAt).toFixed(0), at: +t.toFixed(0), name, uni, fsLen: fs.length, via: method }); }
      return r; }; };
    for (const m of ['getProgramInfoLog', 'getProgramParameter', 'getUniformLocation', 'getActiveUniform', 'getAttribLocation']) first(m);
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

async function waitReady(page, timeout = 120000) {
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout, polling: 100 });
}

// GPU-work proxy: gl.finish() around composer passes, the shadow pass and every draw. Under SwiftShader
// this measures emulated GPU work (fill/ALU/vertex), so read it as relative shares, not laptop ms.
async function gpuBreakdown(page, ms) {
  return page.evaluate(async (ms) => {
    const f = window.__flight; const r = f.pipeline.renderer; const gl = r.getContext();
    const acc = {}; const calls = {}; let frames = 0;
    const add = (k, v) => { acc[k] = (acc[k] ?? 0) + v; calls[k] = (calls[k] ?? 0) + 1; };
    const restore = [];
    const wrap = (obj, key, name) => { const o = obj[key]; obj[key] = function (...a) { gl.finish(); const t = performance.now(); const res = o.apply(this, a); gl.finish(); add(name, performance.now() - t); return res; }; restore.push(() => { obj[key] = o; }); };
    f.pipeline.composer.passes.forEach((p, i) => wrap(p, 'render', `pass:${i}:${p.constructor.name}`));
    wrap(r.shadowMap, 'render', 'pass:shadowMap');
    const origRender = f.pipeline.composer.render.bind(f.pipeline.composer);
    f.pipeline.composer.render = (...a) => { frames++; return origRender(...a); };
    restore.push(() => { delete f.pipeline.composer.render; });
    // Attribute draws to "<scene child>/<sub-group>" and only gl.finish() when that label changes.
    const label = (o) => {
      const chain = []; for (let n = o; n && n !== f.scene; n = n.parent) chain.unshift(n);
      const top = chain[0]; const sub = chain[1];
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const nm = (n) => n?.name || (n?.isGroup ? 'group' : n?.type);
      return `obj:${nm(top)}/${chain.length > 2 ? nm(sub) : (o.name || m?.name || m?.type)}`;
    };
    let cur = null; let curT = 0;
    const flushLabel = () => { if (cur) { gl.finish(); add(cur, performance.now() - curT); cur = null; } };
    const hooked = new WeakSet();
    const hook = () => f.scene.traverse((o) => {
      if (hooked.has(o) || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; hooked.add(o);
      const b = o.onBeforeRender; const name = label(o);
      o.onBeforeRender = function (...a) { if (cur !== name) { flushLabel(); gl.finish(); cur = name; curT = performance.now(); } return b.apply(this, a); };
      restore.push(() => { o.onBeforeRender = b; });
    });
    for (const p of f.pipeline.composer.passes) { const o = p.render; p.render = function (...a) { const res = o.apply(this, a); flushLabel(); return res; }; restore.push(() => { p.render = o; }); }
    { const o = r.shadowMap.render; r.shadowMap.render = function (...a) { flushLabel(); const res = o.apply(this, a); cur = cur ? cur : null; flushLabel(); return res; }; restore.push(() => { r.shadowMap.render = o; }); }
    hook(); const iv = setInterval(hook, 250);
    // Texture uploads and shader compiles.
    const counters = { texUploads: 0, texBytes: 0, compiles: 0, links: 0 };
    for (const k of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) { const o = gl[k]; gl[k] = function (...a) { counters.texUploads++; const d = a.find((x) => x && x.byteLength); if (d) counters.texBytes += d.byteLength; return o.apply(this, a); }; restore.push(() => { gl[k] = o; }); }
    for (const [k, c] of [['compileShader', 'compiles'], ['linkProgram', 'links']]) { const o = gl[k]; gl[k] = function (...a) { counters[c]++; return o.apply(this, a); }; restore.push(() => { gl[k] = o; }); }
    await new Promise((res) => setTimeout(res, ms));
    clearInterval(iv); restore.reverse().forEach((fn) => fn());
    const total = Object.entries(acc).filter(([k]) => k.startsWith('pass:') && k !== 'pass:shadowMap').reduce((a, [, v]) => a + v, 0);
    const rows = Object.entries(acc).map(([k, v]) => [k, +(v / Math.max(1, frames)).toFixed(2), +(100 * v / Math.max(1e-9, total)).toFixed(1), Math.round(calls[k] / Math.max(1, frames))]).sort((a, b) => b[1] - a[1]);
    return { frames, rows, counters: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, +(v / Math.max(1, frames)).toFixed(2)])) };
  }, ms);
}

async function measure(page, cdp, label) {
  if (args.gpu) {
    await gpuBreakdown(page, 3000); // warm SwiftShader JIT for every draw state first
    const g = await gpuBreakdown(page, seconds * 1000);
    results.cases[label + ':gpu'] = g;
    console.log(`\n== ${label} GPU-work proxy (${g.frames} frames; ms/frame, % of composer passes, draws/frame) uploads/frame ${JSON.stringify(g.counters)}`);
    for (const [k, ms, pct, n] of g.rows.slice(0, 30)) console.log(`   ${String(ms).padStart(8)}  ${String(pct).padStart(5)}%  ${String(n).padStart(4)}  ${k}`);
    return;
  }
  // --nogpu: skip GPU submission so the remaining main-thread work runs at its natural rate.
  if (args.nogpu) await page.evaluate(() => { const p = window.__flight.pipeline; p.composer.render = () => {}; p.renderMap = () => {}; });
  await page.evaluate(() => {
    window.__perf.enabled = true; window.__perf.reset();
    // Independent rAF counter (older builds' profilers only retain the last 240 frames).
    const c = (window.__rafCount = { n: 0, on: true }); const tick = () => { if (!c.on) return; c.n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  if (args.cpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  if (args.heap) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.waitForTimeout(seconds * 1000);
  const out = await page.evaluate(() => {
    const f = window.__flight; const p = f.pipeline;
    const s = window.__perf.summary();
    const info = p.renderer.info;
    return { summary: s, stats: { ...p.stats, programs: info.programs?.length ?? 0 }, scale: p.effectiveRenderScale,
      canvas: [p.renderer.domElement.width, p.renderer.domElement.height], frames: (window.__rafCount.on = false, window.__rafCount.n) };
  });
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const frames = out.frames || 1;
  out.metrics = {
    scriptMsPerFrame: ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames,
    taskMsPerFrame: ((m1.TaskDuration - m0.TaskDuration) * 1000) / frames,
    layoutMsPerFrame: ((m1.LayoutDuration - m0.LayoutDuration) * 1000) / frames,
    styleMsPerFrame: ((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / frames,
    heapMB: m1.JSHeapUsedSize / 1e6,
  };
  if (args.cpu) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = new Map();
    for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
    for (const n of profile.nodes) {
      const t = dt.get(n.id) ?? 0;
      const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + t);
    }
    out.cpuTop = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => [k, +(us / 1000 / frames).toFixed(3)]);
  }
  if (args.heap) {
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const by = new Map(); let total = 0;
    const walk = (n) => { const s = n.selfSize; total += s; const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`; by.set(key, (by.get(key) ?? 0) + s); n.children.forEach(walk); };
    walk(profile.head);
    out.alloc = { kbPerFrame: total / 1024 / frames, top: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, b]) => [k, +(b / 1024 / frames).toFixed(2)]) };
  }
  results.cases[label] = out;
  const s = out.summary;
  const sec = Object.entries(s.sections).filter(([, v]) => v > 0.005).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
  console.log(`\n== ${label} (${quality}) frames=${out.frames} fps=${s.fps.toFixed(1)} frame p50/p95/p99 ${s.frameMs.p50.toFixed(1)}/${s.frameMs.p95.toFixed(1)}/${s.frameMs.p99.toFixed(1)} ms`);
  console.log(`   cpu avg ${s.cpuMs.avg.toFixed(2)} ms p95 ${s.cpuMs.p95.toFixed(2)} max ${s.cpuMs.max.toFixed(1)} | script/frame ${out.metrics.scriptMsPerFrame.toFixed(2)} ms, task/frame ${out.metrics.taskMsPerFrame.toFixed(2)} ms, style ${out.metrics.styleMsPerFrame.toFixed(2)}, layout ${out.metrics.layoutMsPerFrame.toFixed(2)}, heap ${out.metrics.heapMB.toFixed(0)} MB`);
  console.log(`   sections: ${sec}`);
  console.log(`   gpu: ${out.stats.calls} calls, ${out.stats.triangles} tris, ${out.stats.points} pts, ${out.stats.programs} programs, ${out.stats.textures} tex, ${out.stats.geometries} geo; canvas ${out.canvas.join('x')} scale ${out.scale}`);
  if (out.cpuTop) console.log('   cpu top (ms/frame):\n' + out.cpuTop.map(([k, v]) => `     ${v}  ${k}`).join('\n'));
  if (out.alloc) console.log(`   alloc ${out.alloc.kbPerFrame.toFixed(1)} kB/frame; top (kB/frame):\n` + out.alloc.top.map(([k, v]) => `     ${v}  ${k}`).join('\n'));
}

async function flightCase(label, url, after) {
  const { context, page, cdp } = await newPage();
  const t0 = Date.now();
  if (args.loadcpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  await page.goto(`${base}${url}`);
  await waitReady(page);
  if (args.loadcpu) {
    const { profile } = await cdp.send('Profiler.stop');
    if (typeof args.loadcpu === 'string' && args.loadcpu !== 'true') writeFileSync(args.loadcpu, JSON.stringify(profile));
    const dt = new Map(); for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
    const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    // Inclusive time per function too (sum over each node's subtree, counting a function once per path).
    const incl = new Map(); const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    for (const n of profile.nodes) {
      const t = dt.get(n.id) ?? 0; if (!t) continue;
      const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + t);
      const seen = new Set(); for (let id = n.id; id !== undefined; id = parent.get(id)) { const c = byId.get(id).callFrame; const k = `${c.functionName || '(anon)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}`; if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t); }
    }
    const fmt = (m) => [...m.entries()].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, us]) => `     ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n');
    console.log(`[${label}] load self time:\n${fmt(self)}\n[${label}] load inclusive time:\n${fmt(incl)}`);
  }
  const readyMs = Date.now() - t0;
  const timeline = await page.evaluate(() => [...performance.getEntriesByType('measure'), ...performance.getEntriesByType('mark')].filter((e) => e.name.startsWith('wsp:')).map((e) => `${e.name}@${e.startTime.toFixed(0)}+${e.duration.toFixed(0)}`).join(' '));
  console.log(`\n[${label}] flight ready in ${readyMs} ms; ${timeline}`);
  if (args.shaders) {
    const log = await page.evaluate(() => window.__shaderLog);
    const total = log.reduce((a, l) => a + l.ms, 0);
    console.log(`[${label}] ${log.length} programs, ${total.toFixed(0)} ms blocked on first program query; slowest:`);
    for (const l of [...log].sort((a, b) => b.ms - a.ms).slice(0, 25)) console.log(`   ${String(l.ms).padStart(8)} ms @${l.at}  fs ${l.fsLen} ch  ${l.name}  [${l.uni}] via ${l.via}`);
  }
  if (after) await after(page);
  await page.waitForTimeout(2000);
  await measure(page, cdp, label);
  if (results.cases[label]) results.cases[label].readyMs = readyMs;
  await context.close();
}

if (cases.includes('startup')) {
  for (let run = 0; run < 2; run++) {
    const { context, page } = await newPage();
    const t0 = Date.now();
    await page.goto(base);
    await page.waitForSelector('.menu-actions button', { state: 'visible' });
    const menuMs = Date.now() - t0;
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
    const res = await page.evaluate(() => performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0));
    const t1 = Date.now();
    await page.goto(`${base}/?flight=${craft}`);
    await waitReady(page);
    const flightMs = Date.now() - t1;
    const lt = await page.evaluate(() => performance.getEntriesByType('resource').length);
    console.log(`startup run ${run}: menu interactive ${menuMs} ms (dcl ${nav.dcl.toFixed(0)}), menu bytes ${(res / 1024).toFixed(0)} kB; flight ready ${flightMs} ms (${lt} resources)`);
    results.cases[`startup${run}`] = { menuMs, flightMs, menuKB: res / 1024 };
    await context.close();
  }
}
if (cases.includes('pad')) await flightCase('pad', `/?flight=${craft}`);
if (cases.includes('orbit')) await flightCase('orbit', `/?flight=${craft}&scenario=orbit`);
if (cases.includes('map')) await flightCase('map', `/?flight=${craft}&scenario=orbit`, async (page) => { await page.keyboard.press('KeyM'); });
if (cases.includes('saturn')) await flightCase('saturn', '/?mission=ring-skimmer');
if (cases.includes('ascent')) await flightCase('ascent', `/?flight=${craft}`, async (page) => { await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space'); await page.waitForTimeout(3000); });

// Scripted session after loading: counts programs linked at runtime and the worst frame per step
// (first-use shader compiles show up as long frames). Use with --shaders for per-program detail.
if (cases.includes('session')) {
  const { context, page } = await newPage();
  await page.goto(`${base}/?flight=${craft}`);
  await waitReady(page);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const st = (window.__session = { links: 0, worst: 0, last: performance.now() });
    const P = WebGL2RenderingContext.prototype; const lk = P.linkProgram; P.linkProgram = function (...a) { st.links++; return lk.apply(this, a); };
    const loop = (t) => { st.worst = Math.max(st.worst, t - st.last); st.last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  });
  const step = async (name, fn, wait = 2500) => {
    await page.evaluate(() => { window.__session.worst = 0; window.__session.links0 = window.__session.links; });
    await fn(); await page.waitForTimeout(wait);
    const r = await page.evaluate(() => ({ worst: window.__session.worst, links: window.__session.links - window.__session.links0 }));
    console.log(`   session ${name.padEnd(18)} worst frame ${r.worst.toFixed(0).padStart(6)} ms, programs linked ${r.links}`);
    results.cases[`session:${name}`] = r;
  };
  console.log(`\n== session (${quality})`);
  await step('idle', async () => {});
  await step('ignite+liftoff', async () => { await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space'); }, 4000);
  await step('map open', async () => { await page.keyboard.press('KeyM'); });
  await step('map close', async () => { await page.keyboard.press('KeyM'); });
  await step('stage', async () => { await page.keyboard.press('Space'); }, 3000);
  await step('pause menu', async () => { await page.keyboard.press('Escape'); }, 1500);
  await step('resume', async () => { await page.keyboard.press('Escape'); }, 1500);
  await context.close();
}

if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 1));
await browser.close();
