// Fixed 30-part flight fixture. Windows Node; uses the same GPU query extension as F8.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from './partsart-cdp.mjs';
const label = process.argv[2] ?? 'after';
const base = process.argv[3] ?? 'http://localhost:5333';
const browser = await connect();
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__partsArtSource = location.pathname.startsWith('/.tmp/partsart-baseline') ? '/.tmp/partsart-baseline/src' : '/src';
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const page = await context.newPage();
page.on('dialog', d => void d.dismiss().catch(() => {}));
page.on('pageerror', e => console.error(e.message));
try {
  await page.goto(base + '/');
  await page.bringToFront();
  console.log('launch');
  await page.evaluate(async () => {
    const { buildMoonLander } = await import(window.__partsArtSource + '/editor/stockCrafts.ts');
    const craft = buildMoonLander();
    const panel = craft.parts.find(p => p.partId.startsWith('solar-'));
    const uid = Math.max(...craft.parts.map(p => p.uid));
    for (let i = 0; i < 2; i++) craft.parts.push({ ...panel, uid: uid + i + 1, position: { ...panel.position, y: panel.position.y - 0.4 * (i + 1) }, symmetryGroup: undefined });
    window.__game.set({ craft, scene: 'flight', launchPending: true });
  });
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
  await page.evaluate(() => { window.__flight.paused = true; });
  await page.waitForTimeout(12000);
  console.log('paired measure');
  const result = await page.evaluate(async () => {
    const f = window.__flight, p = f.pipeline, gl = p.renderer.getContext();
    const { VesselView } = await import('/.tmp/partsart-baseline/src/render/vessel/VesselView.ts');
    const before = new VesselView(f.world.active.state);
    await (await import('/.tmp/partsart-baseline/src/render/parts/textures.ts')).partTexturesReady();
    const after = f.views.get(f.world.active.state.id);
    before.update(f.world.active.state.position, f.world.ut, 101325, 0);
    after.root.parent.add(before.root);
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    p.gpuTimer.begin = p.gpuTimer.end = () => {};
    const original = p.composer.render;
    const pending = [], samples = { before: [], after: [] };
    const draws = { before: [], after: [] }, resolves = { before: 0, after: 0 };
    let frameName = 'before', drawCount = 0;
    const renderDirect = p.renderer.renderBufferDirect;
    p.renderer.renderBufferDirect = function (...args) { drawCount++; return renderDirect.apply(this, args); };
    const materials = new Set();
    for (const root of [before.root, after.root]) root.traverse(o => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    const keys = new Map();
    for (const m of materials) {
      keys.set(m, m.customProgramCacheKey);
      m.customProgramCacheKey = function () { if (frames > 120) resolves[frameName]++; return keys.get(m).call(this); };
    }
    let frames = 0, seed = 91817, first = 'before';
    const pairs = new Map();
    p.composer.render = function (...args) {
      frames++;
      if (frames % 2 === 0) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        first = seed / 4294967296 < 0.5 ? 'before' : 'after';
      }
      const name = frames % 2 === 0 ? first : first === 'before' ? 'after' : 'before';
      before.root.position.copy(after.root.position); before.root.quaternion.copy(after.root.quaternion);
      frameName = name; drawCount = 0;
      before.root.visible = name === 'before'; after.root.visible = name === 'after';
      if (frames < 120) return original.apply(this, args);
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      original.apply(this, args); draws[name].push(drawCount); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q, name, pair: Math.floor((frames - 120) / 2) });
    };
    const start = performance.now();
    while (samples.before.length < 240 || samples.after.length < 240) {
      if (performance.now() - start > 90000) throw new Error('Paired GPU sampling timed out');
      await new Promise(r => setTimeout(r, 50));
      while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const { q, name, pair } = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          samples[name].push(ms);
          const values = pairs.get(pair) ?? {}; values[name] = ms; pairs.set(pair, values);
        }
        gl.deleteQuery(q);
      }
    }
    p.composer.render = original;
    p.renderer.renderBufferDirect = renderDirect;
    for (const [m, key] of keys) m.customProgramCacheKey = key;
    window.__partsArtBefore = before;
    after.root.visible = true; before.root.visible = false;
    for (const { q } of pending) gl.deleteQuery(q);
    const summary = {};
    for (const [name, values] of Object.entries(samples)) {
      values.sort((a, b) => a - b);
      summary[name] = { n: values.length, medianMs: values[Math.floor(values.length / 2)], p10Ms: values[Math.floor(values.length * 0.1)], p90Ms: values[Math.floor(values.length * 0.9)] };
    }
    const differences = [...pairs.values()].filter(v => v.before !== undefined && v.after !== undefined).map(v => v.after - v.before).sort((a, b) => a - b);
    return { pairDeltaMedianMs: differences[Math.floor(differences.length / 2)], pairedFrames: differences.length, framePairs: [...pairs.values()], fixture: 'Adjacent pairs, randomized order (seed 91817), original and updated 30-part VesselView (seed 91817), same environment/camera/full compositor, 120 warm-up frames', canvas: [p.renderer.domElement.width, p.renderer.domElement.height], draws: Object.fromEntries(Object.entries(draws).map(([k, v]) => [k, [...new Set(v)]])), resolves, ...summary, deltaMs: summary.after.medianMs - summary.before.medianMs };
  });
  writeFileSync(new URL(`../../docs/screenshots/partsart/${label}-paired-gpu30.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, framePairs: undefined }));
  await page.evaluate(() => { window.__partsArtBefore.root.visible = true; window.__flight.views.get(window.__flight.world.active.state.id).root.visible = false; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/partsart/${label}-paired-before.png`, import.meta.url)) });
  await page.evaluate(() => { window.__partsArtBefore.root.visible = false; window.__flight.views.get(window.__flight.world.active.state.id).root.visible = true; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/partsart/${label}-paired-after.png`, import.meta.url)) });
  writeFileSync(new URL(`../../docs/screenshots/partsart/${label}-paired-gpu30.json`, import.meta.url), JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
