// Real Windows Firefox / Chrome driver (WebDriver BiDi through puppeteer-core) — see docs/BROWSERS.md.
// Runs on the *Windows* side (the game is served from WSL with --host; Windows localhost reaches it):
//   mkdir C:\wsp-tools\drv-ff && cd there && npm i puppeteer-core   (Windows Node), copy this file in, then from WSL:
//   /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv-ff\flow.mjs' ...
// Screenshots go to C:\wsp-tools\shots. Not part of npm scripts: puppeteer-core is a Windows-side install only.
// Full-flow driver for real Windows Firefox (WebDriver BiDi via puppeteer-core).
// Usage: node.exe flow.mjs <baseUrl> <tag> [browser=firefox|chrome]
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';
const [base = 'http://localhost:5328/', tag = 'flow', which = 'firefox'] = process.argv.slice(2);
const profile = `C:\\wsp-tools\\ff-profile-${tag}`;
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const browser = await puppeteer.launch(which === 'firefox' ? {
  browser: 'firefox', headless: false, executablePath: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', userDataDir: profile,
  extraPrefsFirefox: { 'media.autoplay.default': 0 }, args: ['--width=1600', '--height=1000'], defaultViewport: null,
} : { browser: 'chrome', headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', userDataDir: profile, protocol: 'webDriverBiDi' });
const page = (await browser.pages())[0] ?? await browser.newPage();
// (window size via args)
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(1);
const errors = [];
page.on('console', (m) => { const t = m.text(); if (/timeStamp/.test(m.type())) return; if (m.type() === 'error' || /error/i.test(t)) errors.push(t.slice(0, 500)); if (m.type() !== 'debug') console.log(`${ts()} [${m.type()}] ${t.slice(0, 700)}`); });
page.on('pageerror', (e) => { errors.push(e.message); console.log(`${ts()} [pageerror] ${e.message}\n${String(e.stack || '').slice(0, 1500)}`); });
page.on('requestfailed', (r) => console.log(`${ts()} [reqfail] ${r.url()} ${r.failure()?.errorText}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: `C:\\wsp-tools\\shots\\${tag}-${n}.png` });
const clickText = async (re, sel = 'button, [role=button], [role=tab]') => {
  for (let i = 0; i < 60; i++) {
    const r = await page.evaluate((src, sel) => { const re = new RegExp(src); const el = [...document.querySelectorAll(sel)].find((e) => re.test(e.textContent.trim()) && e.offsetParent !== null); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, re.source, sel);
    if (r) { await page.mouse.click(r.x, r.y); return; }
    await sleep(500);
  }
  throw new Error('no clickable ' + re);
};
const waitFor = async (fn, ms = 90000, label = '') => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) return; await sleep(300); } throw new Error('timeout ' + label); };
const fps = async (ms = 5000) => page.evaluate((ms) => new Promise((res) => { const t = []; const f = (n) => { t.push(n); if (n - t[0] < ms) requestAnimationFrame(f); else { const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b); res({ frames: d.length, mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p50: +d[d.length >> 1].toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2) }); } }; requestAnimationFrame(f); }), ms);
const step = async (name, fn) => { console.log(`${ts()} === ${name}`); try { const r = await fn(); console.log(`${ts()} PASS ${name} ${r ? JSON.stringify(r) : ''}`); } catch (e) { console.log(`${ts()} FAIL ${name}: ${e.message}`); await shot('fail-' + name.replace(/\W+/g, '_')).catch(() => {}); } };
await page.evaluateOnNewDocument(() => localStorage.setItem('wsp.help.seen.v1', '1'));
try {
  await page.goto(base, { waitUntil: 'load', timeout: 120000 });
  await step('menu', async () => { await waitFor(() => document.body.innerText.includes('New Game')); await sleep(3000); await shot('menu'); return { gfx: await page.evaluate(() => JSON.parse(localStorage.getItem('wsp.settings.v1') || '{}').quality) }; });
  await step('new sandbox', async () => { await clickText(/^New Game/); await clickText(/^Sandbox/); await clickText(/^Start/); await waitFor(() => /SPACE CENTER/i.test(document.body.innerText), 60000, 'hub'); await sleep(3000); await shot('hub'); });
  await step('editor', async () => { await clickText(/Vehicle Assembly/); await waitFor(() => window.__editor, 90000, 'editor'); await sleep(2000);
    await page.evaluate(() => window.__editor.loadStock('meridian')); await sleep(4000); await shot('editor');
    // Mouse orbit + wheel in editor
    await page.mouse.move(800, 450); await page.mouse.down({ button: 'right' }); await page.mouse.move(900, 420, { steps: 8 }); await page.mouse.up({ button: 'right' });
    await page.mouse.wheel({ deltaY: 300 }); await sleep(500);
    return { parts: await page.evaluate(() => window.__editor.session.currentCraft().parts.length) }; });
  await step('launch', async () => { await clickText(/^Launch/); await sleep(800); if (await page.evaluate(() => !window.__flight)) { await clickText(/^Launch/).catch(() => {}); }
    await waitFor(() => window.__flight && !document.querySelector('.loading-screen'), 180000, 'flight'); await sleep(4000); await shot('pad');
    return { pad: await fps(5000) }; });
  await step('stage + throttle via keyboard', async () => {
    await page.mouse.click(800, 300); await page.keyboard.down('z'); await sleep(100); await page.keyboard.up('z');
    await page.keyboard.press(' '); await sleep(6000);
    const st = await page.evaluate(() => { const c = window.__flight; const v = c.world.active; return { thr: c.input.state.throttle, alt: c.world.altitude?.(v) ?? null, mode: v.mode, speed: Math.hypot(...['x','y','z'].map(k=>v.state.vel?.[k] ?? 0)) }; });
    await shot('ascent'); return { ...st, fps: await fps(5000) }; });
  await step('camera mouse drag + wheel', async () => {
    const before = await page.evaluate(() => { const c = window.__flight.camera ?? window.__flight.cam; return JSON.stringify(c?.state ?? { d: c?.distance, y: c?.yaw, p: c?.pitch }); });
    await page.mouse.move(800, 300); await page.mouse.down({ button: 'right' }); await page.mouse.move(950, 260, { steps: 10 }); await page.mouse.up({ button: 'right' });
    for (let i = 0; i < 5; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(60); }
    await sleep(800);
    const after = await page.evaluate(() => { const c = window.__flight.camera ?? window.__flight.cam; return JSON.stringify(c?.state ?? { d: c?.distance, y: c?.yaw, p: c?.pitch }); });
    return { before, after }; });
  await step('assist to orbit', async () => {
    const r = await page.evaluate(() => { const c = window.__flight; c.paused = true; c.startAssist('orbit'); let steps = 0;
      while (c.assist && !c.assist.done && !c.assist.error && steps++ < 70000) { const s = c.assist.update(c.world); if (s.coastUntil && s.coastUntil > c.world.ut + 2) c.world.advanceRailsTo(s.coastUntil); else c.world.tick(0.02, s.input); }
      const o = c.world.orbitSummary(c.world.active); c.cancelAssist(); c.input.state.throttle = 0; c.paused = false; return { steps, ap: o.ap, pe: o.pe }; });
    await sleep(5000); await shot('orbit'); return { ...r, fps: await fps(5000) }; });
  await step('map', async () => { await page.keyboard.press('m'); await sleep(4000); for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(50); } await sleep(1500); await shot('map');
    return { map: await page.evaluate(() => window.__flight.mapMode), fps: await fps(4000) }; });
  await step('quicksave/quickload', async () => { await page.keyboard.press('m'); await sleep(1000); await page.keyboard.press('F5'); await sleep(1500); const ut1 = await page.evaluate(() => window.__flight.world.ut); await sleep(3000); await page.keyboard.press('F9'); await sleep(2000); await waitFor(() => window.__flight && !document.querySelector('.loading-screen'), 120000, 'reload'); await sleep(2000);
    return { ut1, ut2: await page.evaluate(() => window.__flight?.world.ut), text: await page.evaluate(() => document.body.innerText.match(/(Quick\w+[^\n]*)/i)?.[1]) }; });
    await step('space center → tracking', async () => { await page.keyboard.press('Escape'); await sleep(800); await shot('pause'); await clickText(/^Space Center$/); await sleep(4000); await shot('after-exit');
    if (await page.evaluate(() => /Flight log/.test(document.body.innerText))) await clickText(/^Space Center$/);
    await waitFor(() => /Vehicle Assembly/.test(document.body.innerText), 60000, 'hub');
    await sleep(2000); await clickText(/Tracking Station/); await sleep(10000); await shot('tracking');
    // Focus a vessel / body via the list, then zoom the map with the wheel
    await page.mouse.move(800, 450); for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: -100 }); await sleep(50); } await sleep(1500); await shot('tracking-zoom');
    return { fps: await fps(4000), text: await page.evaluate(() => document.body.innerText.slice(0, 300)) }; });
  await step('back to menu + continue', async () => { await clickText(/Space Center|Exit|Back/); await sleep(3000); await clickText(/^Main menu$/); await sleep(2000); await clickText(/^Continue/); await sleep(2000); await clickText(/^Load$/); await sleep(3000);
    await waitFor(() => /Vehicle Assembly/.test(document.body.innerText), 60000, 'hub after continue'); await shot('continue'); });
} catch (e) { console.log('DRIVER ERROR', e); }
console.log('ERRORS', JSON.stringify(errors, null, 1));
await browser.close();
