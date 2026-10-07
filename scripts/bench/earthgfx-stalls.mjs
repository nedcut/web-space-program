// Main-thread stalls while Earth imagery streams (Windows Chrome over CDP; copy into C:\wsp-tools\drv):
//   node earthgfx-stalls.mjs <base> <quality> [seconds] [dpr]
// From navigation to <seconds> after __flight.sceneReady: rAF frame intervals (count > 33 ms, max) and Long
// Tasks (> 50 ms) before and after the scene is ready. Prints one JSON line.
import { chromium } from 'playwright-core';
const [base, quality = 'high', seconds = '20', dpr = '2'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 920, deviceScaleFactor: +dpr, mobile: false });
await page.goto(base + '/favicon.ico').catch(() => {});
await page.evaluate((q) => localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: q, shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, autoSaveInterval: 0, masterVolume: 0 })), quality);
await page.addInitScript(() => {
  const w = window; w.__stall = { tasks: [], frames: [], readyAt: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__stall.tasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  let last = 0;
  const tick = (t) => { if (last) w.__stall.frames.push([t, t - last]); last = t; if (!w.__stall.readyAt && w.__flight && w.__flight.sceneReady) w.__stall.readyAt = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.goto(`${base}/?flight=stock-kestrel&scenario=orbit`);
const t0 = Date.now();
while (Date.now() - t0 < 120000 && !(await page.evaluate('!!(window.__stall && window.__stall.readyAt)').catch(() => false))) await page.waitForTimeout(250);
await page.waitForTimeout(+seconds * 1000);
console.log(JSON.stringify(await page.evaluate(() => {
  const s = window.__stall, r = s.readyAt;
  const after = s.frames.filter(([t]) => t > r), tasksAfter = s.tasks.filter(([t]) => t > r);
  const f = after.map(([, d]) => d).sort((a, b) => a - b);
  return { readyMs: Math.round(r), framesAfter: f.length, over33: f.filter((d) => d > 33.4).length, over50: f.filter((d) => d > 50).length,
    p50: +(f[Math.floor(f.length / 2)] ?? 0).toFixed(1), maxFrame: +(f[f.length - 1] ?? 0).toFixed(1),
    longTasksBefore: s.tasks.filter(([t]) => t <= r).length, longTasksAfter: tasksAfter.length, maxLongTaskAfter: Math.round(Math.max(0, ...tasksAfter.map(([, d]) => d))),
    imagery: (() => { let im = null; window.__flight.scene.traverse((o) => { if (o.userData && o.userData.imagery) im = o.userData.imagery; }); return im ? { level: im.levelId, ...im.stats, maxFrameMs: +im.stats.maxFrameMs.toFixed(1) } : null; })() };
})));
await page.close(); await browser.close();
