/* Real-GPU acceptance: Windows Node, the user's Chrome CDP, own isolated context. */
import { chromium } from 'file:///C:/wsp-tools/drv/node_modules/playwright-core/index.mjs';
import path from 'node:path';
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = name => page.screenshot({ path: path.join(import.meta.dirname, '../docs/screenshots/cues', name + '.png') });
  try {
    await page.addInitScript(() => localStorage.setItem('wsp.help.seen.v1', '1'));
    await page.goto('http://localhost:5335/?flight=stock-kestrel');
    await page.waitForFunction(() => window.__flight?.sceneReady, { timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log('gpu', await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); return gl?.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); }));
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    await page.keyboard.press('Alt+l');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    if (!(await page.locator('[aria-label="Flight notifications"]').innerText()).includes('locked')) throw Error('Missing staging lock explanation');
    await shot('flight-cues');
    await page.keyboard.press('x');
    await page.keyboard.press('m');
    await page.waitForTimeout(1200);
    if (!(await page.locator('.feel-hint').innerText()).includes('orbit line')) throw Error('Missing map tip');
    await shot('map-tip');
    await page.getByTitle('Hide this hint').click();
    await page.keyboard.press('F5');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('wsp:worker-error', { detail: 'Acceptance test: terrain worker interrupted' })));
    await page.getByRole('heading', { name: 'Flight interrupted' }).waitFor();
    await shot('recovery');
    await page.getByRole('button', { name: 'Reload last quicksave' }).click();
    await page.waitForFunction(() => window.__flight?.sceneReady, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('m');
    await page.waitForTimeout(300);
    if (await page.locator('.feel-hint').count()) throw Error('Dismissed map tip returned after reload');
    await page.evaluate(async () => {
      const { STOCK_CRAFTS } = await import('/src/editor/stockCrafts.ts');
      const craft = STOCK_CRAFTS[0].build();
      for (const p of craft.parts) p.resources = { liquidFuel: 0, oxidizer: 0, solidFuel: 0 };
      window.__game.set({ craft, scene: 'editor', launchPending: false });
    });
    await page.locator('.preflight-checks').waitFor();
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Show me' }).first().click();
    await shot('editor-checks');
    console.log('dpr', await page.evaluate(() => devicePixelRatio));
    console.log('errors', errors);
    if (errors.length) throw Error('Unexpected browser errors');
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
