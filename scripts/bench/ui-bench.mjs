// Production-only UI probe. Build + serve on 5336 before running. Uses local WSL Chromium.
// node scripts/bench/ui-bench.mjs before|after [http://localhost:5336]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'after', base = 'http://localhost:5336'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2 });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', graphicsProfile: 99, masterVolume: 0, adaptiveQuality: false, frameCap: 120 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  window.__uiBench = { events: [], gaps: [], longTasks: [] };
  let last;
  const frame = now => { if (last) window.__uiBench.gaps.push(now-last); last = now; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  for (const name of ['pointerdown', 'pointerover', 'input', 'keydown', 'wheel']) document.addEventListener(name, e => {
    const start = performance.now();
    // Double rAF: first callback precedes the next paint; second bounds the paint opportunity.
    requestAnimationFrame(() => requestAnimationFrame(() => window.__uiBench.events.push({ name, target: e.target.className, ms: performance.now()-start })));
  }, true);
  new PerformanceObserver(list => window.__uiBench.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const results = { label, base, cpuThrottle: 4, dpr: 2, renderer: 'WSL Chromium SwiftShader (software GPU)', paintMethod: 'capture event to second rAF; upper bound on next paint opportunity', cases: {}, errors };
const measure = async (name, action) => {
  await page.evaluate(() => { window.__uiBench.events = []; window.__uiBench.gaps = []; });
  for (let i=0; i<8; i++) { await action(i); await page.waitForTimeout(150); }
  await page.waitForTimeout(250);
  results.cases[name] = await page.evaluate(() => {
    const b=window.__uiBench, percentile=(a,p)=>a.toSorted((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)] ?? null;
    return { samples: b.events, p75Ms: percentile(b.events.map(e=>e.ms),.75), p95FrameGapMs: percentile(b.gaps,.95), frames: b.gaps.length };
  });
  console.log(name, results.cases[name].p75Ms);
};
try {
  await page.goto(base);
  await page.waitForFunction(() => !!window.__game);
  const enter = async () => {
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await page.waitForFunction(() => !!window.__editor?.view, null, { timeout: 120000 });
  };
  await enter();
  console.log('editor ready');
  const thumbnailStart = Date.now();
  await page.waitForFunction(() => document.querySelectorAll('.vab-thumb img').length >= 18, null, { timeout: 120000 });
  results.coldFirst18Ms = Date.now()-thumbnailStart;
  results.thumbnailsAtFirst18 = await page.locator('.vab-thumb img').count();
  await measure('search', async i => { await page.getByPlaceholder('Search parts').fill(i%2 ? '' : 'tank'); });
  await page.getByPlaceholder('Search parts').fill('');
  await measure('hover', async i => { await page.locator('.vab-card').nth(i%6).hover(); });
  await measure('scroll', async i => { await page.locator('.vab-cards').hover(); await page.mouse.wheel(0,i%2 ? -420 : 420); });
  await page.evaluate(() => { document.activeElement?.blur(); window.__editor.loadStock('selene'); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.activeElement?.blur());
  await measure('symmetry', async () => { await page.keyboard.press('x'); });
  await measure('pick-cancel', async () => { await page.locator('.vab-card').first().click(); await page.keyboard.press('Escape'); });
  await page.evaluate(() => window.__editor.session.pickNew('tank-1-short'));
  await measure('held-pointer', async i => { await page.mouse.move(600+i*10,350+i%3*30); });
  await page.keyboard.press('Escape');
  results.thumbnailCount = await page.locator('.vab-thumb img').count();
  results.totalParts = await page.locator('.vab-card').count();
  results.longTasks = await page.evaluate(() => window.__uiBench.longTasks);
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await enter();
  const warmStart=Date.now();
  await page.waitForFunction(() => document.querySelectorAll('.vab-thumb img').length >=18, null, { timeout: 120000 });
  results.warmFirst18Ms=Date.now()-warmStart;
  mkdirSync('docs/performance/ui', { recursive: true });
  writeFileSync(`docs/performance/ui/${label}.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results, (k,v) => ['samples','longTasks'].includes(k) ? undefined : v,null,2));
} catch (e) { console.log(errors, await page.locator('body').innerText()); throw e; } finally { await browser.close(); }
