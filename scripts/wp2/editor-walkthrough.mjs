// WP2 editor walkthrough on the real GPU (Windows Chrome over CDP).
// Copy to C:\\wsp-tools\\drv (playwright-core installed there) and run with the Windows node, see docs/BROWSERS.md.
// Usage: node.exe C:\wsp-tools\drv\wp2-editor.mjs <baseUrl> <prefix>
// Screenshots: C:\wsp-tools\shots\<prefix>-<step>.png
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5391/', prefix = 'wp2'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: `C:\\wsp-tools\\shots\\${prefix}-${name}.png` }); console.log('shot', name); };
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(50); } throw new Error('timeout ' + fn); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = {};

await page.goto(base, { waitUntil: 'load' });
await until(() => !!window.__game);
// Warm the editor once, then time a warm entry (hub -> first editor frame).
for (let i = 0; i < 3; i++) {
  await ev(() => window.__game.set({ scene: 'spaceCenter', craft: null }));
  await page.waitForTimeout(1500);
  const t0 = await ev(() => performance.now());
  await ev(() => window.__game.set({ scene: 'editor' }));
  await until(() => !!window.__editor?.view);
  await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const t1 = await ev(() => performance.now());
  (results.editorEntryMs ??= []).push(Math.round(t1 - t0));
}
console.log('editor entry ms', results.editorEntryMs);

// ---------------------------------------------------------------- build: payload, fairing, two stages, four boosters
const ids = await ev(() => {
  const s = window.__editor.session, ed = s.editor;
  s.newCraft();
  const e = s.editor;
  const probe = e.addRoot('probe-cairn');
  e.attachPart('tank-1-short', probe.uid, 'top', 'bottom');
  const fairing = e.attachPart('fairing-1', probe.uid, 'bottom', 'top');
  const upper = e.attachPart('tank-1-mid', fairing.uid, 'bottom', 'top');
  const upperEngine = e.attachPart('eng-gust', upper.uid, 'bottom', 'top');
  const dec = e.attachPart('dec-1', upperEngine.uid, 'bottom', 'top');
  const lower = e.attachPart('tank-1-long', dec.uid, 'bottom', 'top');
  const lower2 = e.attachPart('tank-1-long', lower.uid, 'bottom', 'top');
  const core = e.attachPart('eng-sirocco', lower2.uid, 'bottom', 'top');
  e.setSymmetry({ mode: 'radial', count: 4 });
  const latch = e.surfaceAttach('dec-radial', lower2.uid, { x: 0.625, y: 0.3, z: 0 }, { x: 1, y: 0, z: 0 });
  const booster = e.surfaceAttach('srb-roman-candle', latch.uid, { x: 0, y: 0, z: 0.12 }, { x: 0, y: 0, z: 1 });
  e.setSymmetry({ mode: 'radial', count: 1 });
  s.setName('WP2 Test Rocket');
  void ed;
  return { probe: probe.uid, fairing: fairing.uid, upper: upper.uid, lower: lower.uid, lower2: lower2.uid, core: core.uid, latch: latch.uid, booster: booster.uid };
});
await ev(() => window.__editor.view.frameCraft(true));
results.stages = await ev(() => window.__editor.session.getSnapshot().stages.map(s => s.partUids.map(u => window.__editor.session.getSnapshot().craft.parts.find(p => p.uid === u).partId)));
results.fairing = await ev((uid) => window.__editor.session.getSnapshot().craft.parts.find(p => p.uid === uid).tweaks, ids.fairing);
await shot('01-built');

const screen = (uid) => ev((u) => { const p = window.__editor.view.partScreenPosition(u); const r = document.querySelector('.vab-canvas canvas').getBoundingClientRect(); return p && { x: p.x + r.left, y: p.y + r.top }; }, uid);

