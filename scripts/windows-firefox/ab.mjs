// Real Windows Firefox / Chrome steady-state A/B window (WebDriver BiDi through puppeteer-core); setup as in perf.mjs.
// Firefox ASAP mode (frame intervals = total cost, not the 30 Hz vsync of the test PC): FF_PREFS='{"layout.frame_rate":0}'.
// From WSL: WSLENV=FF_PREFS:GLCOUNT:MID_JS FF_PREFS=... node.exe ab.mjs <url> <tag> firefox '{"quality":"medium","adaptiveQuality":false}' 40 10
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';
const [url, tag = 'ab', which = 'firefox', settingsJson = '{}', warm = '40', secs = '10'] = process.argv.slice(2);
const profile = `C:\\wsp-tools\\ff-profile-${tag}`;
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const browser = await puppeteer.launch(which === 'firefox'
  ? { browser: 'firefox', headless: false, executablePath: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', userDataDir: profile, args: ['--width=1600', '--height=1000'], defaultViewport: null, extraPrefsFirefox: JSON.parse(process.env.FF_PREFS || '{}') }
  : { browser: 'chrome', headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', userDataDir: profile, protocol: 'webDriverBiDi', defaultViewport: { width: 1600, height: 915 } });
const page = (await browser.pages())[0] ?? await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[error] ${m.text().slice(0, 300)}`); });
await page.evaluateOnNewDocument((s) => { localStorage.setItem('wsp.help.seen.v1', '1'); localStorage.setItem('wsp.settings.v1', JSON.stringify({ graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0, ...JSON.parse(s) })); }, settingsJson);
await page.evaluateOnNewDocument((glc) => {
  window.__glTotal = 0;
  if (glc) for (const k of Object.getOwnPropertyNames(WebGL2RenderingContext.prototype)) {
    const P = WebGL2RenderingContext.prototype; const d = Object.getOwnPropertyDescriptor(P, k); if (!d || typeof d.value !== 'function') continue;
    const o = d.value; P[k] = function (...a) { window.__glTotal++; return o.apply(this, a); };
  }
  window.__iv = []; let last = 0; const raf = window.requestAnimationFrame.bind(window);
  const tick = (t) => { if (last && window.__ivOn) window.__iv.push(t - last); last = t; raf(tick); }; raf(tick);
}, !!process.env.GLCOUNT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
for (let i = 0; i < 300 && !(await page.evaluate(() => !!window.__flight && !document.querySelector('.loading-screen'))); i++) await sleep(500);
await sleep(+warm * 1000);
if (process.env.MID_JS) { console.log('mid', JSON.stringify(await page.evaluate(process.env.MID_JS))); await sleep(3000); }
await page.evaluate(() => { window.__perf.reset(); window.__perf.enabled = true; window.__iv = []; window.__ivOn = true; window.__glTotal = 0; });
await sleep(+secs * 1000);
const r = await page.evaluate(() => {
  window.__ivOn = false; const s = window.__perf.summary(); const c = window.__flight; const p = c.pipeline;
  const iv = window.__iv.slice().sort((a, b) => a - b); const n = iv.length;
  const pc = (q) => +iv[Math.min(n - 1, Math.floor(q * n))].toFixed(1);
  return { frames: n, ivMean: +(iv.reduce((a, b) => a + b, 0) / n).toFixed(2), p50: pc(0.5), p95: pc(0.95), p99: pc(0.99), max: pc(1), over25: iv.filter((v) => v > 25).length, over50: iv.filter((v) => v > 50).length,
    glPerFrame: window.__glTotal ? +(window.__glTotal / n).toFixed(0) : undefined,
    cpu: +s.cpuMs.avg.toFixed(2), cpuP95: s.cpuMs.p95, sections: Object.fromEntries(Object.entries(s.sections).filter(([, v]) => v > 0.05).map(([k, v]) => [k, +v.toFixed(2)])),
    draws: p.stats.calls, tris: p.stats.triangles, scale: +p.effectiveRenderScale.toFixed(2), size: [innerWidth, innerHeight, devicePixelRatio] };
});
console.log('RESULT', tag, JSON.stringify(r));
await page.screenshot({ path: `C:\\wsp-tools\\shots\\${tag}.png` });
await browser.close();
