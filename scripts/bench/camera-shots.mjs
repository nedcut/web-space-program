// Flight-camera framing shots on the real-GPU Chrome (CDP 9333), HUD visible. Windows Node + playwright-core.
//   cp scripts/bench/camera-shots.mjs /mnt/c/wsp-tools/drv/ && cd /mnt/c/wsp-tools/drv && \
//   flock /tmp/wsp-gpu.lock timeout 600 /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\camera-shots.mjs' \
//     --base http://<wsl-ip>:5531 --label before [--tower 1] [--seq 1]
// Writes C:\wsp-tools\shots\camera\<label>-{pad,t10,maxq}.png, an optional liftoff frame sequence and <label>.json.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base.replace(/\/$/, '');
const label = args.label ?? 'run';
const [vw, vh] = (args.size ?? '1600x900').split('x').map(Number);
const shotDir = args.shotdir ?? 'C:\\wsp-tools\\shots\\camera';
mkdirSync(shotDir, { recursive: true });
const settings = { quality: 'medium', shadows: true, bloom: true, clouds: true, renderScale: 1, scatter: true, adaptiveQuality: false, graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0, flightHints: false };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 180000 });
const out = { label, base, size: `${vw}x${vh}`, date: new Date().toISOString(), shots: {}, frames: {} };
const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, serviceWorkers: 'block' });
await context.addInitScript((s) => { localStorage.setItem('wsp.settings.v1', JSON.stringify(s)); localStorage.setItem('wsp.help.seen.v1', '1'); }, settings);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const state = () => page.evaluate(() => {
  const f = window.__flight, wv = f.world.active, tel = wv.state.telemetry, c = f.cam.camera;
  const p = new c.position.constructor(0, 0, 0).project(c);
  return { met: +(f.world.ut - (window.__t0 ?? f.world.ut)).toFixed(1), agl: Math.round(tel.altitudeAGL), q: Math.round(tel.dynamicPressure), mode: f.cam.mode, fov: +c.fov.toFixed(2), dist: +f.cam.distance.toFixed(1), vesselScreenY: +((1 - p.y) / 2).toFixed(3) };
});
// rAF interval stats over `ms` (vsync-bound; a regression would show as missed frames / a higher p95).
const frames = (ms) => page.evaluate((ms) => new Promise((res) => {
  const d = []; let last = performance.now(); const end = last + ms;
  const tick = (now) => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); res({ n: d.length, mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2) }); } };
  requestAnimationFrame(tick);
}), ms);
const shot = async (name) => { const s = await state(); out.shots[name] = s; await page.screenshot({ path: `${shotDir}\\${label}-${name}.png` }); console.log(`== ${name} ${JSON.stringify(s)}`); };
try {
  await page.goto(base + '/?flight=stock-meridian');
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(6000);
  if (args.tower) {
    for (let i = 0; i < 8 && (await page.evaluate(() => window.__flight.cam.mode)) !== 'tower'; i++) await page.evaluate(() => window.__flight.cycleCameraMode());
    await page.waitForTimeout(1500);
  }
  await shot('pad');
  out.frames.pad = await frames(4000);
  await page.mouse.move(vw / 2, 80);
  await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space');
  await page.evaluate(() => { window.__t0 = window.__flight.world.ut; });
  if (args.seq) {
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${shotDir}\\${label}-seq-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 80 });
    }
  }
  await page.waitForFunction(() => window.__flight.world.ut - window.__t0 >= 10, null, { timeout: 60000, polling: 50 });
  await shot('t10');
  out.frames.ascent = await frames(4000);
  // Max-Q: first time q falls 2 % below its running peak.
  await page.evaluate(() => { window.__qpk = 0; });
  await page.waitForFunction(() => { const q = window.__flight.world.active.state.telemetry.dynamicPressure; window.__qpk = Math.max(window.__qpk, q); return window.__qpk > 5000 && q < window.__qpk * 0.98; }, null, { timeout: 180000, polling: 100 });
  await shot('maxq');
} catch (e) {
  console.log(`!! ${e.message}`);
  await page.screenshot({ path: `${shotDir}\\${label}-FAIL.png` }).catch(() => {});
}
out.errors = errors.slice(0, 8);
console.log(JSON.stringify(out.frames), JSON.stringify(out.errors));
writeFileSync(`${shotDir}\\${label}.json`, JSON.stringify(out, null, 2));
await context.close();
await browser.close().catch(() => {});
process.exit(0);
