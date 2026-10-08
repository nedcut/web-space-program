// Bugfix 5 browser checks against this worktree's Vite server (default port 5321):
//   node scripts/bugfix5-browser.mjs toolbar [suffix]   editor toolbar screenshots at 1024×768 and 800×700 (+ 760 check)
//   node scripts/bugfix5-browser.mjs draft              program A (Kestrel) / program B (Swift Jet) → load A restores Kestrel
//   node scripts/bugfix5-browser.mjs controls           Controls overlay blocks flight input; from Pause it stays paused
//   node scripts/bugfix5-browser.mjs quota              full storage: Fleet Tracking Back/Fly navigate with a notice
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
  page.on('dialog', d => d.accept(d.defaultValue()));
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
  if (what === 'draft') {
    const page = await newPage(1366, 768);
    await page.goto(base);
    const program = async () => { await page.getByRole('button', { name: 'New Game', exact: true }).click(); await page.getByRole('button', { name: 'Sandbox', exact: true }).click(); await page.getByRole('button', { name: 'Start', exact: true }).click(); };
    const build = async (stock) => {
      await page.evaluate(() => window.__game.set({ scene: 'editor' }));
      await page.waitForFunction(() => window.__editor);
      await page.evaluate(stock => window.__editor.loadStock(stock), stock);
      await page.locator('.vab-exit').click();
      await page.getByRole('button', { name: 'Save as…' }).waitFor();
    };
    await program(); await build('kestrel');
    await page.getByRole('button', { name: 'Save as…' }).click();
    const programA = await page.evaluate(() => window.__game.get().saveId);
    await page.getByRole('button', { name: 'Main menu' }).click();
    await program(); await build('swift');
    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Load a program' }).waitFor();
    console.log('slots:', (await page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Load a program' }) }).innerText()).replace(/\n+/g, ' | '));
    const slot = page.locator('div', { has: page.getByText(programA, { exact: true }) }).filter({ has: page.getByText('Program save', { exact: true }) }).last();
    await slot.getByRole('button', { name: 'Load' }).click();
    await page.getByRole('button', { name: 'Save as…' }).waitFor();
    const restored = await page.evaluate(() => ({ saveId: window.__game.get().saveId, craft: window.__game.get().craft?.name }));
    console.log('program A', programA, 'restored', JSON.stringify(restored));
    if (restored.saveId !== programA || !/Kestrel/.test(restored.craft ?? '')) throw Error('Loaded program A did not restore its Kestrel draft');
  }
  if (what === 'controls') {
    const page = await newPage(1280, 800);
    await page.goto(`${base}?flight=stock-kestrel`);
    await page.waitForFunction(() => window.__flight?.sceneReady, null, { timeout: 120000 });
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 120000 });
    const state = () => page.evaluate(() => ({ paused: window.__flight.paused, modal: window.__flight.modalOpen, throttle: window.__flight.input.state.throttle, mode: window.__flight.world.active.mode, stage: window.__flight.world.active.state.nextStage }));
    await page.keyboard.press('Shift+F1');
    await page.getByRole('dialog', { name: 'Flight controls' }).waitFor();
    const before = await state();
    await page.keyboard.press('z'); await page.keyboard.press('Space');
    await page.keyboard.down('d'); await page.waitForTimeout(400);
    const underHelp = { ...(await state()), yaw: await page.evaluate(() => window.__flight.input.state.yaw) };
    await page.keyboard.up('d');
    await page.screenshot({ path: new URL('controls-overlay-in-flight.png', out).pathname });
    console.log('help open in flight', JSON.stringify({ before, underHelp }));
    if (underHelp.throttle !== before.throttle || underHelp.yaw !== 0 || underHelp.stage !== before.stage || !underHelp.modal) throw Error('Flight input leaked behind the Controls overlay');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Flight controls' }).waitFor({ state: 'detached' });
    await page.waitForTimeout(200);
    await page.keyboard.press('z'); await page.waitForTimeout(200);
    const closed = await state();
    console.log('after closing', JSON.stringify(closed));
    if (closed.throttle !== 1 || closed.paused || closed.modal) throw Error('Closing Controls did not restore flight input');
    await page.keyboard.press('x');
    await page.keyboard.press('Escape');
    await page.getByText('Paused', { exact: true }).waitFor();
    await page.locator('.pause-card').getByRole('button', { name: /^Controls/ }).click();
    await page.getByRole('dialog', { name: 'Flight controls' }).waitFor();
    const fromPause = await state();
    await page.screenshot({ path: new URL('controls-overlay-from-pause.png', out).pathname });
    console.log('opened from Pause', JSON.stringify(fromPause));
    if (!fromPause.paused || await page.getByText('Paused', { exact: true }).count()) throw Error('Controls from Pause resumed flight or left the Pause card on top');
    await page.keyboard.press('Escape');
    await page.getByText('Paused', { exact: true }).waitFor();
    const back = await state();
    await page.screenshot({ path: new URL('controls-overlay-closed-back-to-pause.png', out).pathname });
    console.log('closed back to Pause', JSON.stringify(back));
    if (!back.paused) throw Error('Closing Controls opened from Pause resumed flight');
  }
  if (what === 'quota') {
    const page = await newPage(1280, 800);
    await page.goto(base);
    await page.getByRole('button', { name: 'New Game', exact: true }).click(); await page.getByRole('button', { name: 'Sandbox', exact: true }).click(); await page.getByRole('button', { name: 'Start', exact: true }).click();
    // A vessel on the pad to Fly, then fill the storage quota (localStorage and IndexedDB writes throw).
    await page.evaluate(async () => {
      const [{ World }, { Universe }, { PART_CATALOG }, { buildSoundingRocket }, { serializeWorld }] = await Promise.all(['/src/game/world.ts', '/src/game/universe.ts', '/src/data/parts.ts', '/src/editor/stockCrafts.ts', '/src/game/persistence.ts'].map(p => import(p)));
      const g = window.__game.get();
      const w = new World(new Universe(g.scalePreset), PART_CATALOG, g.ut, g.mode); w.launch(buildSoundingRocket());
      window.__game.set({ resumeWorld: serializeWorld(w) });
      const full = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      Storage.prototype.setItem = full; IDBObjectStore.prototype.put = full; IDBObjectStore.prototype.add = full;
      window.__game.set({ scene: 'tracking' });
    });
    await page.getByRole('button', { name: 'Back to Space Center' }).click();
    await page.getByRole('button', { name: 'Save as…' }).waitFor();
    const notice = page.locator('.save-error-notice');
    await notice.waitFor();
    console.log('Back → hub; crash screen:', await page.getByText('Flight interrupted').count(), '; notice:', await notice.innerText());
    await page.screenshot({ path: new URL('storage-full-back-to-hub.png', out).pathname });
    await page.evaluate(() => window.__game.set({ scene: 'tracking', saveError: null }));
    await page.getByRole('button', { name: 'Fly', exact: true }).first().click();
    await page.waitForFunction(() => window.__flight?.sceneReady, null, { timeout: 120000 });
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 120000 });
    await notice.waitFor();
    await page.screenshot({ path: new URL('storage-full-fly.png', out).pathname });
    console.log('Fly → flight scene ready; scene', await page.evaluate(() => window.__game.get().scene), '; notice:', await notice.innerText());
  }
} finally {
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
}
