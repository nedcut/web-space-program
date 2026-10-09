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

// Puts the active vessel in a circular orbit over the Moon's night side (Sun 37° below the horizon), under the Earth. alt > 0: height above
// the mean radius; alt < 0: -alt above the local terrain. { alt, day: true }: the same orbit on the day side, Sun ~53° high.
const placeNight = (arg) => {
  const alt = typeof arg === 'number' ? arg : arg.alt, day = typeof arg === 'object' && arg.day;
  const w = window.__flight.world, u = w.universe, v = w.active.state;
  // Shift the clock to the nearest date within ±16 d with a nearly full Earth over the night side (Sun–Moon–Earth
  // angle ~25°, i.e. near new Moon), so the earthshine is near its strongest.
  const phaseAt = (t) => { const mm = u.ephem.getBodyState('moon', t).position, ee = u.ephem.getBodyState('earth', t).position, ss = u.ephem.getBodyState('sun', t).position;
    const a = [ee.x - mm.x, ee.y - mm.y, ee.z - mm.z], b = [ss.x - mm.x, ss.y - mm.y, ss.z - mm.z];
    return Math.acos(-(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)) * 57.3; };
  let bestT = w.ut, bestK = Infinity;
  for (let dd = -16; dd <= 16; dd += 0.125) { const t = w.ut + dd * 86400, k = Math.abs(phaseAt(t) - 25); if (k < bestK) { bestK = k; bestT = t; } }
  w.ut = bestT;
  const m = u.ephem.getBodyState('moon', w.ut), e = u.ephem.getBodyState('earth', w.ut), s = u.ephem.getBodyState('sun', w.ut), b = u.body('moon');
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((x) => x / l); };
  const toE = unit([e.position.x - m.position.x, e.position.y - m.position.y, e.position.z - m.position.z]);
  const toS = unit([s.position.x - m.position.x, s.position.y - m.position.y, s.position.z - m.position.z]);
  // Sun 37° below the horizon (deep night), the Earth as high in the sky as that allows.
  const eS = toE[0] * toS[0] + toE[1] * toS[1] + toE[2] * toS[2], perp = unit(toE.map((x, i) => x - eS * toS[i]));
  const up = unit(perp.map((x, i) => day ? 0.6 * x + 0.8 * toS[i] : 0.8 * x - 0.6 * toS[i]));
  window.__wp5night = { sunElevDeg: Math.asin(up[0] * toS[0] + up[1] * toS[1] + up[2] * toS[2]) * 57.3, earthElevDeg: Math.asin(up[0] * toE[0] + up[1] * toE[1] + up[2] * toE[2]) * 57.3, earthPhaseDeg: Math.acos(-eS) * 57.3 };
  const east = unit([up[1] * toS[2] - up[2] * toS[1], up[2] * toS[0] - up[0] * toS[2], up[0] * toS[1] - up[1] * toS[0]]);
  let r = b.radius + Math.abs(alt);
  const put = () => { v.position = { x: m.position.x + up[0] * r, y: m.position.y + up[1] * r, z: m.position.z + up[2] * r }; };
  put();
  if (alt < 0) for (let i = 0; i < 4; i++) { r += -alt - u.surfaceInfo('moon', v.position, w.ut).heightAboveTerrain; put(); }
  const vc = Math.sqrt(b.gm / r);
  v.velocity = { x: m.velocity.x + east[0] * vc, y: m.velocity.y + east[1] * vc, z: m.velocity.z + east[2] * vc };
};
// Aims the flight camera so its view direction makes `cosDown` with straight down (searched over yaw/pitch).
const lookDown = async (cosDown) => {
  const f = window.__flight, c = f.cam, w = f.world, frame = () => new Promise((r) => requestAnimationFrame(r));
  const b = w.universe.ephem.getBodyState(w.active.body, w.ut).position, v = w.active.state.position;
  const l = Math.hypot(v.x - b.x, v.y - b.y, v.z - b.z), down = [(b.x - v.x) / l, (b.y - v.y) / l, (b.z - v.z) / l];
  let best = null;
  for (let i = 0; i < 24; i++) for (const pitch of [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2]) {
    const yaw = (i / 24) * Math.PI * 2; c.tYaw = c.cYaw = yaw; c.tPitch = c.cPitch = pitch; c.tDist = c.cDist = 40; c.distanceSet = true;
    await frame(); await frame();
    const d = c.camera.getWorldDirection(c.camera.position.clone());
    const k = Math.abs(d.x * down[0] + d.y * down[1] + d.z * down[2] - cosDown);
    if (!best || k < best.k) best = { k, yaw, pitch };
  }
  c.tYaw = c.cYaw = best.yaw; c.tPitch = c.cPitch = best.pitch;
};
const stage = async (page) => { await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space'); };
const CASES = {
  pad: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.8, 0.12, 70)); }, wait: 6000 },
  padTrench: { url: '/?flight=stock-kestrel', setup: async (p) => { await p.evaluate(cam(Math.PI * 1.05, 0.5, 55)); }, wait: 6000 },
  liftoff: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.8, 0.12, 90)); await p.waitForTimeout(3000); await stage(p); }, wait: 4500 },
  liftoffTrench: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 1.05, 0.35, 120)); await p.waitForTimeout(3000); await stage(p); }, wait: 5000 },
  low: { url: '/?flight=stock-meridian', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.8, 0.2, 120)); await p.waitForTimeout(3000); await stage(p); await p.waitForTimeout(9000); await p.evaluate(cam(Math.PI * 0.8, 0.55, 220)); }, wait: 2500 },
  moon3k: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.75, 0.35, 30)); }, wait: 2500 },
  moon500: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(() => { window.__flight.input.state.throttle = 0; }); await p.evaluate(cam(Math.PI * 0.75, 0.45, 30)); await p.waitForFunction(() => { const f = window.__flight; return f.world.universe.surfaceInfo(f.world.active.body, f.world.active.state.position, f.world.ut).heightAboveTerrain < 700; }, null, { timeout: 120000, polling: 50 }); await p.evaluate(() => { window.__flight.input.state.throttle = 1; }); }, wait: 300 },
  moon50: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.75, 0.3, 25)); await p.evaluate(() => { const f = window.__flight; window.__wp5land = setInterval(() => { const w = f.world, v = w.active.state, b = w.universe.ephem.getBodyState(w.active.body, w.ut); const r = [v.position.x - b.position.x, v.position.y - b.position.y, v.position.z - b.position.z], l = Math.hypot(...r); const vs = ((v.velocity.x - b.velocity.x) * r[0] + (v.velocity.y - b.velocity.y) * r[1] + (v.velocity.z - b.velocity.z) * r[2]) / l; const h = w.universe.surfaceInfo(w.active.body, v.position, w.ut).heightAboveTerrain; const target = -Math.min(40, Math.max(3, h * 0.12)); f.input.state.throttle = h > 1500 ? 0 : Math.max(0, Math.min(1, 0.35 + (target - vs) * 0.25)); }, 50); }); await p.waitForFunction(() => { const f = window.__flight; return f.world.universe.surfaceInfo(f.world.active.body, f.world.active.state.position, f.world.ut).heightAboveTerrain < 60; }, null, { timeout: 180000, polling: 50 }); }, wait: 200 },
  // Same descent, camera high above the lander looking down: its shadow on the ground.
  moonTop: { url: '/?mission=suicide-burn', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.75, 1.4, 45)); await p.evaluate(() => { const f = window.__flight; window.__wp5land = setInterval(() => { const w = f.world, v = w.active.state, b = w.universe.ephem.getBodyState(w.active.body, w.ut); const r = [v.position.x - b.position.x, v.position.y - b.position.y, v.position.z - b.position.z], l = Math.hypot(...r); const vs = ((v.velocity.x - b.velocity.x) * r[0] + (v.velocity.y - b.velocity.y) * r[1] + (v.velocity.z - b.velocity.z) * r[2]) / l; const h = w.universe.surfaceInfo(w.active.body, v.position, w.ut).heightAboveTerrain; const target = -Math.min(40, Math.max(3, h * 0.12)); f.input.state.throttle = h > 1500 ? 0 : Math.max(0, Math.min(1, 0.35 + (target - vs) * 0.25)); }, 50); }); await p.waitForFunction(() => { const f = window.__flight; return f.world.universe.surfaceInfo(f.world.active.body, f.world.active.state.position, f.world.ut).heightAboveTerrain < 60; }, null, { timeout: 180000, polling: 50 }); }, wait: 200 },
  // Moon night side under the Earth (earthshine): on the sub-Earth side turned away from the Sun, circular orbit.
  moonNight: { url: '/?flight=stock-kestrel&scenario=moon', setup: async (p) => { await p.evaluate(placeNight, 8000); await p.evaluate(cam(Math.PI * 0.75, 0.25, 40)); }, wait: 6000 },
  // Same, ~3 km above the local terrain, camera above the vessel looking down past it.
  moonNight3k: { url: '/?flight=stock-kestrel&scenario=moon', setup: async (p) => { await p.evaluate(placeNight, -3000); await p.evaluate(cam(Math.PI * 0.75, 0.6, 40)); }, wait: 6000 },
  // Same, 60 km lunar orbit.
  moonNightOrbit: { url: '/?flight=stock-kestrel&scenario=moon', setup: async (p) => { await p.evaluate(placeNight, 60000); await p.waitForTimeout(500); await p.evaluate(lookDown, 0.75); }, wait: 8000 },
  // Day-side counterparts: 8 km over the terrain and a 60 km lunar orbit with the Sun ~53° high.
  moonDay: { url: '/?flight=stock-kestrel&scenario=moon', setup: async (p) => { await p.evaluate(placeNight, { alt: -8000, day: true }); await p.evaluate(cam(Math.PI * 0.75, 0.6, 40)); }, wait: 6000 },
  moonDayOrbit: { url: '/?flight=stock-kestrel&scenario=moon', setup: async (p) => { await p.evaluate(placeNight, { alt: 60000, day: true }); await p.waitForTimeout(500); await p.evaluate(lookDown, 0.75); }, wait: 8000 },
  // 150 km orbit, looking down past the vessel at the coast below (stair-stepped coastline check).
  orbitDown: { url: '/?flight=stock-meridian&scenario=orbit', setup: async (p) => { await p.evaluate(cam(Math.PI * 0.5, 1.35, 60)); }, wait: 9000 },
  // Planet preview (same Earth materials as flight): 150 km over Florida looking down at the coast.
  coast: { url: '/planet-preview.html?body=earth&alt=150000&lat=26.5&lon=-80.6&head=0&pitch=-55&hour=13&ui=0', preview: true, setup: async () => {}, wait: 9000 },
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
    if (def.preview) {
      await page.waitForFunction(() => window.__preview?.ready, null, { timeout: 120000, polling: 200 });
      await page.waitForTimeout(def.wait);
      await page.screenshot({ path: `${shotDir}\\${label}-${name}.png` });
      out.cases[name] = { errors: errors.slice(0, 5) };
      console.log(`== ${name}: preview ${JSON.stringify(errors.slice(0, 3))}`);
      continue;
    }
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(4000);
    await def.setup(page);
    await page.waitForTimeout(def.wait);
    if (args.ui !== '1') await page.evaluate(hideUi);
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const f = window.__flight, wv = f.world.active, p = f.pipeline;
      const s = f.world.universe.surfaceInfo(wv.body, wv.state.position, f.world.ut);
      return { night: window.__wp5night, body: wv.body, mode: wv.mode, alt: Math.round(s.heightAboveTerrain), stats: { ...p.stats }, glError: p.renderer.getContext().getError() };
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
