// Production CPU transition/flight capture on Windows Chrome. Run through cpu-pass2.sh.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { writeRendererTrace } from './trace-stream.mjs';
const [base, label, rate = '4', mode = 'transitions', quality = 'medium'] = process.argv.slice(2);
if (!base || !label) throw new Error('Usage: cpu-pass2.sh base label [rate=4] [transitions|flight|imagery|soi] [quality]');
const outDir = 'C:/wsp-tools/bench';
mkdirSync(outDir, { recursive: true });
const out = { base, label, rate: +rate, mode, quality, date: new Date().toISOString(), windows: [], errors: [] };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 20000 });
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(quality => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality, graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  window.__cpu2 = { tasks: [], frames: [], landmarks: [], lastState: '', last: 0, active: false };
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__cpu2.tasks.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: true });
  const tick = t => {
    const b = window.__cpu2;
    const v = window.__flight?.world.active;
    const state = v && `${v.body}:${v.state.nextStage}:${v.state.situation}`;
    if (state && state !== b.lastState) {
      b.lastState = state;
      b.landmarks.push({ time: performance.now(), state, ut: window.__flight.world.ut });
      performance.mark(`cpu2:state:${state}`);
    }
    if (b.active && b.last) b.frames.push(t - b.last);
    b.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, quality);
const page = await context.newPage();
page.on('pageerror', e => out.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' || /WebGL.*(ERROR|INVALID|lost)/i.test(m.text())) out.errors.push(m.text()); });
page.on('dialog', d => d.accept());
page.setDefaultTimeout(90000);
const cdp = await context.newCDPSession(page);
let tracing = false, pagePid;
const bounded = (promise, ms = 90000) => { let timeout; return Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Driver timeout after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timeout)); };
const wait = ms => page.waitForTimeout(ms);
const until = fn => page.waitForFunction(fn, null, { polling: 100, timeout: 90000 });
const flightReady = () => until(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'));
const painted = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
async function stopTrace(name) {
  const complete = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end'); tracing = false;
  const { stream } = await complete;
  if (pagePid !== undefined) {
    await writeRendererTrace(cdp, stream, pagePid, page.url(), `${outDir}/${label}-${name}.trace.json.gz`);
    return;
  }
  let text = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream, size: 1 << 22 });
    text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const events = JSON.parse(text).traceEvents;
  let pid;
  for (const e of events) for (const f of e.args?.data?.frames ?? []) if (f.url?.startsWith(base)) pid = f.processId ?? e.pid;
  if (pid === undefined) throw new Error('No renderer PID in trace');
  pagePid = pid;
  writeFileSync(`${outDir}/${label}-${name}.trace.json.gz`, gzipSync(JSON.stringify({ metadata: { pagePid: pid, pageUrl: page.url() }, traceEvents: events.filter(e => e.pid === pid) })));
}
async function captureWindow(name, action) {
  console.log('START', name);
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['toplevel', 'devtools.timeline', 'v8', 'blink.user_timing', 'disabled-by-default-devtools.timeline', 'disabled-by-default-v8.cpu_profiler'], excludedCategories: ['*'] } }); tracing = true;
  const m0 = await metrics();
  const start = await page.evaluate(name => {
    const b = window.__cpu2; b.active = true; b.frames = []; b.last = 0;
    if (window.__perf) { window.__perf.enabled = true; window.__perf.reset(); }
    performance.mark(`cpu2:${name}:start`);
    return performance.now();
  }, name);
  await action(); await painted();
  // Freeze observations before trace drain; transfer/readout must not extend the measurement window.
  const sample = await page.evaluate(({ start, name }) => {
    const b = window.__cpu2; b.active = false;
    performance.mark(`cpu2:${name}:end`);
    const f = window.__flight;
    const p = window.__perf?.summary();
    const frames = b.frames.sort((a, b) => a - b);
    const pct = q => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? 0;
    const tasks = b.tasks.filter(t => t[0] >= start);
    const images = [];
    f?.scene.traverse(o => { if (o.userData.imagery) images.push({ level: o.userData.imagery.levelId, ready: o.userData.imagery.ready, ...o.userData.imagery.stats }); });
    return { name, start, ms: performance.now() - start, frames: frames.length, frameP50: pct(.5), frameP95: pct(.95), frameP99: pct(.99), frameMax: pct(1), tasks, landmarks: b.landmarks.filter(e => e.time >= start),
      cpu: p?.cpuMs, cpuRetainedFrames: p?.frames, sections: p?.sections, images, programs: f?.pipeline.stats.programs, glError: f?.pipeline.renderer.getContext().getError(),
      state: f?.world.active ? { body: f.world.active.body, stage: f.world.active.state.nextStage, orbit: f.world.orbitSummary(f.world.active), assist: f.assist?.status, ut: f.world.ut } : null };
  }, { start, name });
  const m1 = await metrics();
  sample.scriptMsPerFrame = (m1.ScriptDuration - m0.ScriptDuration) * 1000 / sample.frames;
  sample.taskMsPerFrame = (m1.TaskDuration - m0.TaskDuration) * 1000 / sample.frames;
  out.windows.push(sample); writeFileSync(`${outDir}/${label}.json`, JSON.stringify(out, null, 2));
  console.log('DONE', JSON.stringify(sample));
  await stopTrace(name);
}
const capture = (name, action) => bounded(captureWindow(name, action), 120000);
async function moonCrossing() {
    // Seed a reproducible inbound state just outside the Moon SOI, then cross through World.tick normally.
    await page.evaluate(() => {
      const f = window.__flight, w = f.world, v = w.active, u = w.universe;
      const moon = u.body('moon'), m = u.ephem.getBodyState('moon', w.ut), e = u.ephem.getBodyState('earth', w.ut);
      const d = { x: e.position.x - m.position.x, y: e.position.y - m.position.y, z: e.position.z - m.position.z };
      const n = Math.hypot(d.x, d.y, d.z);
      const r = moon.soi + 20000;
      // A nonzero impact parameter avoids a degenerate radial hyperbola in the orbit predictor.
      const tangent = { x: -d.y, y: d.x, z: 0 }, tn = Math.hypot(d.x, d.y);
      v.mode = 'physics'; v.body = 'earth'; v.fixed = undefined; v.orbit = undefined;
      v.state.situation = 'flying';
      for (const k of ['x', 'y', 'z']) { v.state.position[k] = m.position[k] + d[k] / n * r; v.state.velocity[k] = m.velocity[k] - d[k] / n * 1500 + tangent[k] / tn * 250; }
      w.renderHistory.invalidate();
    });
    await wait(6000);
    await capture('moon-soi', () => wait(25000));
    if (!(await page.evaluate(() => window.__flight.world.active.body === 'moon'))) throw new Error('Moon SOI fixture did not cross');
}

