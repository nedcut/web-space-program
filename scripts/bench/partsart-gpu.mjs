// Fixed 30-part flight fixture. Windows Node; uses the same GPU query extension as F8.
import { writeFileSync } from 'node:fs';
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
  console.log('measure');
  const result = await page.evaluate(async () => {
    const f = window.__flight, p = f.pipeline, gl = p.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const total = [];
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); total.push(p.gpuMs); }
    const hot = [];
    const heatInterval = setInterval(() => {
      for (const part of f.world.active.state.parts) part.skinTemperature.fill(1100 + Math.floor(performance.now() % 100));
    }, 16);
    await new Promise(r => setTimeout(r, 1000));
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); hot.push(p.gpuMs); }
    clearInterval(heatInterval);
    for (const part of f.world.active.state.parts) part.skinTemperature.fill(290);
    await new Promise(r => setTimeout(r, 1000));
    let vertices = 0, triangles = 0, draws = 0, thermalAttributeBytes = 0;
    f.views.get(f.world.active.state.id).root.traverseVisible(o => {
      if (!o.isMesh) return;
      const count = o.isInstancedMesh ? o.count : 1;
      thermalAttributeBytes += o.geometry.getAttribute('wspHeatRadiance')?.array.byteLength ?? 0;
      vertices += o.geometry.getAttribute('position').count * count;
      triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3 * count;
      draws += Array.isArray(o.material) ? o.geometry.groups.length : 1;
    });
    // Non-nested pass queries, collected separately from the F8 full-frame sample.
    p.gpuTimer.begin = p.gpuTimer.end = () => {};
    const pending = [], samples = {}, original = [];
    for (const [i, pass] of p.composer.passes.entries()) {
      const name = `${i}-${pass.constructor.name}`;
      const render = pass.render; original.push([pass, render]);
      pass.render = function (...args) {
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        render.apply(this, args); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q, name });
      };
    }
    for (let i = 0; i < 180; i++) {
      await new Promise(r => setTimeout(r, 30));
      while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const { q, name } = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) (samples[name] ??= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    }
    for (const [pass, render] of original) pass.render = render;
    for (const { q } of pending) gl.deleteQuery(q);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL), parts: f.world.active.state.parts.length, canvas: [p.renderer.domElement.width, p.renderer.domElement.height], gpuMedianMs: median(total), changingHeatGpuMedianMs: median(hot), passMedianMs: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, median(v)])), vessel: { vertices, triangles, draws, thermalAttributeBytes }, fullFrame: p.stats };
  });
  console.log(JSON.stringify(result));
  writeFileSync(new URL(`../../docs/screenshots/partsart/${label}-gpu30.json`, import.meta.url), JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
