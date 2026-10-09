// Moon day-side regolith tiling check (moontile) on the real-GPU Chrome (CDP 9333): screenshots at ~8 km, ~2 km and
// ~200 m over the terrain, plus fenced GPU frame time (20 renders, median of 5) per case and optional shader variant.
// Windows Node + playwright-core, like wp5-shots.mjs. From WSL:
//   cp scripts/bench/moontile-shots.mjs /mnt/c/wsp-tools/drv/ && cd /mnt/c/wsp-tools/drv && \
//   flock /tmp/wsp-gpu.lock timeout 900 /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\moontile-shots.mjs' \
//     --base http://<wsl-ip>:5531 --label before [--quality medium] [--cases d8k,d2k,d200,earth] [--variants C:\...\v.json]
// Variants: JSON [{ "name": "...", "patch": [["from", "to"], ...] }] applied as string replacements to the terrain
// shader (materials with uDetailTex + uRockBlend) before the screenshot; "base" (no patch) always runs first.
// Writes C:\wsp-tools\shots\moontile\<label>-<case>-<variant>.png plus <label>.json.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = (args.base ?? 'http://localhost:5531').replace(/\/$/, '');
const label = args.label ?? 'run';
const quality = args.quality ?? 'medium';
const [vw, vh] = (args.size ?? '1600x900').split('x').map(Number);
const shotDir = args.shotdir ?? 'C:\\wsp-tools\\shots\\moontile';
mkdirSync(shotDir, { recursive: true });
const PRESETS = {
  low: { shadows: false, bloom: false, clouds: false, renderScale: 0.5 },
  medium: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  high: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  ultra: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
};
const settings = { quality, ...PRESETS[quality], scatter: true, adaptiveQuality: false, graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0 };
const variants = [{ name: 'base', patch: [] }, ...(args.variants ? JSON.parse(readFileSync(args.variants, 'utf8')) : [])];
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 180000 });
const out = { label, base, quality, size: `${vw}x${vh}`, date: new Date().toISOString(), cases: {} };

const cam = (yaw, pitch, dist) => `(() => { const c = window.__flight.cam; c.tYaw = c.cYaw = ${yaw}; c.tPitch = c.cPitch = ${pitch}; c.tDist = c.cDist = ${dist}; c.distanceSet = true; })()`;
const hideUi = `(() => { const s = document.createElement('style'); s.textContent = '.hud, .hud *, [class*="hud"], [class*="Hud"], .toast, [class*="toast"], [class*="Scenario"], [class*="scenario"], [class*="hint"], [class*="Hint"] { visibility: hidden !important; }'; document.head.appendChild(s); })()`;

// Day side of the Moon, Sun ~53° high, `-alt` metres above the local terrain, then the simulation is paused so the
// vessel holds still (orbital speed would carry it into the terrain at 200 m).
const placeDay = (alt) => {
  const w = window.__flight.world, u = w.universe, v = w.active.state;
  const m = u.ephem.getBodyState('moon', w.ut), e = u.ephem.getBodyState('earth', w.ut), s = u.ephem.getBodyState('sun', w.ut), b = u.body('moon');
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((x) => x / l); };
  const toE = unit([e.position.x - m.position.x, e.position.y - m.position.y, e.position.z - m.position.z]);
  const toS = unit([s.position.x - m.position.x, s.position.y - m.position.y, s.position.z - m.position.z]);
  const eS = toE[0] * toS[0] + toE[1] * toS[1] + toE[2] * toS[2], perp = unit(toE.map((x, i) => x - eS * toS[i]));
  const up = unit(perp.map((x, i) => 0.6 * x + 0.8 * toS[i]));
  const east = unit([up[1] * toS[2] - up[2] * toS[1], up[2] * toS[0] - up[0] * toS[2], up[0] * toS[1] - up[1] * toS[0]]);
  let r = b.radius + alt;
  const put = () => { v.position = { x: m.position.x + up[0] * r, y: m.position.y + up[1] * r, z: m.position.z + up[2] * r }; };
  put();
  for (let i = 0; i < 4; i++) { r += alt - u.surfaceInfo('moon', v.position, w.ut).heightAboveTerrain; put(); }
  const vc = Math.sqrt(b.gm / r);
  v.velocity = { x: m.velocity.x + east[0] * vc, y: m.velocity.y + east[1] * vc, z: m.velocity.z + east[2] * vc };
  window.__flight.paused = true;
};
const CASES = {
  d8k: { url: '/?flight=stock-kestrel&scenario=moon', alt: 8000, cam: [Math.PI * 0.75, 0.6, 40] },
  d2k: { url: '/?flight=stock-kestrel&scenario=moon', alt: 2000, cam: [Math.PI * 0.75, 0.7, 40] },
  d200: { url: '/?flight=stock-kestrel&scenario=moon', alt: 200, cam: [Math.PI * 0.75, 0.8, 30] },
  d40: { url: '/?flight=stock-kestrel&scenario=moon', alt: 40, cam: [Math.PI * 0.75, 0.5, 30] },
  // Earth from the pad and low ascent: detail-texture regression check.
  earthPad: { url: '/?flight=stock-meridian', cam: [Math.PI * 0.8, 0.12, 70] },
  earthHigh: { url: '/?flight=stock-meridian', earthAlt: 3000, cam: [Math.PI * 0.8, 0.5, 60] },
};

