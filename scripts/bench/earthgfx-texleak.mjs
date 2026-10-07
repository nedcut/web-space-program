// Earth imagery texture lifetime: cycle all 12 months in flight, then back; textures must return to baseline.
import { chromium } from 'playwright-core';
const [base, quality = 'medium'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto(base + '/favicon.ico').catch(() => {});
await page.evaluate((q) => localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: q, shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, autoSaveInterval: 0, masterVolume: 0 })), quality);
await page.goto(`${base}/?flight=stock-kestrel&scenario=orbit`);
const t0 = Date.now();
while (Date.now() - t0 < 120000 && !(await page.evaluate('!!(window.__flight && window.__flight.sceneReady)').catch(() => false))) await page.waitForTimeout(500);
const get = () => page.evaluate(() => { let pl = null; window.__flight.scene.traverse((o) => { if (o.userData && o.userData.planet) pl = o.userData.planet; });
  return { tex: window.__flight.pipeline.renderer.info.memory.textures, ready: pl.imagery.ready, level: pl.imagery.levelId }; });
const setMonth = (m) => page.evaluate((m) => { window.__flight.scene.traverse((o) => { if (o.userData && o.userData.planet) o.userData.planet.seasonOverride = m; }); }, m);
const settle = async () => { await page.waitForTimeout(500); const t = Date.now(); while (Date.now() - t < 60000 && !(await get()).ready) await page.waitForTimeout(300); await page.waitForTimeout(500); };
await settle();
const first = await get();
const start = 6;
await setMonth(start); await settle();
const baseline = await get();
const seen = [];
for (let i = 1; i <= 12; i++) { await setMonth((start + i) % 12); await settle(); const g = await get(); seen.push(`${(start + i) % 12}:${g.tex}:${g.level}`); }
const after = await get();
console.log(JSON.stringify({ first, baseline, perMonth: seen, after, leaked: after.tex - baseline.tex }));
await page.close(); await browser.close();
