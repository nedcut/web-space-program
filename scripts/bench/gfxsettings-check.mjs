// Windows hardware Chrome/CDP integration check. Run beside playwright-core in C:\wsp-tools\drv.
// node gfxsettings-check.mjs http://<WSL-IP>:5327 C:\wsp-tools\bench\gfxsettings-live.json
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [base, out] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const checks = [
  ['maxPixelRatio', 1], ['antiAliasing', 'off'], ['antiAliasing', 'fxaa'], ['antiAliasing', 'msaa+smaa'],
  ['shadowQuality', 'ultra'], ['terrainDetail', 'low'], ['groundClutter', 'off'],
  ['atmosphereQuality', 'ultra'], ['cloudQuality', 'off'], ['textureQuality', 'ultra'],
  ['oceanQuality', 'ultra'], ['nightLights', false], ['starQuality', 'off'],
  ['particleQuality', 'ultra'], ['partDetail', 'low'],
];
const result = { date: new Date().toISOString(), checks: [], errors };
try {
  await page.addInitScript(() => localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 2, adaptiveQuality: false, advancedGraphics: {}, autoSaveInterval: 0 })));
  await page.goto(`${base}/?flight=stock-kestrel&scenario=orbit`);
  await page.waitForFunction(() => window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 90000 });
  for (const [key, value] of checks) {
    const expected = await page.evaluate(async ([key, value]) => {
      const { updateSettings } = await import('/src/game/store.ts');
      const { presetSettings, resolveQuality } = await import('/src/render/core/quality.ts');
      const settings = { ...window.__game.get().settings, ...presetSettings('medium'), advancedGraphics: { [key]: value }, adaptiveQuality: false, graphicsCustom: true };
      updateSettings(settings);
      return resolveQuality('medium', settings);
    }, [key, value]);
    await page.waitForFunction(q => window.__flight && !document.querySelector('.loading-screen') && JSON.stringify(window.__flight.pipeline.quality) === JSON.stringify(q), expected, { timeout: 90000 });
    const actual = await page.evaluate(() => {
      const c = window.__flight, p = c.pipeline, gl = p.renderer.getContext();
      return { quality: p.quality, pixelRatio: p.renderer.getPixelRatio(), samples: p.composer.renderTarget1.samples,
        particles: c.effects.pool.capacity, shadows: p.renderer.shadowMap.enabled, shadowSize: c.sunLight.shadow.mapSize.x,
        gpu: p.gpuName, glError: gl.getError(), ut: c.world.ut };
    });
    if (actual.glError || actual.samples !== expected.msaaSamples || actual.shadows !== (expected.shadowMapSize > 0)) throw new Error(`render configuration failed: ${key}`);
    result.checks.push({ key, value, actual });
    console.log(`PASS ${key}=${value}`);
  }
  for (const cap of [30, 60, 120, 0]) {
    await page.evaluate(async cap => { const { updateSettings } = await import('/src/game/store.ts'); updateSettings({ frameRateCap: cap }); }, cap);
    const fps = await page.evaluate(async () => {
      const start = performance.now(); let last = window.__flight.last, frames = 0;
      while (performance.now() - start < 2000) { await new Promise(requestAnimationFrame); if (window.__flight.last !== last) { frames++; last = window.__flight.last; } }
      return frames * 1000 / (performance.now() - start);
    });
    if (cap && fps > cap + 2) throw new Error(`frame cap ${cap}: ${fps}`);
    result.checks.push({ frameRateCap: cap, observedFps: fps });
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  writeFileSync(out, JSON.stringify(result, null, 2));
  await context.close(); await browser.close();
}
