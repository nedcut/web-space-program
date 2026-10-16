// GPU browser regression check. Connect to an existing Chrome CDP instance; never launches a browser.
// node rcs-pad-browser.mjs <preview-url> <artifact-directory>
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base = 'http://172.24.204.38:5873', dir = 'C:/wsp-tools/shots/rcspad'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, serviceWorkers: 'block', hasTouch: true });
await context.addInitScript(() => {
  if (!localStorage.getItem('wsp.settings.v1')) localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', graphicsProfile: 99, adaptiveQuality: false, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  Object.defineProperty(document, 'hasFocus', { value: () => true });
});
const page = await context.newPage(), errors = [], result = { assertions: [] };
page.on('pageerror', e => errors.push(e.message));
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); result.assertions.push(name); };
const button = direction => page.getByRole('button', { name: `Translate ${direction}`, exact: true });
const waitAxis = value => page.waitForFunction(value => { const s = window.__flight.input.state; return [s.tx, s.ty, s.tz].every((x, i) => Math.abs(x - value[i]) < .0001); }, value);
const centre = async locator => { const b = await locator.boundingBox(); assert(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
try {
  await page.goto(`${base}/?flight=stock-tender&scenario=rendezvous`, { timeout: 120000 });
  await page.waitForFunction(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
  await page.waitForSelector('.rcs-pad');
  await page.waitForTimeout(500);
  check('opens automatically for docking', await page.locator('.rcs-pad').count(), 1);
  check('current default binding labels', await page.locator('.rcs-direction kbd').allTextContents(), ['H', 'J', 'L', 'N', 'I', 'K']);
  await page.mouse.move(...Object.values(await centre(button('right')))); await page.mouse.down(); await waitAxis([1, 0, 0]);
  check('off explanation appears on press', await page.getByRole('status').filter({ hasText: 'No translation: RCS is OFF' }).count(), 1);
  await page.mouse.move(1, 1); await page.mouse.up(); await waitAxis([0, 0, 0]);
  result.assertions.push('capture releases outside the button');
  await page.getByRole('button', { name: /^RCS OFF/ }).click();
  await page.getByRole('button', { name: /^RCS ON/ }).waitFor();
  let togglePoint = await centre(button('right')); await page.mouse.move(togglePoint.x, togglePoint.y); await page.mouse.down(); await waitAxis([1, 0, 0]);
  await page.getByRole('button', { name: /^RCS ON/ }).evaluate(el => el.click()); await page.getByRole('button', { name: /^RCS OFF/ }).waitFor(); await waitAxis([1, 0, 0]);
  await page.getByRole('button', { name: /^RCS OFF/ }).evaluate(el => el.click()); await page.getByRole('button', { name: /^RCS ON/ }).waitFor(); await waitAxis([1, 0, 0]);
  await page.mouse.up(); await waitAxis([0, 0, 0]); result.assertions.push('RCS power changes preserve a held translation intent');
  for (const [direction, expected] of [['up', [0, 0, 1]], ['left', [-1, 0, 0]], ['right', [1, 0, 0]], ['down', [0, 0, -1]], ['forward', [0, 1, 0]], ['back', [0, -1, 0]]]) {
    const p = await centre(button(direction)); await page.mouse.move(p.x, p.y); await page.mouse.down(); await waitAxis(expected);
    check(`${direction} held highlight`, await button(direction).getAttribute('aria-pressed'), 'true');
    await page.mouse.up(); await waitAxis([0, 0, 0]);
  }
  await page.getByRole('button', { name: /^FINE OFF/ }).click();
  await page.getByRole('button', { name: /^FINE ON/ }).waitFor();
  let p = await centre(button('right')); await page.mouse.move(p.x, p.y); await page.mouse.down(); await waitAxis([.35, 0, 0]);
  result.assertions.push('fine toggle applies 35 percent authority');
  await page.mouse.up(); await waitAxis([0, 0, 0]);
  await page.getByRole('button', { name: /^FINE ON/ }).click();
  await page.getByRole('button', { name: /^FINE OFF/ }).waitFor();
  await page.keyboard.down('i'); await waitAxis([0, 1, 0]); check('physical key lights its button', await button('forward').getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('i'); await waitAxis([0, 0, 0]);
  // A real mouse pointer starts capture; dispatch cancellation for that active pointer.
  await button('right').evaluate(el => el.addEventListener('pointerdown', e => { el.dataset.pointer = e.pointerId; }, { once: true }));
  p = await centre(button('right')); await page.mouse.move(p.x, p.y); await page.mouse.down(); await waitAxis([1, 0, 0]);
  await button('right').evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: Number(el.dataset.pointer) })));
  await waitAxis([0, 0, 0]); await page.mouse.up(); result.assertions.push('pointercancel releases held translation');
  const cdp = await context.newCDPSession(page);
  p = await centre(button('up'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await waitAxis([0, 0, 1]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await waitAxis([0, 0, 0]); result.assertions.push('real touch press and cancel');
  p = await centre(button('back'));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' }); await waitAxis([0, -1, 0]);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' }); await waitAxis([0, 0, 0]); result.assertions.push('pen press and release');
  p = await centre(button('left')); await page.mouse.move(p.x, p.y); await page.mouse.down(); await waitAxis([-1, 0, 0]);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await waitAxis([0, 0, 0]); await page.mouse.up(); result.assertions.push('blur releases held translation');
  await page.evaluate(() => { window.__rcsStages = 0; window.__flight.input.onAction(a => { if (a === 'stage') window.__rcsStages++; }); });
  await button('up').focus(); await page.keyboard.down('Space'); await waitAxis([0, 0, 1]); await page.keyboard.up('Space'); await waitAxis([0, 0, 0]);
  check('keyboard activation of a pad button does not stage', await page.evaluate(() => window.__rcsStages), 0);
  // Rebind using the actual settings controls, with the pad visible behind the dialog.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Controls' }).click();
  await page.getByRole('button', { name: 'Translate Up: H', exact: true }).click();
  await page.keyboard.press('y');
  check('rebound label updates while pad is mounted', await button('up').locator('kbd').innerText(), 'Y');
  await page.screenshot({ path: `${dir}/settings.png` });
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  await page.locator('[data-settings-modal]').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /^Resume/ }).click();
  await page.getByRole('button', { name: /^Resume/ }).waitFor({ state: 'detached' });
  await page.keyboard.press('Shift+R'); await page.waitForSelector('.rcs-pad', { state: 'detached' });
  check('dismissal remembered in settings', await page.evaluate(() => JSON.parse(localStorage.getItem('wsp.settings.v1')).autoShowRcsPad), false);
  await page.evaluate(() => { window.__flight.toggleDockingMode(); window.__flight.toggleDockingMode(); }); await page.waitForTimeout(300);
  check('docking does not reopen after dismissal', await page.locator('.rcs-pad').count(), 0);
  await page.keyboard.press('Shift+R'); await page.waitForSelector('.rcs-pad');
  p = await centre(button('forward')); await page.mouse.move(p.x, p.y); await page.mouse.down(); await waitAxis([0, 1, 0]);
  await page.getByRole('button', { name: /^Close RCS translation/ }).evaluate(el => el.click()); await waitAxis([0, 0, 0]); await page.mouse.up(); result.assertions.push('closing the pad releases a held pointer');
  await page.reload({ timeout: 120000 }); await page.waitForFunction(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 120000 }); await page.waitForTimeout(300);
  check('dismissal survives reload', await page.locator('.rcs-pad').count(), 0);
  await page.keyboard.press('Shift+R'); await page.waitForSelector('.rcs-pad');
  await page.screenshot({ path: `${dir}/docked-1470.png` });
  const header = page.locator('.app-win').filter({ has: page.locator('.rcs-pad') }).locator('header');
  const from = await centre(header); await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(1030, 535, { steps: 8 }); await page.mouse.up();
  result.layout = await page.evaluate(() => {
    const rect = selector => { const b = document.querySelector(selector).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return { pad: rect('.app-win:has(.rcs-pad)'), docking: rect('.dock-indicator'), navball: rect('.nb-cluster') };
  });
  await page.screenshot({ path: `${dir}/docking-1470.png` });
  const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  check('pad does not overlap docking or navball at 1470 px', overlap(result.layout.pad, result.layout.docking) || overlap(result.layout.pad, result.layout.navball), false);
  // The pad must interrupt the integrated docking assist exactly like a physical translation key.
  await page.evaluate(() => {
    const f = window.__flight, w = f.world, target = w.vessels.get(w.targetId);
    const port = target.state.parts.find(p => p.def.modules.some(m => m.type === 'dockingPort'));
    f.setTarget(target.state.id, port.uid); f.startAssist('dock');
  });
  await page.waitForFunction(() => window.__flight.assist?.name === 'Auto-dock');
  p = await centre(button('right')); await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForFunction(() => !window.__flight.assist); await waitAxis([1, 0, 0]);
  await page.mouse.up(); await waitAxis([0, 0, 0]); result.assertions.push('pad input cancels auto-dock and hands control back');
  // Five alternating closed/open samples; the profiler measures real flight frames, including HUD work.
  await page.evaluate(() => { window.__flight.sasOn = false; window.__perf.enabled = true; });
  result.performance = [];
  for (let round = 0; round < 5; round++) for (const open of [false, true]) {
    await page.keyboard.press('Shift+R');
    check(`performance sample ${round} pad state`, await page.locator('.rcs-pad').count(), open ? 1 : 0);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__perf.reset()); await page.waitForTimeout(2200);
    result.performance.push(await page.evaluate(({ round, open }) => { const p = window.__flight.pipeline; return { round, open, cpu: window.__perf.summary().cpuMs, sections: window.__perf.summary().sections, frame: window.__perf.summary().frameMs, gpu: p.gpuMs, draws: p.stats.calls, frames: window.__perf.summary().frames }; }, { round, open }));
  }
  result.gpu = await page.evaluate(() => { const r = window.__flight.pipeline.renderer, gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), draws: window.__flight.pipeline.stats.calls }; });
  check('no page errors', errors, []);
} catch (e) {
  result.error = e.stack; await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {}); process.exitCode = 1;
} finally {
  result.errors = errors; writeFileSync(`${dir}/results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  await context.close(); await browser.close();
}
