// Run with Windows Node against hardware Chrome CDP (never a software/headless substitute).
// node scripts/clouds-check.mjs <base-url> <shot-path> [query] [flight|preview]
import { createRequire } from 'node:module';
const require = createRequire(process.env.WSP_PLAYWRIGHT_PACKAGE ?? (process.platform === 'win32' ? 'C:/wsp-tools/drv/package.json' : import.meta.url));
const { chromium } = require('playwright-core');
import { writeFileSync } from 'node:fs';
const [base = 'http://localhost:5318', shot = 'clouds.png', query = '', mode = 'preview'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = await browser.contexts()[0].newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 920, deviceScaleFactor: 2, mobile: false });
  await page.addInitScript(() => {
    localStorage.setItem('wsp.help.seen.v1', '1');
    localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', clouds: true, shadows: true, bloom: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0 }));
  });
  await page.goto(base + (mode === 'flight' ? '/?' : '/planet-preview.html?') + query);
  await page.waitForFunction(mode === 'flight' ? () => window.__flight && !document.querySelector('.loading-screen') : () => window.__preview?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(16000);
  const result = await page.evaluate(async (mode) => {
    const s = mode === 'flight' ? window.__flight : window.__preview;
    if (mode === 'flight') s.paused = true;
    const p = s.pipeline, r = p.renderer, gl = r.getContext();
    const clouds = [];
    s.scene.traverse(o => { if (o.material?.uniforms?.uCamCCloud) clouds.push(o.material); });
    const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const sample = async () => {
      const a = [];
      for (let i = 0; i < 150; i++) { await new Promise(requestAnimationFrame); if (i >= 40) a.push(p.gpuMs); }
      return median(a);
    };
    const full = await sample();
    clouds.forEach(m => m.visible = false);
    const without = await sample();
    clouds.forEach(m => m.visible = true);
    const restored = await sample();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const out = { gpu: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), canvas: [r.domElement.width, r.domElement.height], full, without, restored, cloudMs: (full + restored) / 2 - without };
    if (mode === 'preview') {
      const planet = s.planet;
      const map = planet.cloudMap;
      if (map?.done) {
        // Read R8 as RGBA (WebGL's portable UNSIGNED_BYTE read format), weight each
        // cube texel by its solid angle so face corners and poles are not overcounted.
        const n = map.target.width;
        const pixels = new Uint8Array(n * n * 4);
        const thresholds = [0.01, 0.1, 0.2, 0.5];
        const counts = thresholds.map(() => 0);
        let area = 0, density = 0;
        for (let face = 0; face < 6; face++) {
          r.setRenderTarget(map.target, face);
          gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const a = 2 * (x + 0.5) / n - 1, b = 2 * (y + 0.5) / n - 1;
            const w = (1 + a * a + b * b) ** -1.5;
            const d = pixels[(y * n + x) * 4] / 255;
            area += w; density += d * w;
            thresholds.forEach((t, i) => { if (d > t) counts[i] += w; });
          }
        }
        r.setRenderTarget(null);
        out.coverage = Object.fromEntries(thresholds.map((t, i) => [t, counts[i] / area]));
        out.meanDensity = density / area;
        out.faceSize = n;
        out.glError = gl.getError();
      }
    }
    return out;
  }, mode);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot });
  writeFileSync(shot.replace(/\.png$/, '.json'), JSON.stringify({ ...result, query, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
} finally {
  await page.close();
  await browser.close();
}
