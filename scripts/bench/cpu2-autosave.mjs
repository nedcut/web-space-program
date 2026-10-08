// Round-2 CPU diagnostic (copy to C:\wsp-tools\drv and run with the Windows node under flock /tmp/wsp-gpu.lock).
// Autosave main-thread cost: sync call + following idle-callback tasks, from a CDP trace.
import { chromium } from 'playwright-core';
const [url, rate = '4', label = 'x'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const until = (fn, timeout = 240000) => page.waitForFunction(fn, null, { polling: 250, timeout });
await page.goto(url);
await until(() => !!document.querySelector('.menu-actions button'));
await page.evaluate(() => window.__game.set({ scene: 'spaceCenter' }));
await page.waitForTimeout(4000);
await page.evaluate(() => window.__game.set({ scene: 'editor' }));
await until(() => !!window.__editor?.view);
await page.evaluate(() => window.__editor.loadStock('stock-meridian'));
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Launch', exact: true }).click();
await until(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'));
// Fly briefly so the flight log has content, then build a realistic index: ten slots across three programs.
await page.evaluate(() => window.__flight.startAssist('orbit'));
await page.waitForTimeout(20000);
const indexBytes = await page.evaluate(() => {
  for (let i = 0; i < 3; i++) window.__flight.quicksave('autosave');
  window.__flight.quicksave();
  const key = 'wsp.save-slots.v1';
  const slots = JSON.parse(localStorage.getItem(key));
  const extra = [];
  for (let p = 0; p < 2; p++) for (const s of slots) extra.push({ ...s, id: `other${p}:${s.id}`, programId: `other${p}` });
  localStorage.setItem(key, JSON.stringify([...slots, ...extra].slice(0, 10)));
  return localStorage.getItem(key).length;
});
await page.waitForTimeout(3000);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
await page.waitForTimeout(3000);
const results = [];
for (let k = 0; k < 4; k++) {
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline', 'blink.user_timing'], excludedCategories: ['*'] } });
  await page.waitForTimeout(300);
  const sync = await page.evaluate(() => { performance.mark('autosave:start'); const t = performance.now(); window.__flight.quicksave('autosave'); const d = performance.now() - t; performance.mark('autosave:end'); return d; });
  await page.waitForTimeout(3000);
  const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  const { stream } = await done;
  let text = '';
  for (;;) { const c = await cdp.send('IO.read', { handle: stream, size: 1 << 22 }); text += c.base64Encoded ? Buffer.from(c.data, 'base64').toString() : c.data; if (c.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  const ev = JSON.parse(text).traceEvents ?? JSON.parse(text);
  const mark = ev.find(e => e.name === 'autosave:start');
  const idle = ev.filter(e => e.name === 'FireIdleCallback' && e.ph === 'X' && mark && e.pid === mark.pid && e.ts >= mark.ts).map(e => +(e.dur / 1000).toFixed(2));
  const tasks = ev.filter(e => e.name === 'RunTask' && e.ph === 'X' && mark && e.pid === mark.pid && e.tid === mark.tid && e.ts <= mark.ts && e.ts + e.dur >= mark.ts).map(e => +(e.dur / 1000).toFixed(2));
  results.push({ sync: +sync.toFixed(2), syncTask: tasks[0], idleTasks: idle.sort((a, b) => b - a).slice(0, 5) });
  await page.waitForTimeout(1500);
}
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wsp.save-slots.v1')).filter(s => s.kind === 'auto').length);
console.log(JSON.stringify({ label, rate, indexBytes, storedAutos: stored, results }));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await context.close(); await browser.close();