// Fenced GPU time of one full frame (pipeline.render), 20 renders per query, median of 5.
const timeGpu = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const f = window.__flight, p = f.pipeline, gl = p.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const sc = f.scene, cam = f.cam.camera, px = new Uint8Array(4);
  const parked = p.gpuTimer; p.gpuTimer = null;
  const bench = async () => {
    p.render(sc, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < 20; i++) p.render(sc, cam);
    gl.endQuery(ext.TIME_ELAPSED_EXT); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5);
    const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 20; gl.deleteQuery(q); return v;
  };
  for (let i = 0; i < 3; i++) p.render(sc, cam);
  await sleep(50);
  const a = []; for (let i = 0; i < 7; i++) a.push(await bench());
  p.gpuTimer = parked;
  return +med(a).toFixed(3);
};
const applyPatch = (patch) => {
  const f = window.__flight, mats = new Set();
  f.scene.traverse((o) => { const m = o.material; if (m?.uniforms?.uDetailTex && m.uniforms.uRockBlend) mats.add(m); });
  let hits = 0;
  for (const m of mats) {
    m.__orig ??= { v: m.vertexShader, f: m.fragmentShader };
    let v = m.__orig.v, fr = m.__orig.f;
    for (const [a, b] of patch) { if (v.includes(a)) hits++; if (fr.includes(a)) hits++; v = v.split(a).join(b); fr = fr.split(a).join(b); }
    m.vertexShader = v; m.fragmentShader = fr; m.needsUpdate = true;
  }
  return { mats: mats.size, hits };
};

const cases = (args.cases ?? 'd8k,d2k,d200').split(',');
for (const name of cases) {
  const def = CASES[name];
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.addInitScript((s) => { localStorage.setItem('wsp.settings.v1', JSON.stringify(s)); localStorage.setItem('wsp.help.seen.v1', '1'); }, settings);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  out.cases[name] = {};
  try {
    await page.goto(base + def.url);
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(4000);
    if (def.alt) await page.evaluate(placeDay, def.alt);
    if (def.earthAlt) await page.evaluate((h) => { const f = window.__flight, w = f.world, v = w.active.state, b = w.universe.ephem.getBodyState(w.active.body, w.ut).position;
      const r = [v.position.x - b.x, v.position.y - b.y, v.position.z - b.z], l = Math.hypot(...r); const k = (l + h) / l;
      v.position = { x: b.x + r[0] * k, y: b.y + r[1] * k, z: b.z + r[2] * k }; f.paused = true; }, def.earthAlt);
    await page.evaluate(cam(...def.cam));
    await page.waitForTimeout(9000);
    await page.evaluate(hideUi);
    for (const vr of variants) {
      const ph = await page.evaluate(applyPatch, vr.patch);
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => { const f = window.__flight, wv = f.world.active;
        return { alt: Math.round(f.world.universe.surfaceInfo(wv.body, wv.state.position, f.world.ut).heightAboveTerrain), calls: f.pipeline.stats.calls }; });
      info.patch = ph;
      await page.screenshot({ path: `${shotDir}\\${label}-${name}-${vr.name}.png` });
      if (args.time !== '0') info.gpuMs = await page.evaluate(timeGpu);
      info.errors = errors.slice(0, 3);
      out.cases[name][vr.name] = info;
      console.log(`== ${name}/${vr.name}: ${JSON.stringify(info)}`);
    }
  } catch (e) {
    await page.screenshot({ path: `${shotDir}\\${label}-${name}-FAIL.png` }).catch(() => {});
    console.log(`!! ${name}: ${e.message} ${JSON.stringify(errors.slice(0, 3))}`);
    out.cases[name].error = e.message;
  } finally { await context.close(); }
}
writeFileSync(`${shotDir}\\${label}.json`, JSON.stringify(out, null, 2));
await browser.close().catch(() => {});
process.exit(0);