// ---------------------------------------------------------------- Alt-click copy of a booster (held set with ghosts)
let b = await screen(ids.booster);
await page.mouse.move(b.x, b.y);
await page.keyboard.down('Alt');
await page.mouse.click(b.x, b.y);
await page.keyboard.up('Alt');
results.copyHeld = await ev(() => ({ held: window.__editor.session.getSnapshot().held?.kind, n: window.__editor.session.editor.held?.parts.length, sym: window.__editor.session.getSnapshot().symmetry }));
const l2 = await screen(ids.lower);
await page.mouse.move(l2.x + 40, l2.y - 30, { steps: 8 });
await page.mouse.move(l2.x + 30, l2.y - 20, { steps: 4 });
await shot('02-alt-copy-ghosts');
await page.mouse.click(l2.x + 30, l2.y - 20);
await page.waitForTimeout(300);
results.afterCopy = await ev(() => ({ parts: window.__editor.session.getSnapshot().craft.parts.length, firstStage: window.__editor.session.getSnapshot().stages[0].partUids.length }));
await shot('03-after-copy-place');
await page.keyboard.press('Control+KeyZ');
await page.waitForTimeout(300);
results.afterUndo = await ev(() => window.__editor.session.getSnapshot().craft.parts.length);

// ---------------------------------------------------------------- pick up one booster: the whole set comes up
b = await screen(ids.latch);
await page.mouse.move(b.x, b.y);
await page.mouse.click(b.x, b.y);
results.pickup = await ev(() => ({ held: window.__editor.session.editor.held?.parts.length, sym: window.__editor.session.getSnapshot().symmetry, remaining: window.__editor.session.getSnapshot().craft.parts.filter(p => p.partId === 'srb-roman-candle').length }));
const lower = await screen(ids.lower2);
await page.mouse.move(lower.x + 25, lower.y + 40, { steps: 8 });
await shot('04-pickup-set');
await page.mouse.click(lower.x + 25, lower.y + 40);
await page.waitForTimeout(300);
results.replaced = await ev(() => ({ boosters: window.__editor.session.getSnapshot().craft.parts.filter(p => p.partId === 'srb-roman-candle').length, symAfter: window.__editor.session.getSnapshot().symmetry }));

// ---------------------------------------------------------------- offset gizmo
await page.keyboard.press('Digit2');
const boosterNow = await ev(() => window.__editor.session.getSnapshot().craft.parts.find(p => p.partId === 'srb-roman-candle').uid);
b = await screen(boosterNow);
await page.mouse.click(b.x, b.y);
await page.mouse.move(b.x + 200, b.y + 200);
await shot('05-offset-gizmo');
// Drag the green (Y) arrow: find it by scanning above the gizmo centre.
const before = await ev((u) => window.__editor.session.getSnapshot().craft.parts.find(p => p.uid === u).position.y, boosterNow);
const g = await screen(boosterNow);
await page.mouse.move(g.x, g.y - 45);
await page.waitForTimeout(150);
await page.mouse.down();
await page.mouse.move(g.x, g.y - 90, { steps: 10 });
await shot('06-offset-drag');
await page.mouse.up();
await page.waitForTimeout(300);
const afterY = await ev((u) => window.__editor.session.getSnapshot().craft.parts.find(p => p.uid === u).position.y, boosterNow);
results.offsetDy = +(afterY - before).toFixed(3);
await shot('07-offset-after');

// ---------------------------------------------------------------- rotate gizmo
await page.keyboard.press('Digit3');
await page.waitForTimeout(200);
await shot('08-rotate-gizmo');
const rot0 = await ev((u) => window.__editor.session.getSnapshot().craft.parts.find(p => p.uid === u).rotation, boosterNow);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(250);
const rot1 = await ev((u) => window.__editor.session.getSnapshot().craft.parts.find(p => p.uid === u).rotation, boosterNow);
results.rotateKey = JSON.stringify(rot0) !== JSON.stringify(rot1);
await shot('09-rotate-after-key');
await page.keyboard.press('Control+KeyZ'); await page.keyboard.press('Control+KeyZ');
await page.waitForTimeout(250);

