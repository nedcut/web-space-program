// Fixed-viewpoint screenshots for the "sense of place" pass (WP5) on the real-GPU Chrome (CDP 9333).
// Windows Node + playwright-core, like gpu-passes.mjs. From WSL (inside the shared GPU lock):
//   cp scripts/bench/wp5-shots.mjs /mnt/c/wsp-tools/drv/ && cd /mnt/c/wsp-tools/drv && \
//   flock /tmp/wsp-gpu.lock /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\wp5-shots.mjs' \
//     --base http://<wsl-ip>:5411 --label before [--cases pad,liftoff,low,moon3k,moon500,moon50,landed,backlit]
// Writes C:\wsp-tools\shots\wp5\<label>-<case>.png plus <label>.json (per-case stats, vessel luminance).
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = (args.base ?? 'http://localhost:5411').replace(/\/$/, '');
const label = args.label ?? 'run';
const quality = args.quality ?? 'medium';
const [vw, vh] = (args.size ?? '1600x900').split('x').map(Number);
const dpr = +(args.dpr ?? 1);
const shotDir = args.shotdir ?? 'C:\\wsp-tools\\shots\\wp5';
mkdirSync(shotDir, { recursive: true });
const PRESETS = {
  low: { shadows: false, bloom: false, clouds: false, renderScale: 0.5 },
  medium: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  high: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  ultra: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
};
const settings = { quality, ...PRESETS[quality], scatter: true, adaptiveQuality: false, graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0 };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 180000 });
const out = { label, base, quality, size: `${vw}x${vh}@${dpr}`, date: new Date().toISOString(), cases: {} };

// Camera: orbit target values (yaw/pitch rad, distance m) applied directly to the flight camera.
const cam = (yaw, pitch, dist) => `(() => { const c = window.__flight.cam; c.tYaw = c.cYaw = ${yaw}; c.tPitch = c.cPitch = ${pitch}; c.tDist = c.cDist = ${dist}; c.distanceSet = true; })()`;
const hideUi = `(() => { const s = document.createElement('style'); s.textContent = '.hud, .hud *, [class*="hud"], [class*="Hud"], .toast, [class*="toast"], [class*="Scenario"], [class*="scenario"], [class*="hint"], [class*="Hint"] { visibility: hidden !important; }'; document.head.appendChild(s); })()`;
// Mean luminance (0..1, sRGB) of the vessel's projected bounds, read from the screenshot later on the Node side.
const vesselRect = `(() => {
  const f = window.__flight, v = f.world.active.state, c = f.cam.camera, r = v.cache.boundingRadius;
  const corners = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = c.position.clone().set(sx * r * 0.6, sy * r * 0.6, sz * r * 0.6).project(c); corners.push(p); }
  const xs = corners.map(p => (p.x + 1) / 2 * innerWidth), ys = corners.map(p => (1 - p.y) / 2 * innerHeight);
  return [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(innerWidth, Math.max(...xs)), Math.min(innerHeight, Math.max(...ys))];
})()`;

