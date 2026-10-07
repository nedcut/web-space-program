// Real Windows Firefox / Chrome driver (WebDriver BiDi through puppeteer-core) — see docs/BROWSERS.md.
// Runs on the *Windows* side (the game is served from WSL with --host; Windows localhost reaches it):
//   mkdir C:\wsp-tools\drv-ff && cd there && npm i puppeteer-core   (Windows Node), copy this file in, then from WSL:
//   /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv-ff\perf.mjs' ...
// Screenshots go to C:\wsp-tools\shots. Not part of npm scripts: puppeteer-core is a Windows-side install only.
// Usage: node.exe perf.mjs <url> <tag> <firefox|chrome> [settingsJson] [seconds]
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';
const [url, tag = 'perf', which = 'firefox', settingsJson = '{}', secs = '6'] = process.argv.slice(2);
const profile = `C:\\wsp-tools\\ff-profile-${tag}`;
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const browser = await puppeteer.launch(which === 'firefox'
  ? { browser: 'firefox', headless: false, executablePath: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', userDataDir: profile, args: ['--width=1600', '--height=1000'], defaultViewport: null, extraPrefsFirefox: JSON.parse(process.env.FF_PREFS || '{}') }
  : { browser: 'chrome', headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', userDataDir: profile, protocol: 'webDriverBiDi', defaultViewport: { width: 1600, height: 915 } });
const page = (await browser.pages())[0] ?? await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[error] ${m.text().slice(0, 300)}`); });
await page.evaluateOnNewDocument((s) => { localStorage.setItem('wsp.help.seen.v1', '1'); const extra = JSON.parse(s); if (Object.keys(extra).length) localStorage.setItem('wsp.settings.v1', JSON.stringify({ graphicsProfile: 99, ...extra })); }, settingsJson);
if (process.env.GLCOUNT) await page.evaluateOnNewDocument(() => {
  const counts = new Map(); window.__glCounts = counts; window.__glFrames = 0;
  for (const P of [WebGL2RenderingContext.prototype]) for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k); if (!d || typeof d.value !== 'function') continue;
    const o = d.value; P[k] = function (...a) { if (window.__glOn) { const key = k === 'getParameter' ? 'getParameter:' + a[0] : k; counts.set(key, (counts.get(key) || 0) + 1); } return o.apply(this, a); };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.__glStart = () => { counts.clear(); window.__glOn = true; window.__glFrames = 0; const tick = () => { if (!window.__glOn) return; window.__glFrames++; raf(tick); }; raf(tick); };
});
if (process.env.INJECT_CSS) await page.evaluateOnNewDocument((css) => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.append(st); }); }, process.env.INJECT_CSS);
if (process.env.PRE_JS) await page.evaluateOnNewDocument(process.env.PRE_JS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
for (let i = 0; i < 300 && !(await page.evaluate(() => !!window.__flight && !document.querySelector('.loading-screen'))); i++) await sleep(500);
await sleep(8000);
await page.evaluate(() => { window.__perf.reset(); window.__perf.enabled = true; window.__glStart?.(); });
if (process.env.MID_JS) console.log('mid', JSON.stringify(await page.evaluate(process.env.MID_JS)));
await sleep(+secs * 1000);
const r = await page.evaluate(() => { const s = window.__perf.summary(); const c = window.__flight; const p = c.pipeline ?? c.renderPipeline;
  const gl = c.renderer?.getContext?.() ?? p?.renderer?.getContext?.();
  return { fps: s.fps, frameMs: s.frameMs, cpuMs: s.cpuMs, sections: Object.fromEntries(Object.entries(s.sections).map(([k, v]) => [k, +v.toFixed(2)])), dpr: devicePixelRatio, size: [innerWidth, innerHeight],
    scale: p?.renderScale ?? p?.scale ?? null, gpuMs: p?.gpuMs ?? null, settings: JSON.parse(localStorage.getItem('wsp.settings.v1') || '{}').quality, drawBuf: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null }; });
console.log(JSON.stringify(r));
if (process.env.GLCOUNT) console.log(JSON.stringify(await page.evaluate(() => { window.__glOn = false; const f = window.__glFrames; return { frames: f, perFrame: [...window.__glCounts].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, v]) => [k, +(v / f).toFixed(1)]) }; })));
await page.screenshot({ path: `C:\\wsp-tools\\shots\\${tag}.png` });
await browser.close();
