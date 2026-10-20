// Functional regression on Windows Chrome CDP. Run under /tmp/wsp-gpu.lock.
// node flight-help-browser.mjs <base-url> <evidence-dir> [cdp-url]
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base = 'http://172.24.204.38:5612', out = 'C:/wsp-tools/shots/flight-help', cdp = 'http://127.0.0.1:9333', multiplayerUrl] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(cdp);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  Object.defineProperty(document, 'hasFocus', { value: () => true });
});
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const help = page.getByRole('button', { name: 'Controls help (Shift+F1)', exact: true });
const read = () => page.evaluate(() => ({ ut: window.__flight.world.ut, paused: window.__flight.paused, warp: { ...window.__flight.world.warp }, throttle: window.__flight.input.state.throttle }));
const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog][aria-label="Flight controls"]'));
try {
  await page.goto(`${base}/?flight=stock-kestrel`);
  await page.waitForFunction(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.keyboard.press('t'); await page.keyboard.press('z'); await page.keyboard.press('Space');
  for (const index of [1, 3]) {
    await page.evaluate(index => { window.__flight.world.warp = { mode: 'physics', index }; }, index);
    await page.keyboard.down('w'); await page.keyboard.down('i'); await page.keyboard.down('f');
    await page.waitForTimeout(100);
    await help.click();
    const before = await read();
    assert.equal(before.paused, true);
    assert.equal(await inside(), true, 'focus enters help');
    for (const key of ['Tab', 'Shift+Tab', 'Tab']) { await page.keyboard.press(key); assert.equal(await inside(), true, key); }
    await page.keyboard.press('x'); await page.keyboard.press('Period');
    await page.waitForTimeout(1200);
    const during = await read();
    assert.deepEqual(during, before, 'simulation, warp and throttle stay unchanged under help');
    await page.screenshot({ path: `${out}/help-${index + 1}x.png` });
    if (index === 1) await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Got it', exact: true }).click();
    const restored = await page.evaluate(() => ({ paused: window.__flight.paused, focus: document.activeElement?.getAttribute('aria-label'), axes: [window.__flight.input.state.pitch, window.__flight.input.state.ty] }));
    assert.equal(restored.paused, false);
    assert.equal(restored.focus, 'Controls help (Shift+F1)');
    assert.deepEqual(restored.axes, [0, 0], 'held steering and translation do not return');
    for (const key of ['w', 'i', 'f']) await page.keyboard.up(key);
    await page.waitForFunction(ut => window.__flight.world.ut > ut, before.ut);
    const resumed = await read();
    assert.deepEqual(resumed.warp, before.warp);
    assert.equal(resumed.throttle, 1);
    assert.equal(await page.getByRole('button', { name: 'Close Resources', exact: true }).count(), 1);
    results.push({ rate: index + 1, before, during, restored, resumed });
    await page.screenshot({ path: `${out}/resumed-${index + 1}x.png` });
  }
  // An already paused flight stays paused through click close and Escape close.
  await page.getByRole('button', { name: 'Close Resources', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Paused', exact: true }).waitFor();
  for (const close of ['click', 'escape']) {
    await page.getByRole('button', { name: /^Controls Shift/ }).click();
    const before = await read();
    if (close === 'click') await page.getByRole('button', { name: 'Got it', exact: true }).click();
    else await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Paused', exact: true }).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await read(), before, 'help must not resume an already paused flight');
    results.push({ prePaused: close, before });
  }
  await page.screenshot({ path: `${out}/still-paused.png` });
  await page.keyboard.press('Escape');
  // Deplete just one required propellant; let the real engine step turn ignition off.
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.evaluate(() => { for (const p of window.__flight.world.active.state.parts) if ('liquidFuel' in p.resources) p.resources.liquidFuel = 0; });
  await page.waitForFunction(() => window.__flight.world.active.state.parts.some(p => p.engine?.flamedOut && !p.engine.ignited));
  await page.getByText('Engine propellant depleted or unreachable', { exact: false }).waitFor();
  const burnout = await page.evaluate(() => ({ text: document.body.innerText, engines: window.__flight.world.active.state.parts.filter(p => p.engine).map(p => p.engine) }));
  assert(!burnout.text.includes('Engines are shut down'));
  results.push({ burnout });
  await page.screenshot({ path: `${out}/burnout.png` });
  // Backdrop close and shortcut opening also return focus to an actionable help opener.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Shift+F1');
  await page.getByRole('dialog', { name: 'Flight controls' }).waitFor();
  await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } });
  assert.equal(await help.evaluate(el => el === document.activeElement), true);
  if (multiplayerUrl) {
    const mp = await context.newPage();
    mp.on('pageerror', e => errors.push(e.message));
    await mp.goto(base);
    await mp.evaluate(async url => {
      const { game } = await import('/src/game/store.ts');
      game.set({ multiplayer: { url, room: '', name: 'Help regression' }, scene: 'flight' });
    }, multiplayerUrl);
    await mp.waitForFunction(() => window.__flight?.network?.connected, null, { timeout: 30000 });
    await mp.evaluate(async () => {
      const { STOCK_CRAFTS } = await import('/src/editor/stockCrafts.ts');
      window.__flight.network.send({ v: 1, type: 'launch', craft: STOCK_CRAFTS.find(c => c.id === 'stock-kestrel').build(), site: 'pad' });
    });
    await mp.waitForFunction(() => window.__flight.world.active && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
    await mp.getByRole('button', { name: 'Controls help (Shift+F1)', exact: true }).waitFor();
    await mp.evaluate(() => {
      window.__flight.input.state.throttle = 1;
      window.__helpMessages = [];
      const send = window.__flight.network.send.bind(window.__flight.network);
      window.__flight.network.send = m => { window.__helpMessages.push(m); send(m); };
    });
    await mp.getByRole('button', { name: 'Controls help (Shift+F1)', exact: true }).click();
    await mp.getByText('Flight controls suspended. The shared clock continues.', { exact: true }).waitFor();
    const before = await mp.evaluate(() => ({ ut: window.__flight.world.ut, rate: window.__flight.network.room.rate, player: window.__flight.network.playerId, ownId: window.__flight.network.ownId }));
    await mp.evaluate(() => { window.__helpMessages = []; });
    await mp.keyboard.press('Period'); await mp.keyboard.press('x');
    await mp.waitForTimeout(1200);
    const during = await mp.evaluate(() => ({ ut: window.__flight.world.ut, rate: window.__flight.network.room.rate, player: window.__flight.network.playerId, ownId: window.__flight.network.ownId, messages: window.__helpMessages }));
    assert(during.ut > before.ut, 'the server clock continues');
    assert.equal(during.rate, before.rate);
    assert.equal(during.player, before.player); assert.equal(during.ownId, before.ownId);
    assert(during.messages.some(m => m.type === 'input'));
    assert(during.messages.every(m => m.type === 'input' && m.input.throttle === 0 && !m.input.stage && m.input.pitch === 0 && m.input.translateY === 0), 'only neutral input, no warp/authority messages');
    await mp.screenshot({ path: `${out}/multiplayer-help.png` });
    await mp.keyboard.press('Escape');
    assert.equal(await mp.evaluate(() => window.__flight.paused), false);
    assert.equal(await mp.evaluate(() => window.__flight.input.state.throttle), 1);
    results.push({ multiplayer: { before, during } });
    await mp.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/checks.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ checks: results.length, errors }));
} finally { await context.close(); await browser.close(); }
