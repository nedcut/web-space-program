// Production-only transition probe. Run via cpu-transitions.sh (owns shared GPU lock).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, label = 'transitions', rate = '4'] = process.argv.slice(2);
if (!base) throw new Error('Usage: cpu-transitions.sh http://<WSL-IP>:5334 label [CPU-rate]');
const local = process.env.WSP_CPU_LOCAL === '1';
const browser = local ? await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) : await chromium.connectOverCDP('http://127.0.0.1:9333');
const out = { base, label, throttle: +rate, date: new Date().toISOString(), runs: [] };
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, renderScale: 1, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  window.__tasks = [];
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__tasks.push({ start: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true });
});
const page = await context.newPage();
page.on('dialog', d => d.accept());
page.on('pageerror', e => { (out.errors ??= []).push(e.message); });
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
const until = fn => page.waitForFunction(fn, null, { polling: 25, timeout: 120000 });
const painted = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const flight = () => until(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen:not([style*="opacity: 0"])'));
try {
  for (const cache of ['cold', 'warm']) {
    const run = { cache, timings: {} }; out.runs.push(run);
    const measure = async (name, action, ready) => {
      const start = await page.evaluate(() => performance.now());
      const wall = Date.now();
      await action(); await ready(); await painted();
      run.timings[name] = { ms: Date.now() - wall, ...(await page.evaluate(start => {
        const tasks = window.__tasks.filter(t => t.start >= start);
        return { longTasks: tasks.length, maxTaskMs: Math.max(0, ...tasks.map(t => t.ms)) };
      }, start)) };
      console.log(cache, name, JSON.stringify(run.timings[name]));
    };
    const wall = Date.now();
    await page.goto(base);
    await page.locator('.menu-actions button').first().waitFor(); await painted();
    run.timings.menu = { ms: Date.now() - wall };
    console.log(cache, 'menu', run.timings.menu.ms);
    await measure('menu-hub', () => page.evaluate(() => window.__game.set({ scene: 'spaceCenter' })), () => until(() => window.__game.get().scene === 'spaceCenter' && document.querySelector('canvas')));
    await measure('hub-editor', () => page.evaluate(() => window.__game.set({ scene: 'editor' })), () => until(() => !!window.__editor?.view));
    await page.evaluate(() => window.__editor.loadStock('stock-kestrel'));
    await measure('editor-pad', () => page.getByRole('button', { name: 'Launch', exact: true }).click(), flight);
    await measure('flight-map', () => page.evaluate(() => window.__flight.toggleMap()), () => until(() => window.__flight?.mapMode));
    await page.evaluate(() => window.__flight.toggleMap());
    await page.evaluate(() => window.__flight.quicksave());
    await measure('quickload', () => page.evaluate(() => { window.__oldFlight = window.__flight; window.__flight.onQuickload(); }), async () => {
      await until(() => window.__flight && window.__flight !== window.__oldFlight); await flight();
    });
    // Quickload is a resume, so start a fresh launch before testing the actual Revert button.
    await page.evaluate(() => window.__game.set({ scene: 'editor' })); await until(() => !!window.__editor?.view);
    await page.getByRole('button', { name: 'Launch', exact: true }).click(); await flight();
    await page.keyboard.press('Escape');
    await measure('revert-launch', () => page.getByRole('button', { name: 'Revert to launch', exact: true }).click(), flight);
    // The store route isolates tracking construction; save the current world via the public quicksave first.
    await measure('flight-tracking', () => page.evaluate(() => {
      window.__flight.quicksave();
      const data = window.__flight.constructor.loadSlot('quicksave');
      window.__game.set({ scene: 'tracking', resumeWorld: data });
    }), () => until(() => !!document.querySelector('.tracking-station canvas')));
    await page.evaluate(() => { delete window.__oldFlight; window.__game.set({ scene: 'menu' }); });
  }
} finally {
  const dir = local ? 'docs/performance/perfcpu' : 'C:/wsp-tools/bench';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${label}.json`, JSON.stringify(out, null, 2));
  await context.close(); await browser.close();
}
