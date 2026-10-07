// Real-GPU screenshots for the Earth imagery pass (Windows Chrome over CDP, see docs/PERFORMANCE.md).
// Copy into C:\wsp-tools\drv (it resolves playwright-core from there) and run with the Windows node:
//   node earthgfx-shots.mjs <shots.json> [outDir]
// shots.json: [{ "name": "orbit-day-medium", "url": "http://host:5326/planet-preview.html?...", "dpr": 2,
//                "settle": 1500, "timeout": 60000, "flight": false, "js": "optional expression after ready" }]
// Preview pages wait for window.__preview.ready; flight pages for __flight.sceneReady. Prints JSON per shot
// (GPU ms from the pipeline timer, imagery level, readiness) and writes PNGs to outDir.
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';

const [list, outDir = 'C:\\wsp-tools\\shots\\earthgfx'] = process.argv.slice(2);
const shots = JSON.parse(readFileSync(list, 'utf8'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
for (const s of shots) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.width ?? 1470, height: s.height ?? 920, deviceScaleFactor: s.dpr ?? 2, mobile: false });
  if (s.storage) {
    await page.goto(new URL(s.url).origin + '/favicon.ico').catch(() => {});
    await page.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, s.storage);
  }
  const t0 = Date.now();
  await page.goto(s.url, { waitUntil: 'load' });
  const ready = s.flight ? '!!(window.__flight && window.__flight.sceneReady)' : '!!(window.__preview && window.__preview.ready)';
  let ok = false;
  while (Date.now() - t0 < (s.timeout ?? 90000)) {
    ok = await page.evaluate(ready).catch(() => false);
    if (ok) break;
    await page.waitForTimeout(500);
  }
  if (s.js) await page.evaluate(s.js).catch((e) => errors.push(String(e)));
  await page.waitForTimeout(s.settle ?? 2000);
  const info = await page.evaluate(`(() => {
    const p = window.__preview || window.__flight; const pipe = p && p.pipeline;
    const planet = window.__preview ? window.__preview.planet : null;
    return { gpuMs: pipe ? +pipe.gpuMs.toFixed(2) : null, pr: pipe ? pipe.pixelRatio : null,
      imagery: planet && planet.imagery ? planet.imagery.levelId : null, mode: planet ? planet.stats.mode : null };
  })()`).catch(() => ({}));
  await page.screenshot({ path: `${outDir}\\${s.name}.png`, scale: 'device' });
  console.log(JSON.stringify({ name: s.name, ready: ok, secs: (Date.now() - t0) / 1000, ...info, errors: errors.slice(0, 5) }));
  await page.close();
}
await browser.close();
