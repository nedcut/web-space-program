import { chromium } from '@playwright/test';
const [craft = 'stock-meridian', secs = '30'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[error] ${m.text()}`); });
await page.goto(`http://localhost:5173/?flight=${craft}`);
await page.waitForTimeout(6000);
await page.evaluate(() => window.__flight.startAssist('orbit'));
for (let i = 1; i <= 3; i++) {
  await page.waitForTimeout((+secs * 1000) / 3);
  await page.screenshot({ path: `/tmp/assist-${i}.png` });
  console.log(i, await page.evaluate(() => { const f = window.__flight; const w = f.world; const a = w.active; return { ut: (w.ut - 964051200).toFixed(1), mode: a?.mode, status: f.assist?.status, alt: a ? (w.universe.surfaceInfo(a.body, a.state.position, w.ut).altitude/1000).toFixed(2) : null }; }));
}
await browser.close();
