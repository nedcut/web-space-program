// Interleaved A/B GPU cost of planet-preview views on the real GPU (Windows Chrome over CDP).
// Both builds are served from one origin: <host>/a/ (before) and <host>/b/ (after), each built with the preview
// page included. Copy into C:\wsp-tools\drv and run with the Windows node:
//   node earthgfx-ab.mjs <host> <views.json> <quality[:earth]>,... <reps> [dpr]
// Per view and side: wait for __preview.ready, then time 30 renders between two readPixels fences, median of 5,
// and record the pipeline's GPU timer. Prints one JSON line per sample and a median summary at the end.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [host, viewsFile, tiers, reps = '3', dpr = '2'] = process.argv.slice(2);
const views = JSON.parse(readFileSync(viewsFile, 'utf8'));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const BENCH = `(() => {
  const pv = window.__preview, p = pv.pipeline, gl = p.renderer.getContext(), px = new Uint8Array(4);
  const run = (n) => { p.render(pv.scene, pv.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now(); for (let i = 0; i < n; i++) p.render(pv.scene, pv.camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
  const a = [run(30), run(30), run(30), run(30), run(30)].sort((x, y) => x - y);
  return { fenced: +a[2].toFixed(3), timer: +p.gpuMs.toFixed(3), pr: p.pixelRatio,
    imagery: pv.planet && pv.planet.imagery ? pv.planet.imagery.levelId : null };
})()`;
const samples = [];
for (let r = 0; r < +reps; r++) {
  for (const t of tiers.split(',')) {
    const [quality, earth] = t.split(':');
    for (const [name, q] of Object.entries(views)) {
      for (const side of r % 2 ? ['b', 'a'] : ['a', 'b']) {
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 920, deviceScaleFactor: +dpr, mobile: false });
        await page.goto(`${host}/${side}/planet-preview.html?body=earth&ui=0&settle=1&quality=${quality}${earth && side === 'b' ? `&earth=${earth}` : ''}&${q}`);
        const t0 = Date.now();
        while (Date.now() - t0 < 120000 && !(await page.evaluate('!!(window.__preview && window.__preview.ready)').catch(() => false))) await page.waitForTimeout(400);
        await page.waitForTimeout(2500);
        const res = await page.evaluate(BENCH).catch((e) => ({ error: String(e) }));
        const s = { rep: r, tier: t, view: name, side, ...res };
        samples.push(s);
        console.log(JSON.stringify(s));
        await page.close();
      }
    }
  }
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
for (const t of tiers.split(',')) for (const v of Object.keys(views)) {
  const pick = (side, k) => med(samples.filter((s) => s.tier === t && s.view === v && s.side === side && s[k] != null).map((s) => s[k]));
  const fa = pick('a', 'fenced'), fb = pick('b', 'fenced');
  console.log(`== ${t} ${v}: fenced A ${fa.toFixed(2)} B ${fb.toFixed(2)} Δ ${(fb - fa).toFixed(2)} ms | timer A ${pick('a', 'timer').toFixed(2)} B ${pick('b', 'timer').toFixed(2)}`);
}
await browser.close();
