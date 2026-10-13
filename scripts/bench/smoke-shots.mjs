// Ascent smoke/exhaust look on the real-GPU Chrome (CDP 9333), Windows Node + playwright-core.
// Launches with the orbit assist at 1x, pauses at altitude checkpoints and shoots chase / side / far / tower views.
//   cp scripts/bench/smoke-shots.mjs /mnt/c/wsp-tools/drv/ && cd /mnt/c/wsp-tools/drv && \
//   flock /tmp/wsp-gpu.lock timeout 900 /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\smoke-shots.mjs' \
//     --base http://<wsl-ip>:5761 --label before-day [--craft stock-meridian] [--sun 35 [--dusk 1]] [--alts 0,1000,3000,8000,15000,20000]
// Writes C:\wsp-tools\shots\smoke\<label>-<alt>-<view>.jpg and <label>.json (fps while climbing between checkpoints).
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base.replace(/\/$/, '');
const label = args.label ?? 'run';
const craft = args.craft ?? 'stock-meridian';
const [vw, vh] = (args.size ?? '1600x900').split('x').map(Number);
const shotDir = args.shotdir ?? 'C:\\wsp-tools\\shots\\smoke';
const alts = (args.alts ?? '0,1000,3000,8000,15000,20000').split(',').map(Number);
const views = (args.views ?? 'chase,side,far,tower').split(',');
mkdirSync(shotDir, { recursive: true });
const settings = { quality: args.quality ?? 'medium', shadows: true, bloom: true, clouds: true, renderScale: 1, scatter: true, adaptiveQuality: false, graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0, flightHints: false };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 180000 });
const out = { label, base, craft, date: new Date().toISOString(), checkpoints: {} };
const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, serviceWorkers: 'block' });
await context.addInitScript((s) => { localStorage.setItem('wsp.settings.v1', JSON.stringify(s)); localStorage.setItem('wsp.help.seen.v1', '1'); }, settings);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const sunElevation = () => page.evaluate(() => {
  const f = window.__flight, w = f.world, a = w.active, u = w.universe;
  const s = u.ephem.getBodyState(u.sunId, w.ut).position, b = u.ephem.getBodyState(a.body, w.ut).position, p = a.state.position;
  const up = [p.x - b.x, p.y - b.y, p.z - b.z], sd = [s.x - p.x, s.y - p.y, s.z - p.z];
  const lu = Math.hypot(...up), ls = Math.hypot(...sd);
  return Math.asin((up[0] * sd[0] + up[1] * sd[1] + up[2] * sd[2]) / lu / ls) * 180 / Math.PI;
});
const agl = () => page.evaluate(() => { const w = window.__flight.world, a = w.active; return w.universe.surfaceInfo(a.body, a.state.position, w.ut).heightAboveTerrain; });
const frames = (ms) => page.evaluate((ms) => new Promise((res) => {
  const d = []; let last = performance.now(); const end = last + ms;
  const tick = (now) => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); res({ n: d.length, mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2) }); } };
  requestAnimationFrame(tick);
}), ms);
const setView = (view) => page.evaluate((view) => {
  const f = window.__flight, c = f.cam;
  if (view === 'tower') { for (let i = 0; i < 8 && c.mode !== 'tower'; i++) f.cycleCameraMode(); return c.mode === 'tower'; }
  if (c.mode === 'tower') c.mode = 'auto';
  if (view === 'chase') { c.mode = 'chase'; c.yaw = Math.PI; c.pitch = 0.12; c.distance = 45; }
  if (view === 'side') { c.mode = 'auto'; c.yaw = Math.PI * 0.5; c.pitch = 0.05; c.distance = 160; }
  if (view === 'far') { c.mode = 'auto'; c.yaw = Math.PI * 0.6; c.pitch = -0.25; c.distance = 1200; }
  return true;
}, view);
try {
  await page.goto(base + `/?flight=${craft}` + (args.scale ? `&scale=${args.scale}` : ''));
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(5000);
  out.sunStart = await sunElevation();
  if (args.sun !== undefined) {
    // Rails warp on the pad until the sun crosses --sun degrees (rising for day, setting with --dusk).
    const target = +args.sun, setting = !!args.dusk;
    const ok = (e, prev) => (setting ? e < prev : e > prev);
    await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 5 }; });
    let prev = await sunElevation();
    for (let i = 0; i < 6000; i++) {
      await page.waitForTimeout(40);
      const e = await sunElevation();
      if (ok(e, prev) && Math.abs(e - target) < 8) await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 3 }; });
      if (ok(e, prev) && (setting ? e <= target : e >= target)) break;
      prev = e;
    }
    await page.evaluate(() => { window.__flight.world.warp = { mode: 'rails', index: 0 }; });
    await page.waitForTimeout(4000);
  }
  out.sun = await sunElevation();
  console.log('sun elevation', out.sunStart.toFixed(1), '->', out.sun.toFixed(1));
  await page.keyboard.press('F2');
  await page.evaluate(() => { window.__flight.startAssist('orbit'); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__t0 = window.__flight.world.ut; });
  for (const alt of alts) {
    const t0 = Date.now();
    if (alt === 0) await page.waitForFunction(() => window.__flight.world.ut - window.__t0 >= 4, null, { timeout: 60000, polling: 50 });
    else {
      // Measure frame pacing for the leg while climbing.
      const leg = frames(3000);
      await page.waitForFunction((alt) => { const w = window.__flight.world, a = w.active; return w.universe.surfaceInfo(a.body, a.state.position, w.ut).heightAboveTerrain >= alt; }, alt, { timeout: 600000, polling: 50 });
      out.checkpoints[alt] = { leg: await leg };
    }
    await page.evaluate(() => { window.__flight.paused = true; });
    const info = await page.evaluate(() => { const w = window.__flight.world, a = w.active.state; return { met: +(w.ut - window.__t0).toFixed(1), speed: Math.round(a.telemetry.surfaceSpeed ?? 0), stats: { ...window.__flight.pipeline.stats } }; });
    const cp = (out.checkpoints[alt] ??= {}); Object.assign(cp, info, { agl: Math.round(await agl()), wallToReach: Date.now() - t0 });
    for (const view of views) {
      if (!(await setView(view))) continue;
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${shotDir}\\${label}-${String(alt / 1000).padStart(2, '0')}km-${view}.jpg`, type: 'jpeg', quality: 88 });
    }
    await setView('chase');
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__flight.paused = false; });
    console.log(`== ${alt} ${JSON.stringify(cp)}`);
  }
} catch (e) {
  console.log(`!! ${e.message}`);
  await page.screenshot({ path: `${shotDir}\\${label}-FAIL.png` }).catch(() => {});
}
out.errors = errors.slice(0, 8);
console.log(JSON.stringify(out.errors));
writeFileSync(`${shotDir}\\${label}.json`, JSON.stringify(out, null, 2));
await context.close();
await browser.close().catch(() => {});
process.exit(0);
