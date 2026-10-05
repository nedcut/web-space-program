import { chromium } from '@playwright/test';
import fs from 'fs';
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: 'load' });
await page.waitForTimeout(+process.argv[4] || 15000);
const url = await page.evaluate(async () => { const m = await import('/src/render/parts/materials.ts'); return m.M.decal().map.image.toDataURL(); });
fs.writeFileSync(process.argv[3], Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
