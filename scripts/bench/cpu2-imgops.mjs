// Round-2 CPU diagnostic (copy to C:\wsp-tools\drv and run with the Windows node under flock /tmp/wsp-gpu.lock).
// Time each imagery GPU operation (High, CDP throttle) to locate streaming stalls.
import { chromium } from 'playwright-core';
const [url, rate = '4', quality = 'high'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(q => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: q, graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  window.__ops = [];
  window.__lt = [];
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
}, quality);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
const until = (fn, timeout = 240000) => page.waitForFunction(fn, null, { polling: 250, timeout });
const t0 = Date.now();
await page.goto(url);
await until(() => !!document.querySelector('.menu-actions button'));
await page.evaluate(() => window.__game.set({ scene: 'spaceCenter' }));
await page.waitForTimeout(10000);
await page.evaluate(() => window.__game.set({ scene: 'editor' }));
await until(() => !!window.__editor?.view);
await page.evaluate(() => window.__editor.loadStock('stock-kestrel'));
await page.getByRole('button', { name: 'Launch', exact: true }).click();
await until(() => !!window.__flight?.pipeline);
// Instrument the renderer used by imagery steps as early as possible.
await page.evaluate(() => {
  const r = window.__flight.pipeline.renderer;
  const wrap = (name, label) => { const f = r[name].bind(r); r[name] = (...a) => { const s = performance.now(); const out = f(...a); const d = performance.now() - s; if (d > 2 || /earth/.test(label(...a))) window.__ops.push({ op: label(...a), ms: +d.toFixed(2), at: +s.toFixed(0) }); return out; }; };
  wrap('initTexture', t => `init ${t.name} ${t.image?.width}x${t.image?.height} mips=${t.generateMipmaps}`);
  wrap('copyTextureToTexture', (s, d) => `copy ${d.name} ${s.image?.width}x${s.image?.height}${d.generateMipmaps ? ' +mips' : ''}`);
  const render = r.render.bind(r);
  r.render = (scene, cam) => { const s = performance.now(); const out = render(scene, cam); const d = performance.now() - s; const rt = r.getRenderTarget(); if (scene.children.length === 1 && scene.children[0].material?.uniforms?.uRect) window.__ops.push({ op: `merge-render ${rt?.texture?.name ?? ''}`, ms: +d.toFixed(2), at: +s.toFixed(0) }); return out; };
});
await page.evaluate(() => window.__flight.devScenario('orbit'));
const ready = await until(() => { const l = []; window.__flight.scene.traverse(o => { if (o.userData.imagery) l.push(o.userData.imagery); }); return l.length && l.every(p => p.ready && p.cloudSourceSettled) ? l.map(p => ({ level: p.levelId, ...p.stats })) : false; }).then(h => h.jsonValue()).catch(e => String(e));
const out = await page.evaluate(() => ({ imgOps: (() => { const c = window.__ops.filter(o => /earth|merge/.test(o.op)); const ms = c.map(o => o.ms).sort((a, b) => a - b); return { n: c.length, total: +ms.reduce((a, b) => a + b, 0).toFixed(0), p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * .95)], max: ms[ms.length - 1], streamSecs: c.length ? +((c[c.length - 1].at - c[0].at) / 1000).toFixed(1) : 0 }; })(), ops: window.__ops.filter(o => /earth|merge/.test(o.op)).sort((a, b) => b.ms - a.ms).slice(0, 8), n: window.__ops.length, lt: window.__lt.filter(t => t[1] > 50).length, ltMax: Math.max(0, ...window.__lt.map(t => t[1])) }));
console.log(JSON.stringify({ url, rate, secs: (Date.now() - t0) / 1000, ready, ...out }, null, 1));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await context.close(); await browser.close();
