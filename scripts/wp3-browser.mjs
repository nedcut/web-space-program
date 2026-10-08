// Run with Windows Node under flock /tmp/wsp-gpu.lock; production preview on 5401.
import { chromium } from 'file:///C:/wsp-tools/drv/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const label = process.argv[2] ?? 'final';
const base = process.argv[3] ?? 'http://172.24.204.38:5401';
const out = fileURLToPath(new URL(`../docs/screenshots/wp3/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const results = [];
try {
for (const dpr of [1, 2]) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
  await context.addInitScript(() => {
    localStorage.setItem('wsp.help.seen.v1', '1');
    localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, autoSaveInterval: 0, masterVolume: 0, flightHints: true }));
    sessionStorage.setItem('wsp.hud.engineeringStrip.v1', '1');
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  for (const scene of ['pad', 'ascent', 'orbit', 'moon', 'approach']) {
    if (scene !== 'ascent') {
      await page.goto(`${base}/?flight=stock-${scene === 'pad' ? 'meridian' : 'selene'}${scene === 'orbit' || scene === 'moon' ? `&scenario=${scene}` : scene === 'approach' ? '&mission=suicide-burn' : ''}`);
      await page.waitForFunction(() => window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
      await page.waitForTimeout(4500);
    }
    if (scene === 'approach') {
      const start = page.getByRole('button', { name: /Begin|Start|Fly/ }).first();
      if (await start.isVisible().catch(() => false)) await start.click();
      if (label !== 'before') {
        await page.evaluate(() => window.__flight.startAssist('land'));
        await page.waitForFunction(() => { const t = window.__flight.lastTelemetry; return t.altitudeTerrain < 250 && t.altitudeTerrain > 40 && t.throttle > 0; }, null, { timeout: 90000 });
      }
    }
    const cdp = await context.newCDPSession(page);
    let frames = 0;
    if (scene === 'ascent') {
      mkdirSync(`${out}/ascent-dpr${dpr}`, { recursive: true });
      cdp.on('Page.screencastFrame', p => {
        writeFileSync(`${out}/ascent-dpr${dpr}/${String(frames++).padStart(5, '0')}.jpg`, Buffer.from(p.data, 'base64'));
        cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1600, maxHeight: 900, everyNthFrame: 3 });
      await page.keyboard.press('t'); await page.keyboard.press('z'); await page.keyboard.press('Space');
    }
    await page.evaluate(() => { window.__perf.enabled = true; window.__perf.reset(); });
    await page.waitForTimeout(scene === 'ascent' ? 12000 : 7000);
    const result = await page.evaluate(() => ({ perf: window.__perf.summary(), mode: window.__flight.speedMode, text: document.body.innerText, alt: window.__flight.lastTelemetry?.altitudeAsl, messages: window.__flight.lastTelemetry?.messages, alerts: window.__flight.lastTelemetry?.feel.alerts, engineering: window.__flight.lastTelemetry?.engineering }));
    await page.screenshot({ path: `${out}/${scene}-dpr${dpr}.png` });
    if (scene === 'ascent') await cdp.send('Page.stopScreencast');
    await cdp.detach();
    results.push({ scene, dpr, ...result });
    console.log(label, scene, dpr, result.perf.sections.hud, result.mode, result.alt);
    writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  }
  await context.close();
}
} finally { await browser.close(); }
