// Cross-browser smoke test (Chromium, Firefox, WebKit as a Safari proxy) — see docs/BROWSERS.md.
//
//   npx playwright install chromium firefox webkit     # once (Linux also: sudo npx playwright install-deps)
//   npx vite --port 5328 --strictPort &                # or: npm run build && npx vite preview --port 5329 --strictPort &
//   node scripts/browser-smoke.mjs [--base http://localhost:5328] [--browsers chromium,firefox,webkit]
//        [--shots docs/screenshots/firefox] [--quality low] [--headed]
//
// Per browser: main menu → New Game (Sandbox) → Space Center → Vehicle Assembly → Launch → stage; then
// `?flight=stock-meridian&scenario=orbit` → map view → back. It clicks real buttons (audio unlocks the way
// it does for players) and fails on page errors, unhandled rejections, console errors, failed requests,
// unlinked WebGL programs (checked directly, so production builds without three's shader checks are covered)
// and WebGL error warnings. Headless Firefox has no WebGL on Linux: without a DISPLAY it runs headed under
// Xvfb (`xvfb-run`), so install `xvfb` there. Rendering is software (SwiftShader/llvmpipe): slow, not a benchmark.
import { chromium, firefox, webkit } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = (args.base ?? 'http://localhost:5328').replace(/\/$/, '');
const browsers = (args.browsers ?? 'chromium,firefox,webkit').split(',');
const shots = args.shots;
if (shots) mkdirSync(shots, { recursive: true });
const engines = { chromium, firefox, webkit };
const settings = { quality: args.quality ?? 'low', adaptiveQuality: false, graphicsProfile: 99, autoSaveInterval: 0 };

// Benign noise. Everything else logged as an error (or a WebGL error warning) fails the run.
const IGNORE = [/React DevTools/, /\[vite\]/, /KHR_parallel_shader_compile/, /lazy initialization/, /WEBGL_debug_renderer_info is deprecated/,
  /classified as a bounce tracker/, /favicon/];
const WEBGL_WARNING = /WebGL warning|GL_INVALID|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER)|GL ERROR/;

