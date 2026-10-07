// Vessel art pass 3 captures. Run with Windows Node over CDP 9333 against this worktree's dev server:
//   node.exe partsart3.mjs <label> [cases] [base]
// cases: preview, editor, pad, moon (comma-separated). Writes docs/screenshots/partsart3/<label>-*.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from './partsart-cdp.mjs';
const label = process.argv[2] ?? 'after';
const cases = (process.argv[3] ?? 'preview,editor,pad,moon').split(',');
const base = process.argv[4] ?? 'http://localhost:5323';
const only = process.argv[5]?.split(',');
const out = new URL('../../docs/screenshots/partsart3/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await connect();
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
let page = await context.newPage();
const result = {};
const shot = name => page.screenshot({ path: fileURLToPath(new URL(`${label}-${name}.png`, out)) });
const want = name => !only || only.includes(name);

// Close-up galleries on the studio preview page (deploy = 1 shows legs, arrays and gear extended).
const PREVIEW = [
  ['capsules', 'pod-lantern-1,pod-harbor-3', 0.9, 1],
  ['legs', 'leg-strider,leg-stilt', 0.5, 1],
  ['legs-stowed', 'leg-strider,leg-stilt', 0.5, 0],
  ['legs-mid', 'leg-strider', 1.2, 0.5],
  ['solar', 'solar-fold,solar-wing,solar-grand-1,solar-patch', 0.35, 1],
  ['couplers', 'dec-2,sep-1,dec-radial,dock-1', 0.7, 1],
  ['aero', 'wing-swept,fin-pivot,ctrl-elevon,wing-delta', 0.8, 1],
  ['gear', 'gear-trundle,gear-bogie,rover-wheel-1,gear-skid', 1.1, 1],
  ['small', 'chute-main,rcs-nudge,battery-drum,probe-cairn,nose-1,wheel-reaction-2,light-area,shield-1', 0.7, 1],
];

try {
  if (cases.includes('preview')) {
    for (const [name, parts, angle, deploy] of PREVIEW) {
      if (!want(name)) continue;
      await page.goto(`${base}/parts-preview.html?parts=${parts}&spin=0&angle=${angle}&deploy=${deploy}`);
      await page.waitForTimeout(3000);
      await page.evaluate(async () => { await (await import('/src/render/parts/textures.ts')).partTexturesReady(); });
      await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; });
      await page.waitForTimeout(1200);
      await shot(`preview-${name}`);
    }
  }
  if (cases.includes('editor')) {
    await page.goto(base + '/');
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await page.waitForFunction(() => !!window.__editor?.view);
    for (const [id, focus] of [['selene', 'leg-strider'], ['swift', 'gear-trundle']]) {
      if (!want(`editor-${id}`)) continue;
      await page.evaluate(id => window.__editor.loadStock(id), id);
      await page.waitForTimeout(4000);
      await page.evaluate(async () => { await (await import('/src/render/parts/textures.ts')).partTexturesReady(); });
      await page.waitForTimeout(800);
      await shot(`editor-${id}`);
      // Close view on the part family of interest (craft Y + the view's floor lift).
      await page.evaluate(focus => {
        const v = window.__editor.view, parts = window.__editor.session.getSnapshot().craft.parts;
        const p = parts.find(q => q.partId === focus) ?? parts[0];
        if (v.horizontal) v.setView({ dist: 7.5, targetY: v.lift + 0.3, pitch: 0.28 });
        else v.setView({ dist: 8.5, targetY: v.lift + p.position.y + 0.6, pitch: 0.16 });
      }, focus);
      await page.waitForTimeout(1200);
      await shot(`editor-${id}-close`);
    }
  }
  if (cases.includes('pad') && want('pad')) {
    await page.close(); page = await context.newPage();
    await page.goto(`${base}/?flight=stock-selene`);
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
    await page.evaluate(() => { window.__flight.paused = true; });
    await page.waitForTimeout(7000);
    await page.evaluate(async () => { await (await import('/src/render/parts/textures.ts')).partTexturesReady(); });
    await page.evaluate(() => { const f = window.__flight; f.cam.distance *= 0.75; document.querySelectorAll('.hud').forEach(el => el.style.visibility = 'hidden'); });
    await page.waitForTimeout(2500);
    await shot('pad');
    await page.evaluate(() => { const f = window.__flight; f.cam.distance *= 0.4; });
    await page.waitForTimeout(2500);
    await shot('pad-close');
    result.pad = await page.evaluate(async () => {
      const p = window.__flight.pipeline; const s = [];
      for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); s.push(p.gpuMs); }
      s.sort((a, b) => a - b); return { medianGpuMs: s[20], stats: p.stats };
    });
  }
  if (cases.includes('moon') && want('moon')) {
    // Selene lander stage (everything above the second decoupler) at rest on the Moon, low raking sun.
    await page.close(); page = await context.newPage();
    await page.goto(base + '/');
    await page.evaluate(async () => {
      const { buildMoonLander } = await import('/src/editor/stockCrafts.ts');
      const craft = buildMoonLander();
      const eng = craft.parts.find(p => p.partId === 'eng-doldrum');
      const dec = craft.parts.find(p => p.partId === 'dec-1' && p.parent === eng.uid);
      const drop = new Set([dec.uid]);
      for (let grew = true; grew;) { grew = false; for (const p of craft.parts) if (p.parent !== undefined && drop.has(p.parent) && !drop.has(p.uid)) { drop.add(p.uid); grew = true; } }
      craft.parts = craft.parts.filter(p => !drop.has(p.uid));
      window.__game.set({ craft, scene: 'flight', launchPending: true });
    });
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
    await page.evaluate(async () => {
      const f = window.__flight, w = f.world, u = w.universe, t = w.ut;
      const V = await import('/src/util/vec3.ts');
      const Q = await import('/src/util/quat.ts');
      const { placeOnSurface } = await import('/src/game/scenarios.ts');
      const ms = u.ephem.getBodyState('moon', t), ss = u.ephem.getBodyState('sun', t);
      const sunI = V.normalize(V.sub(ss.position, ms.position));
      const rot = u.ephem.bodyRotation('moon', t);
      const sunB = Q.qRotate(Q.qConj(rot), sunI);
      // 62 degrees from the subsolar point: sun 28 degrees above the horizon.
      const side = V.normalize(V.cross(sunB, { x: 0, y: 0, z: 1 }));
      const a = (62 * Math.PI) / 180;
      const dir = V.add(V.scale(sunB, Math.cos(a)), V.scale(side, Math.sin(a)));
      placeOnSurface(w, w.active, 'moon', dir);
      w.renderHistory.invalidate();
      document.querySelectorAll('.hud').forEach(el => el.style.visibility = 'hidden');
    });
    await page.waitForTimeout(9000);
    await page.evaluate(async () => { await (await import('/src/render/parts/textures.ts')).partTexturesReady(); window.__flight.paused = true; });
    await page.waitForTimeout(1500);
    await shot('moon');
    await page.evaluate(() => { const f = window.__flight; f.cam.distance *= 0.55; });
    await page.waitForTimeout(2500);
    await shot('moon-close');
  }
  writeFileSync(new URL(`${label}-metrics.json`, out), JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
