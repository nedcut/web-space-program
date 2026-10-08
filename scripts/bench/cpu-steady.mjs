// Steady-flight CPU A/B on Windows Chrome over CDP. Run through cpu-steady.sh (holds the shared GPU lock).
// Usage: cpu-steady.mjs label rate quality reps name=url [name=url ...]
// Builds are interleaved per repetition (A B C, A B C, ...). Each run: Space Center -> editor -> Meridian ->
// launch, waits for imagery, then measures pad, assisted ascent and a circular orbit at 1x physics for `secs`.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label, rate = '4', quality = 'medium', reps = '2', ...targets] = process.argv.slice(2);
if (!label || !targets.length) throw new Error('Usage: cpu-steady.mjs label rate quality reps name=url ...');
const secs = +(process.env.STEADY_SECS ?? 8);
const profile = process.env.STEADY_PROFILE === '1';
const outDir = 'C:/wsp-tools/bench';
mkdirSync(outDir, { recursive: true });
const builds = targets.map(t => { const i = t.indexOf('='); return { name: t.slice(0, i), url: t.slice(i + 1) }; });
const out = { label, rate: +rate, quality, secs, date: new Date().toISOString(), runs: [] };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 20000 });

async function run(build, rep) {
  const result = { build: build.name, url: build.url, rep, windows: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await context.addInitScript(quality => {
    localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality, graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
    localStorage.setItem('wsp.help.seen.v1', '1');
    window.__steady = { tasks: [], frames: [], last: 0, active: false };
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__steady.tasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    const tick = t => { const b = window.__steady; if (b.active && b.last) b.frames.push(t - b.last); b.last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, quality);
  const page = await context.newPage();
  page.on('pageerror', e => result.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const cdp = await context.newCDPSession(page);
  const wait = ms => page.waitForTimeout(ms);
  const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { polling: 200, timeout });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  async function measure(name) {
    if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    const m0 = await metrics();
    const start = await page.evaluate(() => {
      const b = window.__steady; b.active = true; b.frames = []; b.last = 0;
      window.__perf.enabled = true; window.__perf.reset();
      return performance.now();
    });
    await wait(secs * 1000);
    const sample = await page.evaluate(start => {
      const b = window.__steady; b.active = false;
      const f = window.__flight, p = window.__perf.summary();
      const frames = b.frames.slice().sort((a, c) => a - c);
      const pct = q => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? 0;
      let objects = 0, visible = 0;
      f.scene.traverse(() => { objects++; });
      f.scene.traverseVisible(() => { visible++; });
      const images = [];
      f.scene.traverse(o => { if (o.userData.imagery) images.push({ level: o.userData.imagery.levelId, ready: o.userData.imagery.ready, ...o.userData.imagery.stats }); });
      const tasks = b.tasks.filter(t => t[0] >= start).map(t => t[1]);
      return { ms: performance.now() - start, frames: frames.length, frameP50: pct(.5), frameP95: pct(.95), frameMax: pct(1),
        longTasks: tasks.length, longTaskMax: Math.max(0, ...tasks), cpu: p.cpuMs, sections: p.sections, profFrames: p.frames,
        draws: f.pipeline.stats.calls, triangles: f.pipeline.stats.triangles, objects, visible, images,
        state: f.world.active ? { body: f.world.active.body, alt: f.world.orbitSummary(f.world.active)?.orbit?.a, stage: f.world.active.state.nextStage, situation: f.world.active.state.situation } : null };
    }, start);
    const m1 = await metrics();
    sample.name = name;
    sample.scriptMsPerFrame = (m1.ScriptDuration - m0.ScriptDuration) * 1000 / sample.frames;
    sample.taskMsPerFrame = (m1.TaskDuration - m0.TaskDuration) * 1000 / sample.frames;
    if (profile) {
      const { profile: cpuProfile } = await cdp.send('Profiler.stop');
      const file = `${outDir}/${label}-${build.name}-r${rep}-${name}.cpuprofile`;
      writeFileSync(file, JSON.stringify(cpuProfile));
      sample.profile = file;
    }
    result.windows.push(sample);
    console.log(build.name, rep, name, `cpu ${sample.cpu.avg.toFixed(2)}/${sample.cpu.p95.toFixed(2)}`, `script/f ${sample.scriptMsPerFrame.toFixed(2)}`, `task/f ${sample.taskMsPerFrame.toFixed(2)}`, `frames ${sample.frames}`, `draws ${sample.draws}`, `lt ${sample.longTasks}/${sample.longTaskMax}`);
  }
  try {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
    await cdp.send('Performance.enable');
    await page.goto(build.url);
    await until(() => !!document.querySelector('.menu-actions button'));
    await page.evaluate(() => window.__game.set({ scene: 'spaceCenter' }));
    await wait(6000);
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await until(() => !!window.__editor?.view);
    await page.evaluate(() => window.__editor.loadStock('stock-meridian'));
    await wait(1000);
    await page.getByRole('button', { name: 'Launch', exact: true }).click();
    await until(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'));
    // Settle streaming so each build is measured with the same imagery resident.
    const imagery = () => until(() => {
      const list = []; window.__flight.scene.traverse(o => { if (o.userData.imagery) list.push(o.userData.imagery); });
      return list.length > 0 && list.every(p => p.ready);
    }, 90000).catch(() => result.errors.push('imagery not ready'));
    await imagery();
    await wait(3000);
    await measure('pad');
    await page.evaluate(() => window.__flight.startAssist('orbit'));
    await wait(8000);
    await measure('ascent');
    await page.evaluate(() => { window.__flight.cancelAssist?.(); window.__flight.devScenario('orbit'); });
    await wait(3000);
    await imagery();
    await wait(2000);
    await measure('orbit');
  } catch (e) { result.errors.push(String(e)); console.error(build.name, rep, e); }
  finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await context.close().catch(() => {});
  }
  out.runs.push(result);
  writeFileSync(`${outDir}/${label}.json`, JSON.stringify(out, null, 2));
}

for (let rep = 0; rep < +reps; rep++) {
  // Alternate order between repetitions so neither build always runs first.
  const order = rep % 2 ? [...builds].reverse() : builds;
  for (const b of order) await run(b, rep);
}
// Summary: mean per build/window.
const summary = {};
for (const r of out.runs) for (const w of r.windows) {
  const k = `${r.build}:${w.name}`; (summary[k] ??= []).push(w);
}
for (const [k, ws] of Object.entries(summary)) {
  const mean = f => ws.reduce((a, w) => a + f(w), 0) / ws.length;
  console.log('SUMMARY', k, `n=${ws.length}`, `cpu ${mean(w => w.cpu.avg).toFixed(2)} p95 ${mean(w => w.cpu.p95).toFixed(2)}`, `script/f ${mean(w => w.scriptMsPerFrame).toFixed(2)}`, `task/f ${mean(w => w.taskMsPerFrame).toFixed(2)}`, `fps ${(mean(w => w.frames) / secs).toFixed(1)}`, `draws ${mean(w => w.draws).toFixed(0)}`);
}
out.summary = summary;
writeFileSync(`${outDir}/${label}.json`, JSON.stringify(out, null, 2));
await browser.close();
