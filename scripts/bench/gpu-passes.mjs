// Per-pass / per-material-family GPU cost on the real-GPU Chrome (Windows Node + playwright-core, CDP 9333).
// For every case it measures, after settling:
//   - loop: rAF fps and the pipeline's smoothed GPU timer while the game runs normally;
//   - passes: hardware elapsed queries around each composer pass (median per pass, running loop);
//   - fenced: whole-frame throughput, N renders between two readPixels syncs (median of 5) — the number that
//     scales to a weaker GPU, independent of vsync and compositor;
//   - families (--families 1): fenced cost difference with one material family hidden;
//   - a screenshot at device resolution.
// From WSL (wrap in the shared GPU lock):
//   flock /tmp/wsp-gpu.lock scripts/bench/gpu-passes.sh --base http://<ip>:5332 --label base-medium \
//     --quality medium --cases pad,ascent,orbit,map,moon,editor [--families 1] [--settings '{...}']
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = (args.base ?? 'http://localhost:5332').replace(/\/$/, '');
const label = args.label ?? 'run';
const dpr = +(args.dpr ?? 2);
const quality = args.quality ?? 'medium';
const settleMs = +(args.settle ?? 12000);
const families = args.families === '1';
const shots = args.shots !== '0';
// --eval <file.js>: evaluate an expression (may return a promise) after settling, instead of measuring.
// --query <k=v&…>: extra URL parameters for every case (e.g. experiment flags).
const extraQuery = args.query ?? '';
// --pre <expression>: evaluated in the page after settling, before measuring (e.g. set a uniform).
const preJs = args.pre ?? null;
const evalSrc = args.eval ? readFileSync(args.eval, 'utf8') : null;
const [vw, vh] = (args.size ?? '1470x920').split('x').map(Number);
const outDir = args.out ?? 'C:\\wsp-tools\\bench\\perfgpu';
const shotDir = args.shotdir ?? 'C:\\wsp-tools\\shots\\perfgpu';
mkdirSync(outDir, { recursive: true }); mkdirSync(shotDir, { recursive: true });
const cases = (args.cases ?? 'pad,ascent,orbit,map,moon,editor').split(',');
const PRESETS = {
  low: { shadows: false, bloom: false, clouds: false, renderScale: 0.5 },
  medium: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  high: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
  ultra: { shadows: true, bloom: true, clouds: true, renderScale: 1 },
};
const settings = { quality, ...PRESETS[quality], scatter: true, adaptiveQuality: args.adaptive === '1', graphicsProfile: 99, showFps: false, autoSaveInterval: 0, masterVolume: 0, ...(args.settings ? JSON.parse(args.settings) : {}) };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 180000 });
const results = { label, base, dpr, quality, settings, size: `${vw}x${vh}`, date: new Date().toISOString(), cases: {} };
const log = (...a) => console.log(...a);

function init(s) {
  localStorage.setItem('wsp.settings.v1', JSON.stringify(s));
  localStorage.setItem('wsp.help.seen.v1', '1');
}

