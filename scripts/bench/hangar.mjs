// Windows Node, cwd C:/wsp-tools/drv; pass this file's WSL UNC path.
// node hangar.mjs before|after http://<WSL-IP>:5322 [paired]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from './partsart-cdp.mjs';
const [label = 'after', base = 'http://172.24.204.38:5322', mode] = process.argv.slice(2);
const out = new URL('../../docs/screenshots/hangar/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await connect();
const ctx = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', shadows: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const page = await ctx.newPage();
const results = {};
try {
  await page.goto(base);
  await page.evaluate(() => window.__game.set({ scene: 'editor' }));
  await page.waitForFunction(() => !!window.__editor?.view);
  for (const id of ['selene', 'meridian']) {
    await page.evaluate(id => window.__editor.loadStock(id), id);
    await page.waitForTimeout(3000);
    await page.evaluate(async () => { await (await import('/src/render/parts/textures.ts')).partTexturesReady(); });
    for (const zoom of ['wide', 'close']) {
      await page.evaluate(zoom => {
        const v = window.__editor.view;
        v.frameCraft(true);
        v.setView({ yaw: 0.55, pitch: 0.18, dist: v.dist * (zoom === 'close' ? 0.58 : 1.15), targetY: v.targetY + (zoom === 'close' ? 3 : 0) });
      }, zoom);
      await page.waitForTimeout(800);
      await page.screenshot({ path: fileURLToPath(new URL(`${label}-${id}-${zoom}.png`, out)) });
    }
  }
  if (mode === 'paired') {
    results.paired = await page.evaluate(async () => {
      const after = window.__editor.view;
      const { EditorView } = await import('/.tmp/hangar-baseline/src/editor/scene/EditorView.ts');
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0;pointer-events:none;visibility:hidden';
      after.container.appendChild(host);
      const before = new EditorView(host, window.__editor.session);
      await (await import('/.tmp/hangar-baseline/src/render/parts/textures.ts')).partTexturesReady();
      const views = { before, after };
      const result = {};
      for (const id of ['selene', 'meridian']) {
        window.__editor.loadStock(id);
        await (await import('/.tmp/hangar-baseline/src/render/parts/textures.ts')).partTexturesReady();
        await new Promise(r => setTimeout(r, 1000));
        for (const zoom of ['wide', 'close']) {
          for (const v of Object.values(views)) {
            v.frameCraft(true);
            v.setView({ yaw: 0.55, pitch: 0.18, dist: v.dist * (zoom === 'close' ? 0.58 : 1.15), targetY: v.targetY + (zoom === 'close' ? 3 : 0) });
            cancelAnimationFrame(v.raf); v.loop(); cancelAnimationFrame(v.raf);
          }
          const samples = { before: [], after: [] }, pairs = [], calls = {};
          let seed = 91817;
          for (let i = 0; i < 160; i++) {
            seed = (1664525 * seed + 1013904223) >>> 0;
            const pair = {};
            for (const name of seed & 0x10000 ? ['before', 'after'] : ['after', 'before']) {
              const v = views[name], gl = after.renderer.getContext();
              const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
              if (!ext) throw new Error('GPU timer unavailable');
              const q = gl.createQuery();
              gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
              after.renderer.render(v.scene, v.camera);
              calls[name] = after.renderer.info.render.calls;
              gl.endQuery(ext.TIME_ELAPSED_EXT);
              gl.flush();
              const deadline = performance.now() + 5000;
              while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
                if (performance.now() > deadline) throw new Error('GPU query timed out');
                await new Promise(r => setTimeout(r, 4));
              }
              if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('Disjoint GPU sample');
              pair[name] = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
              gl.deleteQuery(q);
            }
            if (i >= 40) { pairs.push(pair); for (const name of ['before', 'after']) samples[name].push(pair[name]); }
          }
          const median = a => a.sort((a,b) => a-b)[Math.floor(a.length / 2)];
          const gl = after.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
          result[`${id}-${zoom}`] = {
            gpu: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
            beforeMs: median(samples.before), afterMs: median(samples.after), pairedDeltaMs: median(pairs.map(p => p.after-p.before)),
            canvas: [after.renderer.domElement.width, after.renderer.domElement.height],
            calls, pairs,
          };
        }
      }
      before.dispose(); host.remove(); after.loop();
      return result;
    });
  }
  await page.evaluate(() => {
    const { session, view } = window.__editor;
    view.frameCraft(true);
    session.select([session.getSnapshot().craft.parts.find(p => p.partId.startsWith('tank')).uid]);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-selection.png`, out)) });
  await page.evaluate(() => { window.__editor.session.select([]); window.__editor.session.pickNew('tank-1-short'); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-nodes.png`, out)) });
  results.nodes = await page.evaluate(() => {
    const v = window.__editor.view;
    return v.nodeMarkers.map(m => ({ key: m.key, radius: m.mesh.scale.x, facing: m.mesh.quaternion.toArray() }));
  });
  results.scene = await page.evaluate(() => {
    const v = window.__editor.view, gl = v.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), calls: v.renderer.info.render.calls, programs: v.renderer.info.programs.length };
  });
  writeFileSync(new URL(`${label}-metrics.json`, out), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, (k,v) => k === 'pairs' ? undefined : v));
} finally { await ctx.close(); await browser.close(); }