let xvfb;
function displayEnv() {
  if (process.env.DISPLAY || process.platform !== 'linux') return undefined;
  if (spawnSync('which', ['Xvfb']).status !== 0) throw new Error('Firefox needs a display for WebGL on Linux: install xvfb or set DISPLAY');
  xvfb ??= spawn('Xvfb', [':97', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  return { ...process.env, DISPLAY: ':97' };
}

/** Records every linked program so its status can be queried later without slowing the frame loop. */
function instrumentWebGL() {
  const programs = [];
  window.__smokePrograms = programs;
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const link = P.linkProgram;
    P.linkProgram = function (program) { programs.push([this, program]); return link.call(this, program); };
  }
  window.__smokeCheckPrograms = () => {
    const bad = [];
    for (const [gl, program] of programs.splice(0)) {
      if (gl.isContextLost() || !gl.isProgram(program) || gl.getProgramParameter(program, gl.LINK_STATUS)) continue;
      const shaders = (gl.getAttachedShaders(program) ?? []).map((s) => gl.getShaderInfoLog(s)).filter(Boolean);
      bad.push(`${gl.getProgramInfoLog(program)}\n${shaders.join('\n')}`.slice(0, 2000));
    }
    return bad;
  };
}

async function run(name) {
  const env = name === 'firefox' && !args.headed ? displayEnv() : undefined;
  const browser = await engines[name].launch({
    headless: !args.headed && name !== 'firefox',
    env,
    args: name === 'chromium' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [],
    firefoxUserPrefs: name === 'firefox' ? { 'webgl.force-enabled': true, 'media.autoplay.default': 0 } : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript((s) => {
    localStorage.setItem('wsp.help.seen.v1', '1');
    if (!localStorage.getItem('wsp.settings.v1')) localStorage.setItem('wsp.settings.v1', JSON.stringify(s));
  }, settings);
  await context.addInitScript(instrumentWebGL);
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const problems = [];
  const note = (kind, text) => { if (!IGNORE.some((re) => re.test(text))) problems.push(`[${kind}] ${text.slice(0, 1500)}`); };
  page.on('pageerror', (e) => note('pageerror', `${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => { if (m.type() === 'error' || WEBGL_WARNING.test(m.text())) note(`console.${m.type()}`, m.text()); });
  page.on('requestfailed', (r) => { if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(r.failure()?.errorText ?? '')) note('requestfailed', `${r.url()} ${r.failure()?.errorText}`); });
  page.on('worker', (w) => w.on('close', () => undefined));
  const steps = [];
  const step = async (label, fn) => {
    const t = Date.now();
    try { await fn(); steps.push(`ok   ${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`); }
    catch (e) { steps.push(`FAIL ${label}: ${e.message.split('\n')[0]}`); problems.push(`[step] ${label}: ${e.message.split('\n')[0]}`); throw e; }
  };
  const shot = async (label) => { if (shots) await page.screenshot({ path: `${shots}/${name}-${label}.png` }); };
  const checkPrograms = async () => { for (const log of await page.evaluate(() => window.__smokeCheckPrograms())) problems.push(`[shader] ${log}`); };
  const flightReady = () => page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { polling: 250 });
  const button = (re) => page.getByRole('button', { name: re }).first();
  try {
    await step('main menu', async () => { await page.goto(`${base}/`); await button(/^New Game/).waitFor(); await page.waitForTimeout(3000); await shot('menu'); });
    await step('new sandbox program → Space Center', async () => {
      await button(/^New Game/).click(); await button(/^Sandbox/).click(); await button(/^Start/).click();
      await button(/Vehicle Assembly/).waitFor(); await page.waitForTimeout(2000); await shot('hub');
    });
    await step('Vehicle Assembly', async () => {
      await button(/Vehicle Assembly/).click(); await page.waitForFunction(() => window.__editor);
      await page.evaluate(() => window.__editor.loadStock('kestrel')); await page.waitForTimeout(2000); await shot('editor');
    });
    await step('launch and stage', async () => {
      await button(/^Launch/).click();
      await page.waitForTimeout(1500);
      if (!(await page.evaluate(() => !!window.__flight))) await button(/^Launch/).click().catch(() => undefined); // scale-notice second click
      await flightReady(); await page.waitForTimeout(2000);
      await page.keyboard.press('Space'); await page.waitForTimeout(4000); await shot('liftoff');
      const mode = await page.evaluate(() => window.__flight.world.active?.mode);
      if (mode !== 'physics') throw new Error(`vessel did not leave the pad (mode ${mode})`);
      await checkPrograms();
    });
    await step('orbit scenario + map view', async () => {
      await page.goto(`${base}/?flight=stock-meridian&scenario=orbit`); await flightReady(); await page.waitForTimeout(3000); await shot('orbit');
      await page.mouse.click(640, 200); await page.keyboard.press('KeyM'); await page.waitForTimeout(3000);
      if (!(await page.evaluate(() => window.__flight.mapMode))) throw new Error('map view did not open');
      await page.mouse.move(640, 400); await page.mouse.wheel(0, 240); await page.waitForTimeout(1500); await shot('map');
      await page.keyboard.press('KeyM'); await page.waitForTimeout(1000);
      await checkPrograms();
    });
  } catch { /* recorded by step() */ }
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => '?');
  await browser.close();
  return { name, ua, steps, problems };
}

let failed = false;
for (const name of browsers) {
  const r = await run(name);
  console.log(`\n== ${r.name} (${r.ua})\n${r.steps.join('\n')}`);
  if (r.problems.length) { failed = true; console.log(`-- ${r.problems.length} problem(s):\n${r.problems.join('\n')}`); }
}
xvfb?.kill();
console.log(failed ? '\nBROWSER SMOKE FAILED' : '\nBROWSER SMOKE PASSED');
process.exit(failed ? 1 : 0);