// In-page measurement. `mode` is 'flight' | 'map' | 'editor'.
async function pageMeasure({ mode, families }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const r2 = (v) => Math.round(v * 1000) / 1000;
  const f = window.__flight, ed = window.__editor?.view;
  const p = f?.pipeline;
  const renderer = p ? p.renderer : ed.renderer;
  const gl = renderer.getContext();
  const out = { mode };
  if (f) {
    const planets = [];
    f.scene.traverse((o) => {
      const planet = o.userData.planet;
      if (planet) planets.push({ body: planet.body.id, idle: planet.idle, stats: { ...planet.stats }, imagery: o.userData.imagery?.levelId });
    });
    out.sceneState = { paused: f.paused, ut: f.world.ut, planets };
  }
  // Loop pacing over 4 s.
  out.loopFps = await new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res(r2((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(tick); });
  if (p) { out.loopGpuMs = r2(p.gpuMs); out.canvas = [renderer.domElement.width, renderer.domElement.height]; out.pixelRatio = r2(p.pixelRatio); out.stats = { ...p.stats }; }
  else { out.canvas = [renderer.domElement.width, renderer.domElement.height]; out.pixelRatio = renderer.getPixelRatio(); }
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  // Per-pass elapsed queries in the running loop.
  if (p && mode === 'flight' && ext) {
    const pending = [], samples = {}, originals = [];
    const poll = () => {
      for (let i = pending.length - 1; i >= 0; i--) {
        const [q, name] = pending[i];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
        (samples[name] ??= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); pending.splice(i, 1);
      }
    };
    const timer = p.gpuTimer; p.gpuTimer = null;
    for (const [i, pass] of p.composer.passes.entries()) {
      const render = pass.render;
      const x = pass.inner ?? pass; // pipeline wraps HDR-stage passes
      const name = x === p.renderPass ? 'scene' : x === p.bloomPass ? 'bloom' : x === p.smaaPass ? 'smaa' : x === p.fxaaPass ? 'fxaa' : x === p.photoEffects ? 'photo' : x === p.upscalePass ? 'upscale' : x.isOutputPass ? 'tonemap' : (x.constructor?.name || 'pass') + '-' + i;
      originals.push([pass, render]);
      pass.render = function (...a) { poll(); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); const r = render.apply(this, a); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push([q, name]); return r; };
    }
    await sleep(3000);
    for (const [pass, render] of originals) pass.render = render;
    await sleep(300); poll(); for (const [q] of pending) gl.deleteQuery(q);
    p.gpuTimer = timer;
    out.passes = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, r2(med(v.slice(10)))]));
  }
  // Fenced throughput.
  const px = new Uint8Array(4);
  const scene = mode === 'editor' ? ed.scene : mode === 'map' ? f.map.scene : f.scene;
  const cam = mode === 'editor' ? ed.camera : mode === 'map' ? f.map.camera : f.cam.camera;
  const draw = mode === 'editor' ? () => renderer.render(scene, cam) : mode === 'map' ? () => p.renderMap(scene, cam) : () => p.render(scene, cam);
  // One elapsed query spans the whole batch (the pipeline's own timer is parked: queries cannot nest).
  const bench = async (n = 20) => {
    draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const q = ext ? gl.createQuery() : null; if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t0 = performance.now(); for (let i = 0; i < n; i++) draw();
    if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const wall = (performance.now() - t0) / n;
    let gpu = NaN;
    if (q) { for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5); if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n; gl.deleteQuery(q); }
    return [gpu, wall];
  };
  const parked = p?.gpuTimer; if (p) p.gpuTimer = null;
  const fenced = async () => { const a = []; for (let i = 0; i < 5; i++) a.push(await bench()); const g = med(a.map((x) => x[0])); const w = med(a.map((x) => x[1])); return r2(Number.isFinite(g) ? g : w); };
  out.fencedWall = r2(med([(await bench())[1], (await bench())[1], (await bench())[1]]));
  out.fenced = await fenced();
  if (families && mode === 'flight') {
    const d = (v) => r2(out.fenced - v);
    const fam = {};
    for (const [k, pass] of [['bloom', p.bloomPass], ['smaa', p.smaaPass]]) if (pass) { pass.enabled = false; fam[k] = d(await fenced()); pass.enabled = true; }
    const sm = renderer.shadowMap; const au = sm.autoUpdate; sm.autoUpdate = false; fam.shadowMap = d(await fenced()); sm.autoUpdate = au;
    const mats = new Set(); scene.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x && mats.add(x)); });
    const U = (m) => m.uniforms ?? {};
    const key = (m) => String(m.customProgramCacheKey?.() ?? '');
    const groups = {
      terrain: (m) => U(m).uRockColor, ocean: (m) => U(m).uSeabed, farSphere: (m) => U(m).uHasMap && U(m).uFallback,
      sky: (m) => U(m).uSunAngularRadius, clouds: (m) => U(m).uCamCCloud, volumes: (m) => U(m).uExtent, scatter: (m) => U(m).uCenters,
      vegetation: (m) => key(m).includes('foliage'),
      siteAerial: (m) => key(m).includes('aerial'),
      partsPBR: (m) => m.isMeshStandardMaterial || m.isMeshPhysicalMaterial,
      plumes: (m) => U(m).uCoreAmp || U(m).uHaze || U(m).uDiaWidth,
      stars: (m) => U(m).uGC || /star|milky/i.test(m.name ?? ''), glare: (m) => U(m).uAspect && U(m).uSun,
      basic: (m) => m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isLineBasicMaterial || m.isPointsMaterial,
    };
    const claimed = new Set(); const counts = {};
    for (const [k, pred] of Object.entries(groups)) {
      const ms = [...mats].filter((m) => !claimed.has(m) && pred(m)); ms.forEach((m) => claimed.add(m));
      if (!ms.length) continue; counts[k] = ms.length; ms.forEach((m) => (m.visible = false)); fam[k] = d(await fenced()); ms.forEach((m) => (m.visible = true));
    }
    const rest = [...mats].filter((m) => !claimed.has(m));
    if (rest.length) { rest.forEach((m) => (m.visible = false)); fam.other = d(await fenced()); rest.forEach((m) => (m.visible = true)); out.otherNames = [...new Set(rest.map((m) => (m.name || m.type) + ':' + Object.keys(U(m)).slice(0, 4).join('/')))].slice(0, 20); }
    [...mats].forEach((m) => (m.visible = false)); fam.emptyScene = await fenced(); [...mats].forEach((m) => (m.visible = true));
    out.families = fam; out.familyCounts = counts;
  }
  if (p) p.gpuTimer = parked;
  out.glError = gl.getError();
  return out;
}

