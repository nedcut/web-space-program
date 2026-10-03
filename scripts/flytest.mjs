// Drive a flight via keyboard and screenshot. Usage: node scripts/flytest.mjs <craftId> <out-prefix> <seconds> [keys...]
import { chromium } from '@playwright/test';
const [craft = 'stock-meridian', out = '/tmp/fly', secs = '15', ...keys] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[error] ${m.text()}`); });
await page.goto(`http://localhost:5173/?flight=${craft}`);
await page.waitForTimeout(5000);
for (const k of keys.length ? keys : ['KeyT', 'KeyZ', 'Space']) { await page.keyboard.press(k); await page.waitForTimeout(150); }
const n = 3;
for (let i = 1; i <= n; i++) {
  await page.waitForTimeout((+secs * 1000) / n);
  await page.screenshot({ path: `${out}-${i}.png` });
  const info = await page.evaluate(() => { const f = window.__flight; if (!f) return null; const w = f.world; const a = w.active; return a ? { ut: w.ut, body: a.body, mode: a.mode, sit: a.state.situation, thrust: a.state.telemetry.thrust, vessels: w.vessels.size } : null; });
  console.log(i, JSON.stringify(info));
}
await browser.close();
