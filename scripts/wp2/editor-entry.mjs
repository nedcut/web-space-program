// Paired warm editor-entry timing: Space Center -> editor (view ready + 2 frames), interleaved builds.
// Usage: node.exe C:\wsp-tools\drv\wp2-entry.mjs <urlA> <urlB> [rounds]
import { chromium } from 'playwright-core';
const [a, b, rounds = '4'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const out = { [a]: [], [b]: [] };
for (let r = 0; r < +rounds; r++) for (const url of r % 2 ? [b, a] : [a, b]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.__game.set({ scene: 'spaceCenter', craft: null }));
    await page.waitForTimeout(1500);
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      window.__game.set({ scene: 'editor' });
      while (!window.__editor?.view) await new Promise(r => setTimeout(r, 5));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    });
    if (i > 0) out[url].push(Math.round(ms));
  }
  // Steady editor frame cost with the Selene stack loaded.
  const frame = await page.evaluate(async () => {
    window.__editor.loadStock('stock-selene');
    await new Promise(r => setTimeout(r, 1500));
    const v = window.__editor.view; const xs = [];
    for (let i = 0; i < 60; i++) { v.setView({ yaw: 0.55 + i * 0.01 }, false); await new Promise(r => requestAnimationFrame(r)); xs.push(v.timing.update + v.timing.render); }
    xs.sort((p, q) => p - q);
    return { median: +xs[30].toFixed(2), p90: +xs[54].toFixed(2), calls: v.timing.calls };
  });
  (out[url + ' frame'] ??= []).push(frame);
  await page.close(); await ctx.close();
}
const med = xs => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
for (const url of [a, b]) console.log(url, 'entry ms', JSON.stringify(out[url]), 'median', med(out[url]), 'frames', JSON.stringify(out[url + ' frame']));
await browser.close();
