// Round-2 CPU diagnostic (copy to C:\wsp-tools\drv and run with the Windows node under flock /tmp/wsp-gpu.lock).
// Diagnostic: count draws per scene subtree / material for one frame at pad, ascent and orbit.
import { chromium } from 'playwright-core';
const [url, stock = 'stock-meridian'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const page = await context.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { polling: 200, timeout });
await page.goto(url);
await until(() => !!document.querySelector('.menu-actions button'));
await page.evaluate(() => window.__game.set({ scene: 'spaceCenter' }));
await page.waitForTimeout(4000);
await page.evaluate(() => window.__game.set({ scene: 'editor' }));
await until(() => !!window.__editor?.view);
await page.evaluate(s => window.__editor.loadStock(s), stock);
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Launch', exact: true }).click();
await until(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'));
await page.waitForTimeout(8000);
const probe = () => page.evaluate(() => new Promise(resolve => {
  const r = window.__flight.pipeline.renderer;
  const orig = r.renderBufferDirect;
  const byRoot = {}, byKind = {};
  let rt = 'canvas';
  const origSet = r.setRenderTarget;
  r.setRenderTarget = function (t, ...a) { rt = t ? (t.texture?.name || `${t.width}x${t.height}`) : 'canvas'; return origSet.call(this, t, ...a); };
  r.renderBufferDirect = function (camera, scene, geometry, material, object) {
    let o = object;
    while (o && o.parent && o.parent.type !== 'Scene') { o = o.parent; }
    const pass = camera.isOrthographicCamera ? 'ortho' : rt;
    let root = (o?.name || o?.type || '?') + (o?.userData?.kind ? ':' + o.userData.kind : '');
    if (root === 'Group' && pass !== 'ortho') {
      const chain = []; let q = object; while (q && q.parent && q.parent.type !== 'Scene') { chain.push(q); q = q.parent; }
      // chain: [mesh, ..., inner, root]; part object is chain[chain.length-3]
      const part = chain[chain.length - 3];
      const pid = window.__flight.world.active.state.parts.find(p => window.__flight.views?.get(window.__flight.world.active.state.id)?.parts?.get(p.uid)?.object === part)?.partId;
      root += ' / ' + (pid ?? (part?.name || part?.type)) + ' / ' + (object.isInstancedMesh ? 'inst' : object.name || '-');
    }
    if (root.startsWith('planet:earth') || root==='launchSite') root += ' / ' + (/^\d+\/(\d+)\//.test(object.name) ? 'tile-L' + object.name.split('/')[1] : (object.name || object.type)) + ' / ' + (material.name || material.type) + ' / ' + (object.parent?.name || object.parent?.type);
    const k = `${pass} | ${root}`;
    byRoot[k] = (byRoot[k] ?? 0) + 1;
    const mk = `${material.type}${material.name ? ':' + material.name : ''}`;
    byKind[mk] = (byKind[mk] ?? 0) + 1;
    return orig.apply(this, arguments);
  };
  requestAnimationFrame(() => {
    r.renderBufferDirect = orig; r.setRenderTarget = origSet;
    const sort = m => Object.entries(m).sort((a, b) => b[1] - a[1]);
    let meshes = 0, objs = 0, shadowCasters = 0;
    window.__flight.scene.traverse(o => { objs++; if (o.isMesh) { meshes++; if (o.castShadow && o.visible) shadowCasters++; } });
    resolve({ shadow: JSON.stringify(window.__flight.shadowCache?.stats), draws: window.__flight.pipeline.stats.calls, objs, meshes, shadowCasters, byRoot: sort(byRoot), byKind: sort(byKind).slice(0, 25) });
  });
}));
const show = (name, d) => { console.log('=====', name, 'shadow', d.shadow, 'draws', d.draws, 'objects', d.objs, 'meshes', d.meshes, 'shadowCasters', d.shadowCasters); for (const [k, v] of d.byRoot) console.log(String(v).padStart(5), k); console.log('-- by material'); for (const [k, v] of d.byKind) console.log(String(v).padStart(5), k); };
show('pad', await probe());
await page.evaluate(() => window.__flight.startAssist('orbit'));
await page.waitForTimeout(12000);
show('ascent', await probe());
await page.evaluate(() => { window.__flight.cancelAssist?.(); window.__flight.devScenario('orbit'); });
await page.waitForTimeout(6000);
show('orbit', await probe());
await context.close(); await browser.close();
