// Bugfix 5 browser checks against this worktree's Vite server (default port 5321):
//   node scripts/bugfix5-browser.mjs toolbar [suffix]   editor toolbar screenshots at 1024×768 and 800×700 (+ 760 check)
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.WSP_URL ?? 'http://localhost:5321/';
const out = new URL('../docs/screenshots/bugfix5/', import.meta.url);
await mkdir(out, { recursive: true });
const [what = 'toolbar', suffix = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
const newPage = async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', shadows: false, bloom: false, clouds: false, scatter: false, renderScale: 0.5, masterVolume: 0, reduceMotion: true, autoSaveInterval: 0 })); localStorage.setItem('wsp.help.seen.v1', '1'); });
  return page;
};
const visible = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, clickable: !!hit && (hit === el || el.contains(hit)) };
}, sel);
try {
  if (what === 'toolbar') {
    for (const [w, h] of [[1600, 900], [1024, 768], [800, 700], [760, 700]]) {
      const page = await newPage(w, h);
      await page.goto(`${base}?scene=editor&stock=kestrel`);
      await page.locator('.vab-launch').waitFor();
      await page.waitForTimeout(2500);
      const launch = await visible(page, '.vab-launch'), exit = await visible(page, '.vab-exit, .vab-topbar > .vab-ibtn:last-child');
      console.log(`${w}x${h}`, JSON.stringify({ launch, exit }));
      if (w !== 760) await page.screenshot({ path: new URL(`editor-toolbar-${w}x${h}${suffix}.png`, out).pathname });
      if (w === 800 && !suffix) {
        await page.getByTitle('More tools').click();
        await page.getByRole('menuitemcheckbox', { name: /Centre of mass/ }).waitFor();
        await page.screenshot({ path: new URL(`editor-toolbar-${w}x${h}-more-menu.png`, out).pathname });
        await page.getByRole('menuitemcheckbox', { name: /Centre of mass/ }).click();
        await page.getByTitle('More tools').click();
        console.log('CoM after toggling from the menu:', await page.getByRole('menuitemcheckbox', { name: /Centre of mass/ }).getAttribute('aria-checked'));
        await page.keyboard.press('Escape');
        await page.locator('.vab-launch').click();
        await page.waitForFunction(() => window.__flight || document.querySelector('.loading-screen'), null, { timeout: 30000 });
        console.log('Launch clicked at 800 px: flight scene loading');
      }
      await page.close();
    }
  }
} finally {
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
}
