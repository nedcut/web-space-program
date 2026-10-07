// Browser check (headless, SwiftShader): Moon transfer departure options in the map's maneuver planner, picking
// another option, main-thread responsiveness while the planner worker runs, and the Execute-node assist handing back
// a flyable craft. Usage: npx vite --port 5328 --strictPort, then node scripts/planner-options-browser.mjs [outDir]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.WSP_URL ?? 'http://127.0.0.1:5328';
const out = process.argv[2] ?? '/tmp/wsp-planner-shots';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const report = {};
try {
  await page.addInitScript(() => {
    localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5, bloom: false, shadows: false, scatter: false, clouds: false, autoSaveInterval: 0, masterVolume: 0 }));
    localStorage.setItem('wsp.help.seen.v1', '1');
    localStorage.setItem('wsp.mapPlanner.open.v1', '1');
  });
  await page.goto(`${base}/?flight=stock-selene&scenario=orbit`);
  await page.waitForFunction(() => window.__flight && document.querySelector('.hud-left'));
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__flight.world.active?.state.situation === 'flying');
  await page.evaluate(() => window.__flight.toggleMap());
  // Main-thread heartbeat while planning: the planner runs in a worker.
  await page.evaluate(() => { window.__gaps = []; let last = performance.now(); window.__beat = setInterval(() => { const now = performance.now(); window.__gaps.push(now - last); last = now; }, 4); });
  await page.getByRole('combobox').filter({ hasText: 'Plan transfer to' }).selectOption({ label: 'Moon' });
  await page.getByText('Departure options').waitFor();
  report.heartbeat = await page.evaluate(() => { clearInterval(window.__beat); const g = window.__gaps.sort((a, b) => b - a); return { maxGapMs: g[0], p99: g[Math.floor(g.length / 100)] }; });
  report.focusAfterPick = await page.evaluate(() => document.activeElement?.tagName);
  report.first = await page.evaluate(() => ({ node: window.__flight.world.nodes[0]?.time - window.__flight.world.ut, options: [...document.querySelectorAll('[aria-label="Departure options"] button')].map(b => b.textContent) }));
  await page.screenshot({ path: `${out}/options.png` });
  // Pick a different departure.
  const other = page.locator('[aria-label="Departure options"] button:not([disabled])').first();
  await other.click();
  await page.waitForFunction(t => Math.abs(window.__flight.world.nodes[0]?.time - window.__flight.world.ut - t) > 600, report.first.node);
  report.picked = await page.evaluate(() => ({ node: window.__flight.world.nodes[0]?.time - window.__flight.world.ut, message: [...document.querySelectorAll('.panel div')].map(d => d.textContent).find(t => t?.includes('transfer:')) }));
  await page.screenshot({ path: `${out}/picked.png` });
  // Fly it with the assist, then check the pilot gets a flyable craft back.
  await page.evaluate(() => window.__flight.startAssist('node'));
  const statuses = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 600000) {
    const s = await page.evaluate(() => window.__flight.assist?.status ?? null);
    if (s === null) break;
    statuses.add(s.split(' · ')[0]);
    await page.waitForTimeout(500);
  }
  report.assist = await page.evaluate(() => {
    const c = window.__flight, w = c.world;
    return { nodes: w.nodes.length, warp: w.warp, mode: w.active.mode, sasOn: c.sasOn, sas: c.sas, body: w.active.body, messages: w.messages.map(m => m.text) };
  });
  report.assist.statuses = [...statuses];
  await page.screenshot({ path: `${out}/after-assist.png` });
} catch (e) {
  report.failure = e.message;
} finally {
  report.errors = errors;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