async function run(name, url, { setup, mode = 'flight', settle = settleMs } = {}) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  await context.addInitScript(init, settings);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  try {
    await page.goto(base + url + (extraQuery ? (url.includes('?') ? '&' : '?') + extraQuery : ''));
    if (mode === 'editor') await page.waitForFunction(() => !!(window.__editor?.view && window.__editor.session), null, { timeout: 90000 });
    else if (mode === 'page') await page.waitForSelector('canvas', { timeout: 60000 });
    else await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 200 });
    if (setup) await setup(page);
    await page.waitForTimeout(settle);
    if (mode === 'editor') {
      // Keep the editor rendering continuously while measuring (camera orbit).
      await page.evaluate(() => { const v = window.__editor.view; window.__edSpin = setInterval(() => { v.gYaw = (v.gYaw ?? 0) + 0.002; }, 16); });
    }
    if (mode === 'page') {
      // Smoke-only scenes: canvases, console errors and a screenshot.
      const canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => [c.width, c.height, c.clientWidth, c.clientHeight]));
      if (shots) await page.screenshot({ path: `${shotDir}\\${label}-${name}.png` });
      results.cases[name] = { canvases, errors: errors.slice(0, 5) };
      log(`== ${name}: canvases ${JSON.stringify(canvases)} errors ${JSON.stringify(errors.slice(0, 3))}`);
      return;
    }
    if (preJs) { await page.evaluate(preJs); await page.waitForTimeout(500); }
    if (evalSrc) { const r = await page.evaluate(evalSrc); log(`== ${name}: ${JSON.stringify(r)}`); results.cases[name] = r; return; }
    const m = await page.evaluate(pageMeasure, { mode, families });
    if (mode === 'editor') await page.evaluate(() => clearInterval(window.__edSpin));
    if (shots) {
      await page.waitForTimeout(500);
      const file = `${shotDir}\\${label}-${name}.png`;
      await page.screenshot({ path: file });
      m.shot = file;
    }
    m.errors = errors.slice(0, 5);
    results.cases[name] = m;
    log(`== ${name}: fenced gpu ${m.fenced} ms (wall ${m.fencedWall}), loop ${m.loopFps} fps gpu ${m.loopGpuMs} canvas ${m.canvas} pr ${m.pixelRatio} passes ${JSON.stringify(m.passes ?? {})}`);
    if (m.families) log(`   families ${JSON.stringify(m.families)}`);
    if (m.stats) log(`   stats ${JSON.stringify(m.stats)}`);
    if (errors.length) log(`   errors ${JSON.stringify(errors.slice(0, 3))}`);
  } catch (e) {
    const state = await page.evaluate(() => ({ flight: !!window.__flight, loading: document.querySelector('.loading-screen')?.textContent?.slice(0, 200) })).catch(() => null);
    await page.screenshot({ path: `${shotDir}\\${label}-${name}-FAIL.png` }).catch(() => {});
    log(`!! ${name} failed: ${e.message} ${JSON.stringify(state)} ${JSON.stringify(errors.slice(0, 3))}`); results.cases[name] = { error: e.message, errors, state };
  }
  finally { await context.close(); }
}

const ascentSetup = async (page) => {
  await page.keyboard.press('KeyT'); await page.keyboard.press('KeyZ'); await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__flight.world.warp = { mode: 'physics', index: 3 }; });
};
for (const c of cases) {
  if (c === 'pad') await run('pad', '/?flight=stock-kestrel');
  else if (c === 'ascent') await run('ascent', '/?flight=stock-meridian', { setup: ascentSetup, settle: 9000 });
  else if (c === 'orbit') await run('orbit', '/?flight=stock-kestrel&scenario=orbit');
  else if (c === 'map') await run('map', '/?flight=stock-kestrel&scenario=orbit', { mode: 'map', setup: async (page) => { await page.evaluate(() => window.__flight.toggleMap()); } });
  else if (c === 'moon') await run('moon', '/?mission=suicide-burn', { setup: async (page) => { await page.evaluate(() => { window.__flight.input.state.throttle = 0.35; }); }, settle: 4000 });
  else if (c === 'sea') await run('sea', '/?flight=stock-kestrel&scenario=sea');
  else if (c === 'menu') await run('menu', '/', { mode: 'page', settle: 6000 });
  else if (c === 'spaceCenter' || c === 'tracking') await run(c, `/?scene=${c}`, { mode: 'page', settle: 8000 });
  else if (c === 'editor') await run('editor', '/?scene=editor&stock=stock-ringrunner-real', { mode: 'editor', settle: 4000 });
}
const file = `${outDir}\\${label}.json`;
writeFileSync(file, JSON.stringify(results, null, 2));
log(`wrote ${file}`);
await browser.close().catch(() => {});
process.exit(0);
