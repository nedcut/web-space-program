// Paired production HUD CPU measurements; no screenshot/screencast work during the samples.
import { chromium } from 'file:///C:/wsp-tools/drv/node_modules/playwright-core/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../docs/screenshots/wp3/paired-performance.json', import.meta.url));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const results = process.argv.includes('--resume') ? JSON.parse(readFileSync(out, 'utf8')) : [];
const occurrences = new Map();
try {
 for (const dpr of [1, 2]) for (const scene of ['pad', 'orbit', 'moon']) for (const variant of ['before', 'after', 'before', 'after']) {
  const key = `${dpr}/${scene}/${variant}`;
  const occurrence = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, occurrence);
  if (results.filter(r => r.dpr === dpr && r.scene === scene && r.variant === variant && !r.strip).length >= occurrence
      && (variant === 'before' || results.filter(r => r.dpr === dpr && r.scene === scene && r.variant === variant && r.strip).length >= occurrence)) continue;
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
  await context.addInitScript(() => {
   localStorage.setItem('wsp.help.seen.v1', '1');
   localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, autoSaveInterval: 0, masterVolume: 0, flightHints: false }));
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR', m.text().slice(0, 240)); });
  await page.goto(`http://172.24.204.38:${variant === 'before' ? 5402 : 5401}/?flight=stock-${scene === 'pad' ? 'meridian' : 'selene'}${scene === 'pad' ? '' : `&scenario=${scene}`}`);
  try { await page.waitForFunction(() => window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 }); }
  catch (error) { console.log('LOAD FAILURE', variant, dpr, scene, await page.locator('body').innerText()); await page.screenshot({ path: out.replace('.json', '-load-failure.png') }); throw error; }
  await page.waitForTimeout(5000);
  for (const strip of variant === 'after' ? [false, true] : [false]) {
   if (strip) await page.getByRole('button', { name: /Engineering strip:/ }).click();
   await page.evaluate(() => { window.__perf.enabled = true; window.__perf.reset(); });
   await page.waitForTimeout(6000);
   const data = await page.evaluate(() => ({ profile: window.__perf.summary(), pipeline: window.__flight.pipeline?.stats, gpuMs: window.__flight.pipeline?.gpuMs }));
   results.push({ variant, dpr, scene, strip, ...data });
   writeFileSync(out, JSON.stringify(results, null, 2));
   console.log(variant, dpr, scene, strip, data.profile.sections.hud, data.profile.fps);
  }
  await context.close();
 }
} finally { await browser.close(); }
