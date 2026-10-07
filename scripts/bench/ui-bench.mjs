// Production-only UI probe. Build + serve on 5336 before running. Uses local WSL Chromium.
// node scripts/bench/ui-bench.mjs before|after [http://localhost:5336]
import { createRequire } from 'node:module';
const { chromium } = process.platform === 'win32' ? createRequire(import.meta.url)('C:/wsp-tools/drv/node_modules/playwright-core') : await import('@playwright/test');
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'after', base = 'http://localhost:5336', mode = 'catalog'] = process.argv.slice(2);
const browser = process.platform === 'win32' ? await chromium.connectOverCDP('http://127.0.0.1:9333') : await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2 });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', graphicsProfile: 99, masterVolume: 0, adaptiveQuality: false, frameCap: 120 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
  window.__uiBench = { events: [], gaps: [], longTasks: [] };
  let last;
  const frame = now => { if (last) window.__uiBench.gaps.push(now-last); last = now; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  for (const name of ['pointerdown', 'pointerover', 'input', 'keydown', 'wheel']) document.addEventListener(name, e => {
    const start = performance.now();
    // Double rAF: first callback precedes the next paint; second bounds the paint opportunity.
    requestAnimationFrame(() => requestAnimationFrame(() => window.__uiBench.events.push({ name, target: e.target.className, ms: performance.now()-start })));
  }, true);
  new PerformanceObserver(list => window.__uiBench.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const results = { label, base, cpuThrottle: 4, dpr: 2, renderer: process.platform === 'win32' ? 'Windows Chrome CDP (hardware GPU)' : 'WSL Chromium SwiftShader (software GPU)', paintMethod: 'capture event to second rAF; upper bound on next paint opportunity', cases: {}, errors };
const measure = async (name, action) => {
  await page.evaluate(() => { window.__uiBench.events = []; window.__uiBench.gaps = []; });
  for (let i=0; i<8; i++) { await action(i); await page.waitForTimeout(150); }
  await page.waitForTimeout(250);
  results.cases[name] = await page.evaluate(() => {
    const b=window.__uiBench, percentile=(a,p)=>a.toSorted((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)] ?? null;
    return { samples: b.events, p75Ms: percentile(b.events.map(e=>e.ms),.75), p95FrameGapMs: percentile(b.gaps,.95), frames: b.gaps.length };
  });
  console.log(name, results.cases[name].p75Ms);
};
try {
  await page.goto(base);
  await page.bringToFront();
  await page.waitForFunction(() => !!window.__game);
  const enter = async () => {
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await page.waitForFunction(() => !!window.__editor?.view, null, { timeout: 120000 });
  };
  await enter();
  console.log('editor ready');
  if (mode === 'catalog') {
  const thumbnailStart = Date.now();
  await page.waitForFunction(() => document.querySelectorAll('.vab-thumb img').length >= 18, null, { timeout: 120000 });
  results.coldFirst18Ms = Date.now()-thumbnailStart;
  results.thumbnailsAtFirst18 = await page.locator('.vab-thumb img').count();
  await measure('search', async i => { await page.getByPlaceholder('Search parts').fill(i%2 ? '' : 'tank'); });
  await page.getByPlaceholder('Search parts').fill('');
  await measure('hover', async i => { await page.locator('.vab-card').nth(i%6).hover(); });
  await measure('scroll', async i => { await page.locator('.vab-cards').hover(); await page.mouse.wheel(0,i%2 ? -420 : 420); });
  await page.evaluate(() => { document.activeElement?.blur(); window.__editor.loadStock('selene'); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.activeElement?.blur());
  await measure('symmetry', async () => { await page.keyboard.press('x'); });
  await measure('pick-cancel', async () => { await page.locator('.vab-card').first().click(); await page.keyboard.press('Escape'); });
  await page.evaluate(() => window.__editor.session.pickNew('tank-1-short'));
  await measure('held-pointer', async i => { await page.mouse.move(600+i*10,350+i%3*30); });
  await page.keyboard.press('Escape');
  results.thumbnailCount = await page.locator('.vab-thumb img').count();
  results.totalParts = await page.locator('.vab-card').count();
  results.longTasks = await page.evaluate(() => window.__uiBench.longTasks);
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await enter();
  const warmStart=Date.now();
  await page.waitForFunction(() => document.querySelectorAll('.vab-thumb img').length >=18, null, { timeout: 120000 });
  results.warmFirst18Ms=Date.now()-warmStart;
  } else {
    await page.evaluate(() => {
      window.__editor.loadStock('selene');
      const session = window.__editor.session, craft = session.getSnapshot().craft;
      const root = craft.parts.find(p => p.parent === undefined);
      const extra = Array.from({length: 100-craft.parts.length}, (_,i) => ({
        uid: 1000+i, partId: 'tank-1-short', parent: root.uid, attachNode: 'srf', parentNode: 'srf',
        position: {x: 4*Math.cos(i),y: Math.floor(i/12)*2,z:4*Math.sin(i)}, rotation:{x:0,y:0,z:0,w:1}
      }));
      session.load({...craft,parts:[...craft.parts,...extra]}, false);
    });
    await page.waitForTimeout(4000);
    results.partCount = await page.evaluate(() => window.__editor.session.getSnapshot().craft.parts.length);
    await measure('100part-symmetry', () => page.keyboard.press('x'));
    await measure('100part-undo-redo', async () => {
      await page.evaluate(() => window.__editor.session.insertStage(0));
      await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z');
    });
    await page.evaluate(() => window.__editor.session.pickNew('tank-1-short'));
    results.drag = await page.evaluate(() => new Promise(resolve => {
      const samples = [], view = window.__editor.view, canvas = view.renderer.domElement, start = performance.now();
      let last = start;
      const tick = now => {
        samples.push({gap:now-last, update:view.timing.update, render:view.timing.render}); last=now;
        canvas.dispatchEvent(new PointerEvent('pointermove', {clientX:700+Math.sin(now/300)*100, clientY:400+Math.cos(now/300)*100}));
        if (now-start<5000) requestAnimationFrame(tick); else resolve({samples, fps: samples.length*1000/(now-start)});
      }; requestAnimationFrame(tick);
    }));
    // Exact snap/attach correctness and undo on the large fixture.
    results.attachment = await page.evaluate(() => {
      const {view,session}=window.__editor;
      const marker=view.nodeMarkers.find(m=>!m.key.startsWith('h'));
      if (!marker) throw new Error('No free attach node');
      const p=marker.mesh.getWorldPosition(marker.mesh.position.clone()).project(view.camera), rect=view.renderer.domElement.getBoundingClientRect();
      view.renderer.domElement.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+(p.x+1)*rect.width/2,clientY:rect.top+(1-p.y)*rect.height/2}));
      view.updatePlacement();
      const before=session.getSnapshot().craft.parts.length, kind=view.placement?.kind;
      const start=performance.now(); view.click(); const callMs=performance.now()-start;
      const placed=session.getSnapshot().craft.parts.length; session.undo();
      if (placed!==before+1 || session.getSnapshot().craft.parts.length!==before) throw new Error('100-part attach/undo failed');
      return {before,placed,kind,callMs};
    });
    await page.goto(`${base}/?flight=stock-kestrel&scenario=orbit`);
    await page.waitForFunction(() => !!window.__flight?.sceneReady, null, {timeout:120000});
    await page.waitForTimeout(5000);
    await page.evaluate(() => { if(window.__uiProfile) window.__uiProfile.length=0; });
    await page.waitForTimeout(8000);
    results.flightProfile = await page.evaluate(() => window.__uiProfile ?? null);
    await measure('resources-panel', () => page.getByRole('button',{name:'Resources',exact:true}).click());
    await measure('settings-panel', async () => { await page.getByRole('button',{name:'Settings',exact:true}).click(); await page.getByRole('button',{name:'Done',exact:true}).click(); });
    await page.getByRole('button',{name:'Resources',exact:true}).click();
    const header=page.locator('.app-win-head').first(); await header.waitFor();
    const bounds=await header.boundingBox();
    const initial=await page.evaluate(() => sessionStorage.getItem('wsp.hud.apps.v1'));
    await page.mouse.move(bounds.x+70,bounds.y+10); await page.mouse.down();
    await page.mouse.move(bounds.x-200,bounds.y+140,{steps:30});
    results.dragSavedDuringMove=await page.evaluate(() => sessionStorage.getItem('wsp.hud.apps.v1'))!==initial;
    await page.mouse.up();
    results.panelFloating=await page.locator('.app-win.floating').count();
    results.finalPanelBounds=await page.locator('.app-win.floating').first().boundingBox();
    await page.evaluate(() => window.__game.set({scene:'menu'}));
    await page.waitForTimeout(1000);
    await measure('menu-hover', async i => { await page.locator('.menu-actions button').nth(i%2).hover(); });
    results.longTasks=await page.evaluate(() => window.__uiBench.longTasks);
  }

  const out = new URL('../../docs/performance/ui/', import.meta.url);
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL(`${label}.json`,out),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results, (k,v) => ['samples','longTasks'].includes(k) ? undefined : v,null,2));
} catch (e) { console.log(errors, await page.locator('body').innerText()); results.failure=String(e); const out=new URL('../../docs/performance/ui/',import.meta.url); mkdirSync(out,{recursive:true}); writeFileSync(new URL(`${label}-failed.json`,out),JSON.stringify(results,null,2)); throw e; } finally { await context.close(); await browser.close(); }
