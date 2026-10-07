// Per-family GPU cost in a planet-preview view: node earthgfx-families.mjs <url> [dpr]
import { chromium } from 'playwright-core';
const [url, dpr = '2'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 920, deviceScaleFactor: +dpr, mobile: false });
await page.goto(url);
const t0 = Date.now();
while (Date.now() - t0 < 120000 && !(await page.evaluate('!!(window.__preview && window.__preview.ready)').catch(() => false))) await page.waitForTimeout(400);
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(`(() => {
  const pv = window.__preview, p = pv.pipeline, gl = p.renderer.getContext(), px = new Uint8Array(4);
  const run = (n) => { p.render(pv.scene, pv.camera); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    const t = performance.now(); for (let i = 0; i < n; i++) p.render(pv.scene, pv.camera);
    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); return (performance.now() - t) / n; };
  const med = () => { const a = [run(30), run(30), run(30), run(30), run(30), run(30), run(30)].sort((x, y) => x - y); return a[3]; };
  const mats = new Set(); pv.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
  const U = m => m.uniforms || {};
  const fam = { terrain: m => U(m).uRockColor, ocean: m => U(m).uSeabed, clouds: m => U(m).uCamCCloud, sky: m => U(m).uSunAngularRadius };
  const out = { full: med() };
  for (const [k, f] of Object.entries(fam)) { const ms = [...mats].filter(f); ms.forEach(m => m.visible = false); out[k] = +(out.full - med()).toFixed(3); ms.forEach(m => m.visible = true); }
  const imgU = [...mats].map(m => U(m).uEarthImagery).filter(Boolean);
  if (imgU.length) { const v = imgU[0].value; imgU[0].value = 0; out.imageryBranch = +(out.full - med()).toFixed(3); imgU[0].value = v; }
  out.full = +out.full.toFixed(3);
  return out;
})()`)));
await page.close(); await browser.close();