// ---------------------------------------------------------------- staging: Moon readouts, stage drag
await page.keyboard.press('Digit1');
await page.selectOption('.vab-dv-body select', 'moon');
await page.waitForTimeout(300);
await shot('10-staging-moon');
await page.selectOption('.vab-dv-body select', 'earth');
// Drag the top stage title to the bottom (fires first).
const titles = page.locator('.vab-stage-title');
const n = await titles.count();
if (n > 2) { await titles.nth(0).dragTo(titles.nth(n - 1)); await page.waitForTimeout(300); }
results.manualAfterDrag = await ev(() => window.__editor.session.getSnapshot().manualStaging);
await shot('11-stage-dragged');
await page.locator('.vab-staging-head button[title="Reset to automatic staging"]').click();

// ---------------------------------------------------------------- subassembly drawer
await page.locator('.vab-tab[title^="Subassemblies"]').click();
b = await screen(ids.latch);
await page.mouse.move(b.x, b.y);
await page.mouse.click(b.x, b.y, { button: 'right' });
await page.waitForTimeout(250);
await page.locator('.vab-subs .btn').first().click().catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot('12-subassemblies');

// ---------------------------------------------------------------- delete with undo toast
b = await screen(ids.probe);
await page.mouse.move(b.x, b.y);
await page.waitForTimeout(200);
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
await shot('13-delete-toast');
await page.locator('.vab-toast button').first().click().catch(() => {});
await page.waitForTimeout(200);
results.afterDeleteUndo = await ev(() => window.__editor.session.getSnapshot().craft.parts.length);

// ---------------------------------------------------------------- trackpad: pinch zoom and horizontal pan
const c = { x: 800, y: 450 };
await page.mouse.move(c.x, c.y);
for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -4); // small trackpad deltas
await page.keyboard.down('Control'); for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -6); await page.keyboard.up('Control');
for (let i = 0; i < 12; i++) await page.mouse.wheel(14, 0);
await page.waitForTimeout(600);
await shot('14-trackpad-pan-zoom');
await page.keyboard.press('KeyF');
await page.waitForTimeout(600);

// ---------------------------------------------------------------- fairing close-up, couplers
await ev((uid) => { const v = window.__editor.view; const p = window.__editor.session.getSnapshot().craft.parts.find(q => q.uid === uid); v.setView({ yaw: 0.6, pitch: 0.12, dist: 5.5, targetY: v.lift + p.position.y + 0.7 }); }, ids.fairing);
await page.mouse.move(10, 450);
await page.waitForTimeout(500);
await shot('15-fairing-closeup');
const couplerIds = ['coupler-2-x3', 'coupler-2-x4', 'coupler-1-x2'];
for (const cid of couplerIds) {
  await ev((cid) => {
    const s = window.__editor.session; s.newCraft(); const e = s.editor;
    const pod = e.addRoot('probe-cairn');
    const big = cid.startsWith('coupler-2');
    const tank = big ? e.attachPart('tank-2-mid', e.attachPart('adapt-1-2', pod.uid, 'bottom', 'top').uid, 'bottom', 'top') : e.attachPart('tank-1-mid', pod.uid, 'bottom', 'top');
    const c = e.attachPart(cid, tank.uid, 'bottom', 'top');
    const def = window.__editor.session.getSnapshot && null;
    void def;
    for (const node of ['bottom', 'bottom2', 'bottom3', 'bottom4']) { try { e.attachPart(big ? 'eng-sirocco' : 'eng-mistral', c.uid, node, 'top'); } catch { /* fewer ways */ } }
  }, cid);
  await ev(() => { window.__editor.view.frameCraft(true); const v = window.__editor.view; v.setView({ pitch: -0.25 }, true); });
  await page.waitForTimeout(600);
  await shot('16-' + cid);
}
// Frame timing while idle and while orbiting.
results.timing = await ev(async () => {
  const v = window.__editor.view; const out = [];
  for (let i = 0; i < 30; i++) { await new Promise(r => requestAnimationFrame(r)); out.push(v.timing.update + v.timing.render); }
  return { avgMs: +(out.reduce((a, b) => a + b, 0) / out.length).toFixed(2), calls: v.timing.calls, tris: v.timing.tris };
});
console.log(JSON.stringify(results, null, 1));
console.log(logs.slice(-20).join('\n'));
await page.close();
await ctx.close();
await browser.close();