const stage = async (page) => { await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space'); };
const CASES = {
  pad: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.8, 0.12, 70)); }, wait: 6000 },
  padTrench: { url: '/?flight=stock-kestrel', setup: async (p) => { await p.evaluate(cam(Math.PI * 1.05, 0.5, 55)); }, wait: 6000 },
  liftoff: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.8, 0.12, 90)); await p.waitForTimeout(3000); await stage(p); }, wait: 4500 },
  low: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.8, 0.2, 120)); await p.waitForTimeout(3000); await stage(p); await p.waitForTimeout(9000); await p.evaluate(cam(Math.PI * 0.8, 0.55, 220)); }, wait: 2500 },
  moon3k: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.75, 0.35, 30)); }, wait: 2500 },
  moon500: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(() => { window.__flight.input.state.throttle = 0; }); await p.evaluate(cam(Math.PI * 0.75, 0.45, 30)); await p.waitForFunction(() => { const f = window.__flight; return f.world.universe.surfaceInfo(f.world.active.body, f.world.active.state.position, f.world.ut).heightAboveTerrain < 700; }, null, { timeout: 120000, polling: 50 }); await p.evaluate(() => { window.__flight.input.state.throttle = 1; }); }, wait: 300 },
  moon50: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.75, 0.3, 25)); await p.evaluate(() => { const f = window.__flight; window.__wp5land = setInterval(() => { const w = f.world, v = w.active.state, b = w.universe.ephem.getBodyState(w.active.body, w.ut); const r = [v.position.x - b.position.x, v.position.y - b.position.y, v.position.z - b.position.z], l = Math.hypot(...r); const vs = ((v.velocity.x - b.velocity.x) * r[0] + (v.velocity.y - b.velocity.y) * r[1] + (v.velocity.z - b.velocity.z) * r[2]) / l; const h = w.universe.surfaceInfo(w.active.body, v.position, w.ut).heightAboveTerrain; const target = -Math.min(40, Math.max(3, h * 0.12)); f.input.state.throttle = h > 1500 ? 0 : Math.max(0, Math.min(1, 0.35 + (target - vs) * 0.25)); }, 50); }); await p.waitForFunction(() => { const f = window.__flight; return f.world.universe.surfaceInfo(f.world.active.body, f.world.active.state.position, f.world.ut).heightAboveTerrain < 60; }, null, { timeout: 180000, polling: 50 }); }, wait: 200 },
  // Camera → vessel → Sun, with the Sun ~25° off the view axis (the vessel is backlit, glare stays off-centre).
  backlit: { url: '/?flight=stock-kestrel&scenario=orbit', setup: async (p) => { await p.evaluate(async () => {
    const f = window.__flight, c = f.cam, frame = () => new Promise((r) => requestAnimationFrame(r));
    const s = f.world.universe.ephem.getBodyState('sun', f.world.ut).position, v = f.world.active.state.position;
    const d = Math.hypot(s.x - v.x, s.y - v.y, s.z - v.z), sun = [(s.x - v.x) / d, (s.y - v.y) / d, (s.z - v.z) / d];
    let best = null;
    for (let i = 0; i < 24; i++) for (const pitch of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const yaw = (i / 24) * Math.PI * 2; c.tYaw = c.cYaw = yaw; c.tPitch = c.cPitch = pitch; c.tDist = c.cDist = 30; c.distanceSet = true;
      await frame(); await frame();
      const w = c.camera.getWorldDirection(c.camera.position.clone());
      const k = Math.abs(w.x * sun[0] + w.y * sun[1] + w.z * sun[2] - 0.96);
      if (!best || k < best.k) best = { k, yaw, pitch };
    }
    c.tYaw = c.cYaw = best.yaw; c.tPitch = c.cPitch = best.pitch;
  }); }, wait: 3000 },
};
const cases = (args.cases ?? 'pad,padTrench,liftoff,low,moon3k,moon500,moon50,backlit').split(',');
for (const name of cases) {
  const def = CASES[name];
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  await context.addInitScript((s) => { localStorage.setItem('wsp.settings.v1', JSON.stringify(s)); localStorage.setItem('wsp.help.seen.v1', '1'); }, settings);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  try {
    await page.goto(base + def.url);
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(4000);
    await def.setup(page);
    await page.waitForTimeout(def.wait);
    if (args.ui !== '1') await page.evaluate(hideUi);
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const f = window.__flight, wv = f.world.active, p = f.pipeline;
      const s = f.world.universe.surfaceInfo(wv.body, wv.state.position, f.world.ut);
      return { body: wv.body, mode: wv.mode, alt: Math.round(s.heightAboveTerrain), stats: { ...p.stats }, glError: p.renderer.getContext().getError() };
    });
    info.rect = await page.evaluate(vesselRect);
    const file = `${shotDir}\\${label}-${name}.png`;
    await page.screenshot({ path: file });
    if (name === 'backlit') {
      // Mean sRGB luminance of the vessel's screen bounds (central 60 % of its bounding box).
      info.vesselLuma = await page.evaluate(([x0, y0, x1, y1]) => new Promise((res) => {
        const f = window.__flight, gl = f.pipeline.renderer.getContext();
        requestAnimationFrame(() => {
          const s = devicePixelRatio, w = Math.max(1, Math.round((x1 - x0) * s)), h = Math.max(1, Math.round((y1 - y0) * s));
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(Math.round(x0 * s), Math.round(gl.drawingBufferHeight - y1 * s), w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let sum = 0, n = 0; for (let i = 0; i < px.length; i += 4) { const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; if (l > 0.004) { sum += l; n++; } }
          res({ mean: n ? sum / n : 0, lit: n, pixels: w * h });
        });
      }), info.rect);
    }
    info.errors = errors.slice(0, 5);
    out.cases[name] = info;
    console.log(`== ${name}: ${JSON.stringify(info)}`);
  } catch (e) {
    await page.screenshot({ path: `${shotDir}\\${label}-${name}-FAIL.png` }).catch(() => {});
    console.log(`!! ${name}: ${e.message} ${JSON.stringify(errors.slice(0, 3))}`);
    out.cases[name] = { error: e.message, errors };
  } finally { await context.close(); }
}
writeFileSync(`${shotDir}\\${label}.json`, JSON.stringify(out, null, 2));
await browser.close().catch(() => {});
process.exit(0);
