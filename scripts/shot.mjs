// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [jsToEvalBeforeShot]
// Screenshots a page with software WebGL (SwiftShader) for visual verification in headless envs.
import { chromium } from '@playwright/test';

const [url, out, wait = '4000', evalJs] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.SHOT_WIDTH ?? 1280), height: Number(process.env.SHOT_HEIGHT ?? 800) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (process.env.SHOT_HIDE_HELP) await page.addInitScript(() => localStorage.setItem('wsp.help.seen.v1', '1'));
try {
await page.goto(url, { waitUntil: 'load' });
if (evalJs) await page.evaluate(evalJs);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 180000 });
console.log(logs.slice(-40).join('\n'));
} finally {
  await browser.close();
}