try {
  console.log('THROTTLE', rate);
  await bounded(cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate }), 15000);
  await cdp.send('Performance.enable');
  console.log('NAVIGATE', base);
  await bounded(page.goto(base));
  await bounded(until(() => !!document.querySelector('.menu-actions button')));
  if (mode !== 'transitions') {
    await capture('hub-load', async () => {
      await page.evaluate(() => window.__game.set({ scene: 'spaceCenter' }));
      await wait(10000);
    });
  }
  if (mode === 'transitions') {
    for (const cache of ['cold', 'warm']) {
      if (cache === 'warm') { pagePid = undefined; await page.reload(); await until(() => !!document.querySelector('.menu-actions button')); }
      await capture(`${cache}-hub`, async () => { await page.evaluate(() => window.__game.set({ scene: 'spaceCenter' })); await wait(10000); });
      await capture(`${cache}-editor`, async () => { await page.evaluate(() => window.__game.set({ scene: 'editor' })); await until(() => !!window.__editor?.view); await wait(4000); });
      await page.evaluate(() => window.__editor.loadStock('stock-kestrel'));
      await capture(`${cache}-launch`, async () => { await page.getByRole('button', { name: 'Launch', exact: true }).click(); await flightReady(); });
      await capture(`${cache}-map-open`, async () => { await page.evaluate(() => window.__flight.toggleMap()); await wait(1500); });
      await capture(`${cache}-map-close`, async () => { await page.evaluate(() => window.__flight.toggleMap()); await wait(1500); });
      await capture(`${cache}-quicksave`, async () => { await page.evaluate(() => window.__flight.quicksave()); await wait(500); });
      await capture(`${cache}-quickload`, async () => {
        await page.evaluate(() => { window.__oldFlight = window.__flight; window.__flight.onQuickload(); });
        await until(() => window.__flight && window.__flight !== window.__oldFlight); await flightReady();
        await page.evaluate(() => { delete window.__oldFlight; });
      });
      await page.evaluate(() => window.__game.set({ scene: 'menu' })); await wait(1000);
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    out.graphicsLabels = await page.locator('.settings-dialog option').allTextContents();
  } else if (mode === 'soi') {
    await capture('soi-load', async () => {
      await page.evaluate(() => window.__game.set({ scene: 'editor' }));
      await until(() => !!window.__editor?.view);
      await page.evaluate(() => window.__editor.loadStock('stock-kestrel'));
      await page.getByRole('button', { name: 'Launch', exact: true }).click();
      await until(() => !!window.__flight);
      await page.evaluate(() => window.__flight.devScenario('highorbit'));
      await flightReady();
    });
    await moonCrossing();
  } else if (mode === 'imagery') {
    await capture('imagery-load', async () => {
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await until(() => !!window.__editor?.view);
    await page.evaluate(() => window.__editor.loadStock('stock-kestrel'));
    await page.getByRole('button', { name: 'Launch', exact: true }).click();
    await until(() => !!window.__flight);
    await page.evaluate(() => window.__flight.devScenario('orbit'));
    await flightReady();
    });
    await capture('imagery-stream', async () => {
      await until(() => {
        const imagery = [];
        window.__flight.scene.traverse(o => { if (o.userData.imagery) imagery.push(o.userData.imagery); });
        return imagery.length > 0 && imagery.every(p => p.ready && p.cloudSourceSettled);
      });
    });
    await wait(3000); // allow the cloud cube bake to finish after its upload source becomes ready
    await capture('imagery-settled', () => wait(8000));
    await page.screenshot({ path: `${outDir}/${label}.png` });
  } else {
    console.log('FLIGHT VIA EDITOR');
    await capture('flight-load', async () => {
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await until(() => !!window.__editor?.view);
    await page.evaluate(() => window.__editor.loadStock('stock-meridian'));
    await page.getByRole('button', { name: 'Launch', exact: true }).click();
    await flightReady();
    });
    await capture('pad', () => wait(6000));
    // One continuous trace: draining short windows can otherwise miss a separation between them.
    await bounded(captureWindow('ascent', async () => {
      await page.evaluate(() => {
        window.__flight.startAssist('orbit');
        // Same 4x physics-warp journey as cpu-flight.sh, independent of the CDP CPU throttle.
        window.__flight.world.warp = { mode: 'physics', index: 3 };
        window.__game.set({ settings: { ...window.__game.get().settings, autoSaveInterval: 15 } });
      });
      await page.waitForFunction(() => !window.__flight.assist, null, { polling: 250, timeout: 240000 });
    }), 270000);
    await page.evaluate(() => { window.__flight.world.warp = { mode: 'physics', index: 0 }; });
    await capture('orbit', () => wait(8000));
    await page.evaluate(() => window.__flight.devScenario('highorbit')); await wait(3000);
    await capture('warp-up', async () => { await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 7 }; }); await wait(6000); });
    await capture('warp-down', async () => { await page.evaluate(() => { window.__flight.world.warp = { mode: 'physics', index: 0 }; }); await wait(6000); });
    await moonCrossing();
  }
} catch (e) { out.errors.push(String(e)); console.error(e); process.exitCode = 1;
  out.failureState = await bounded(page.evaluate(() => ({ scene: window.__game?.get().scene, ready: window.__flight?.sceneReady, body: document.body.innerText.slice(-2500) })), 5000).catch(() => 'renderer unresponsive');
}
finally {
  if (tracing) await bounded(stopTrace('interrupted'), 15000).catch(e => out.errors.push(String(e)));
  writeFileSync(`${outDir}/${label}.json`, JSON.stringify(out, null, 2));
  await bounded(cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }), 10000).catch(() => {});
  await bounded(context.close(), 10000).catch(() => {});
  await browser.close();
}
