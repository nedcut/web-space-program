// Round-2 CPU diagnostic (copy to C:\wsp-tools\drv and run with the Windows node under flock /tmp/wsp-gpu.lock).
import { chromium } from 'playwright-core';
const [url, label, stock = 'stock-meridian'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { polling: 200, timeout });
await page.goto(url);
await until(() => !!document.querySelector('.menu-actions button'));
await page.evaluate(() => window.__game.set({ scene: 'editor' }));
await until(() => !!window.__editor?.view);
await page.evaluate(s => window.__editor.loadStock(s), stock);
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Launch', exact: true }).click();
await until(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'));
await until(() => { const l = []; window.__flight.scene.traverse(o => { if (o.userData.imagery) l.push(o.userData.imagery); }); return l.length && l.every(p => p.ready); }, 90000).catch(() => {});
await page.waitForTimeout(4000);
const shot = async name => { await page.screenshot({ path: `C:/wsp-tools/shots/pc2-${label}-${name}.png` }); };
await shot('pad');
// Close camera around the vessel bottom (engines) and a wide pad view.
await page.evaluate(() => { const c = window.__flight.cam; c.distance = (c.distance ?? 30) * 0.5; });
await page.waitForTimeout(1500); await shot('pad-close');
await page.evaluate(() => window.__flight.startAssist('orbit'));
await page.waitForTimeout(14000); await shot('ascent');
await page.evaluate(() => { window.__flight.cancelAssist?.(); window.__flight.devScenario('orbit'); });
await page.waitForTimeout(8000); await shot('orbit');
console.log(label, 'errors', JSON.stringify(errors));
await context.close(); await browser.close();
