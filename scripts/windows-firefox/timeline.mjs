// Real Windows Firefox / Chrome per-second timeline from navigation (imagery streaming, loading stalls); setup as in perf.mjs.
// GLCOUNT=1 counts notable GL calls per second and lists the GL calls of every frame over 40 ms (SPIKES).
// Usage: node.exe ffp-timeline.mjs <url> <tag> <firefox|chrome> [settingsJson] [seconds]
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';
const [url, tag = 'tl', which = 'firefox', settingsJson = '{}', secs = '40'] = process.argv.slice(2);
const profile = `C:\\wsp-tools\\ff-profile-${tag}`;
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const browser = await puppeteer.launch(which === 'firefox'
  ? { browser: 'firefox', headless: false, executablePath: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', userDataDir: profile, args: ['--width=1600', '--height=1000'], defaultViewport: null, extraPrefsFirefox: JSON.parse(process.env.FF_PREFS || '{}') }
  : { browser: 'chrome', headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', userDataDir: profile, protocol: 'webDriverBiDi', defaultViewport: { width: 1600, height: 915 } });
const page = (await browser.pages())[0] ?? await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('PROBE')) console.log(`[${m.type()}] ${m.text().slice(0, 300)}`); });
await page.evaluateOnNewDocument((s) => { localStorage.setItem('wsp.help.seen.v1', '1'); const extra = JSON.parse(s); if (Object.keys(extra).length) localStorage.setItem('wsp.settings.v1', JSON.stringify({ graphicsProfile: 99, ...extra })); }, settingsJson);
await page.evaluateOnNewDocument((glc) => {
  const counts = new Map(); window.__glCounts = counts;
  if (glc) for (const P of [WebGL2RenderingContext.prototype]) for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k); if (!d || typeof d.value !== 'function') continue;
    const o = d.value; P[k] = function (...a) { const key = k === 'getParameter' ? 'getParameter:' + a[0] : k; counts.set(key, (counts.get(key) || 0) + 1); const fc = window.__frameCounts; if (fc) fc.set(key, (fc.get(key) || 0) + 1); return o.apply(this, a); };
  }
  // raw rAF intervals (independent of the game's profiler); spikes record the notable GL calls of the slow frame
  window.__iv = []; window.__spikes = []; let last = 0; const raf = window.requestAnimationFrame.bind(window);
  let prev = new Map();
  const tick = (t) => {
    if (last) { const iv = t - last; window.__iv.push(iv);
      if (iv > 40 && window.__spikes.length < 400) { const notable = [...prev].filter(([k]) => !/^(uniform|bind|activeTexture|drawElements$|drawArrays$|useProgram|viewport|scissor|enable|disable|depth|blend|frontFace|clear|cull|colorMask|stencil|vertexAttrib|enableVertex|disableVertex|pixelStorei|drawBuffers|invalidate)/.test(k)).map(([k, v]) => k + '=' + v).join(' ');
        window.__spikes.push(Math.round(performance.now()) + ' iv=' + iv.toFixed(0) + ' ' + notable); } }
    last = t; prev = window.__frameCounts; window.__frameCounts = new Map(); raf(tick); };
  window.__frameCounts = new Map(); raf(tick);
}, !!process.env.GLCOUNT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const end = t0 + +secs * 1000;
while (Date.now() < end) {
  await sleep(1000);
  const r = await page.evaluate(() => {
    const p = window.__perf; const c = window.__flight; if (!p) return null;
    if (!window.__ffStarted) { p.reset(); p.enabled = true; window.__ffStarted = true; window.__glCounts.clear(); window.__iv = []; return { start: true }; }
    const s = p.summary(); p.reset();
    const iv = window.__iv.slice().sort((a, b) => a - b); window.__iv = [];
    const pc = (q) => iv.length ? +iv[Math.min(iv.length - 1, Math.floor(q * iv.length))].toFixed(1) : 0;
    const gl = [...window.__glCounts].filter(([k]) => /^(texSubImage2D|texImage2D|texStorage2D|generateMipmap|bufferData|bufferSubData|readPixels|getError|getParameter|clientWaitSync|fenceSync|getQueryParameter|compileShader|linkProgram|getProgramParameter|getShaderParameter|drawElements|drawArrays|drawElementsInstanced|copyTexSubImage2D|blitFramebuffer|invalidateFramebuffer|getUniformLocation)/.test(k)).map(([k, v]) => k + '=' + v).join(' ');
    window.__glCounts.clear();
    const st = c?.pipeline?.stats;
    return { n: iv.length, p50: pc(0.5), p95: pc(0.95), max: pc(1), cpu: +s.cpuMs.avg.toFixed(2), cpuMax: +s.cpuMs.max.toFixed(1), planets: +(s.sections.planets ?? 0).toFixed(2), render: +(s.sections.render ?? 0).toFixed(2), draws: st?.calls, tris: st?.triangles, loading: !!document.querySelector('.loading-screen'), gl };
  }).catch((e) => ({ err: String(e).slice(0, 100) }));
  console.log(((Date.now() - t0) / 1000).toFixed(0), JSON.stringify(r));
}
console.log('SPIKES\n' + (await page.evaluate(() => window.__spikes.join('\n'))));
await page.screenshot({ path: `C:\\wsp-tools\\shots\\${tag}.png` });
await browser.close();
