// Copy next to playwright-core in C:\wsp-tools\drv (with scripts/bench/earthgfx/{families,earthtoggle}.js in drv\js) and run with the Windows node.
// Per-family GPU cost in a flight scenario: node earthgfx-flightfam.mjs <baseUrl> <quality> [scenario] [dpr]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [base, quality = 'medium', scenario = 'orbit', dpr = '2'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
// Keep settings/service workers isolated from other agents' tabs on the shared Chrome.
const ctx = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: +dpr, serviceWorkers: 'block' });
await ctx.addInitScript((q) => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: q, shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, autoSaveInterval: 0, masterVolume: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
}, quality);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 920, deviceScaleFactor: +dpr, mobile: false });
await page.goto(scenario === 'pad' ? `${base}/?flight=stock-kestrel` : `${base}/?flight=stock-kestrel&scenario=${scenario}`);
const t0 = Date.now();
while (Date.now() - t0 < 120000 && !(await page.evaluate('!!(window.__flight && window.__flight.sceneReady)').catch(() => false))) await page.waitForTimeout(500);
await page.waitForTimeout(6000);
await page.evaluate(() => { window.__flight.paused = true; });
const js = readFileSync(process.argv[6] || 'C:\\wsp-tools\\drv\\js\\bench.js' /* copy of scripts/bench/earthgfx/families.js */, 'utf8');
console.log(JSON.stringify(await page.evaluate(js)));
await ctx.close(); await browser.close();
