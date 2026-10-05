// Browser smoke test for the flight-feel layer (countdown, camera modes, warp-to, cautions container).
// Usage: start `npx vite --port 5204 --strictPort`, then `PORT=5204 node scripts/feel-browser.mjs [outDir]`.
// Uses SwiftShader at Low quality, so it checks behaviour, not frame rate.
import { chromium } from '@playwright/test';

const port = process.env.PORT ?? '5173';
const out = process.argv[2] ?? '/tmp';
const errors = [];
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.addInitScript(() => {
    localStorage.setItem('wsp.help.seen.v1', '1');
    localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', shadows: false, bloom: false, clouds: false, scatter: false, renderScale: 0.4, autoSaveInterval: 0, masterVolume: 0, launchCountdown: true }));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 180000 });
  return page;
}

// Pad: banner, countdown, launch.
let page = await open('flight=stock-meridian');
check(await page.locator('.feel-banner').count() === 1, 'arrival banner shown');
await page.keyboard.press('KeyT');
await page.keyboard.press('KeyZ');
await page.keyboard.press('Space');
await page.waitForTimeout(400);
check(await page.locator('.feel-countdown').count() === 1, 'launch countdown shown');
await page.screenshot({ path: `${out}/feel-countdown.png` });
await page.waitForFunction(() => window.__flight.world.active.mode !== 'prelaunch', null, { timeout: 120000 });
check(true, 'countdown released the clamps');
check((await page.locator('.feel-cam').textContent())?.includes('AUTO') ?? false, 'camera chip shows AUTO');
await page.close();

// Orbit: warp-to and camera modes.
page = await open('flight=stock-meridian&scenario=orbit');
await page.click('button[title="Warp to an event"]');
await page.waitForSelector('.feel-warpto-menu');
await page.screenshot({ path: `${out}/feel-warpto.png` });
await page.click('.feel-warpto-menu button:first-of-type');
await page.waitForTimeout(1500);
const warp = await page.evaluate(() => ({ target: window.__flight.warpDriver.target?.label ?? null, index: window.__flight.world.warp.index }));
check(!!warp.target && warp.index > 0, `warp-to engaged (${warp.target}, index ${warp.index})`);
const modes = [];
for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyV'); await page.waitForTimeout(200); modes.push(await page.evaluate(() => window.__flight.cam.mode)); }
check(modes.join(',') === 'free,orbital,chase,locked,auto', `camera modes cycle (${modes.join(',')})`);
await page.close();

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
