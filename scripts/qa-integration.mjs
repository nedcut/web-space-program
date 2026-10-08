// Integration browser QA. Run against this worktree's Vite server: node scripts/qa-integration.mjs
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('../docs/qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(90000);
const report = { checks: [], errors: [], warnings: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
page.on('dialog', d => d.accept());
const save = () => writeFile(new URL('browser-report.json', out), JSON.stringify(report, null, 2));
const check = async (name, fn) => { console.log('START',name); try { const detail = await fn(); report.checks.push({ name, status: 'pass', detail }); console.log('PASS', name, JSON.stringify(detail ?? '')); } catch (e) { await page.screenshot({path:new URL('failure-'+report.checks.length+'.png',out).pathname,timeout:10000}).catch(()=>{}); console.log('PAGE',await page.locator('body').innerText({timeout:10000}).catch(()=>'')); report.checks.push({ name, status: 'fail', error: e.message }); console.log('FAIL', name, e.message); } await save(); };
const shot = name => page.screenshot({ path: new URL(`${name}.png`, out).pathname, timeout: 90000 });
const scene = async (name, patch = {}) => page.evaluate(async ({name, patch}) => { const {game} = await window.__qaImport('/src/game/store.ts'); game.set({ scene: name, ...patch }); }, {name, patch});
const flightReady = async () => { await page.waitForFunction(() => window.__flight && document.querySelector('.hud-left')); await page.locator('.loading-screen').waitFor({state:'hidden'}); };
try {
  await page.addInitScript(() => { localStorage.setItem('wsp.settings.v1', JSON.stringify({quality:'low', shadows:false, bloom:false, clouds:false, scatter:false, renderScale:0.5, masterVolume:0, reduceMotion:true, autoSaveInterval:0})); localStorage.setItem('wsp.help.seen.v1','1'); });
  await page.goto('http://localhost:5192/');
  await page.evaluate(() => { window.__qaImport = async (path) => {
    const entries=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>new URL(n).pathname===path);
    return import(entries.at(-1) ?? path);
  }; });
  await check('Saturn main menu', async () => { await expect(page.getByRole('button',{name:'New Game',exact:true})).toBeVisible(); await page.waitForTimeout(5000); await shot('menu'); });
  await check('Settings: all five tabs and persisted key capture', async () => {
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    for (const name of ['Graphics','Audio','Controls','Gameplay','Accessibility']) { await page.getByRole('tab',{name,exact:true}).click(); await expect(page.getByRole('tabpanel',{name,exact:true})).toBeVisible(); }
    await page.getByRole('tab',{name:'Controls',exact:true}).click();
    const binding=page.locator('.setting-row').filter({has:page.getByText('Flight Data',{exact:true})}).getByRole('button');
    await binding.click(); await page.keyboard.press('p'); await expect(binding).toHaveText('KeyP');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('wsp.bindings.v1')).flightData)).toEqual(['KeyP']);
    await page.getByRole('button',{name:'Reset default bindings',exact:true}).click();
    await shot('settings-controls');
    await page.getByRole('button',{name:'Done',exact:true}).click();
  });
  for (const mode of ['Science','Career','Sandbox']) await check(`New ${mode} program → hub → editor`, async () => {
    await page.getByRole('button',{name:'New Game',exact:true}).click();
    await page.getByRole('button',{name:mode,exact:true}).click();
    await page.getByRole('button',{name:'Start',exact:true}).click();
    await expect(page.getByText('SPACE CENTER',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:/Integration Hall/}).click();
    await page.waitForFunction(() => window.__editor);
    const result = await page.evaluate(async () => { const {game}=await window.__qaImport('/src/game/store.ts'); window.__editor.loadStock('kestrel'); return {mode:game.get().mode, parts:window.__editor.session.currentCraft().parts.length, palette:document.querySelectorAll('.vab-card').length}; });
    await page.getByRole('button',{name:'Exit to Space Center',exact:true}).click();
    await page.getByRole('button',{name:'Main menu',exact:true}).click();
    return result;
  });
  await check('Stock editor loads: 5 m lifter, mining lander, rover, nuclear ship, station, Titan probe', async () => {
    await scene('editor'); await page.waitForFunction(() => window.__editor);
    const results=[];
    for(const id of ['atlaswake','bedrock','moonmoth','longreach','hearthlight','hazewalker','meridian']) {
      results.push(await page.evaluate(id=>{ window.__editor.loadStock(id); const c=window.__editor.session.currentCraft(); return {id,name:c.name,parts:c.parts.length}; },id));
      await page.waitForTimeout(600);
    }
    await shot('editor-meridian');
    return results;
  });
  await check('Editor launch → flight + all HUD panels fit 1366×768', async () => {
    await page.getByRole('button',{name:/^Launch/}).click(); await flightReady();
    await page.evaluate(() => { window.__flight.paused=true; });
    for (const chip of await page.locator('.app-bar .app-btn[data-tutorial]').all()) if(await chip.getAttribute('aria-pressed') !== 'true') await chip.click();
    const layout=await page.locator('.app-stack').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,bottom:r.bottom,client:e.clientHeight,scroll:e.scrollHeight,viewport:innerHeight};});
    expect(layout.bottom).toBeLessThanOrEqual(768); expect(layout.x).toBeGreaterThanOrEqual(0);
    await shot('flight-all-panels'); return layout;
  });
  await check('Rebound flight data shortcut', async () => {
    await page.evaluate(async()=>{ const {getBindings,saveBindings}=await window.__qaImport('/src/input/bindings.ts'); saveBindings({...getBindings(),flightData:['KeyP'],toggleGear:['KeyO'],eva:['KeyY']}); });
    const chip=page.locator('[data-tutorial="app-flightData"]'); const before=await chip.getAttribute('aria-pressed');
    await page.keyboard.press('p'); await expect(chip).toHaveAttribute('aria-pressed',before==='true'?'false':'true');
    await page.evaluate(async()=>{const {saveBindings,defaultBindings}=await window.__qaImport('/src/input/bindings.ts');saveBindings(defaultBindings());});
  });
  await check('Assist launch to stable orbit (accelerated controller program)', async () => {
    const result=await page.evaluate(async()=>{
      const c=window.__flight; c.paused=true; c.startAssist('orbit');
      if(!c.assist) throw new Error('Ascent assist did not start');
      let steps=0;
      while(c.assist && !c.assist.done && !c.assist.error && steps++<70000) {
        const s=c.assist.update(c.world);
        if(s.coastUntil && s.coastUntil>c.world.ut+2) c.world.advanceRailsTo(s.coastUntil);
        else c.world.tick(0.02,s.input);
      }
      const summary=c.world.orbitSummary(c.world.active); const result={steps,done:c.assist?.done,error:c.assist?.error,body:c.world.active?.body,ap:summary.ap,pe:summary.pe,parts:c.world.active?.state.parts.length};
      c.cancelAssist(); c.input.state.throttle=0; return result;
    });
    expect(result.error).toBeFalsy(); expect(result.pe).toBeGreaterThan(70000); return result;
  });
  await check('Map, maneuver node and flight data', async()=>{
    await page.evaluate(()=>{const c=window.__flight;c.toggleMap();c.world.addNode(c.world.ut+180).prograde=50;});
    await page.waitForTimeout(2500); if(await page.locator('[data-tutorial="app-flightData"]').getAttribute('aria-pressed')!=='true') await page.locator('[data-tutorial="app-flightData"]').click(); await shot('map-flight-data');
    return await page.evaluate(()=>({map:window.__flight.mapMode,nodes:window.__flight.world.nodes}));
  });
  await check('Map node time and delta-v handle dragging with mouse flight enabled',async()=>{
    const start=await page.evaluate(async()=>{
      const c=window.__flight; c.paused=false; window.__qaTick=c.world.tick; c.world.tick=()=>{};
      const {game}=await window.__qaImport('/src/game/store.ts');game.set({settings:{...game.get().settings,mouseFlight:true}});
      const map=c.map;map.scene.updateMatrixWorld(true);
      const g=map.gizmo.find(g=>g.axis==='radial'&&g.sign===1);const p=g.icon.position.clone().project(map.camera);
      const center=g.arrow.position.clone().project(map.camera);const dx=p.x-center.x,dy=-(p.y-center.y),len=Math.hypot(dx,dy);
      return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2,dx:dx/len*50,dy:dy/len*50,radial:c.world.nodes[0].radial,time:c.world.nodes[0].time};
    });
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+start.dx,start.y+start.dy,{steps:8});await page.mouse.up();
    const dragged=await page.evaluate(()=>({radial:window.__flight.world.nodes[0].radial,pitch:window.__flight.input.state.pitch,yaw:window.__flight.input.state.yaw}));
    expect(Math.abs(dragged.radial-start.radial)).toBeGreaterThan(10);expect(dragged.pitch).toBe(0);expect(dragged.yaw).toBe(0);
    const node=await page.evaluate(()=>{const m=window.__flight.map,p=m.nodeIcons[0].position.clone().project(m.camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};});
    await page.mouse.move(node.x,node.y);await page.mouse.down();await page.mouse.move(node.x+50,node.y-30,{steps:8});await page.mouse.up();
    const time=await page.evaluate(()=>window.__flight.world.nodes[0].time);expect(time).not.toBe(start.time);
    await page.evaluate(async()=>{const c=window.__flight;c.paused=true;c.world.tick=window.__qaTick;const {game}=await window.__qaImport('/src/game/store.ts');game.set({settings:{...game.get().settings,mouseFlight:false}});});
    return{...dragged,timeDelta:time-start.time};
  });
  await check('Porkchop transfer-window modal', async()=>{
    await page.getByLabel('Transfer window destination').selectOption('mars'); await page.waitForTimeout(1500); await shot('porkchop'); await page.getByRole('button',{name:'Close',exact:true}).click();
  });
  await check('Console has no runtime or framebuffer errors',async()=>{expect(report.errors).toEqual([]);expect(report.warnings.filter(x=>/INVALID_FRAMEBUFFER|zero size/.test(x))).toEqual([]);});
} finally { await save(); await browser.close(); process.exitCode=report.checks.some(c=>c.status==='fail')||report.errors.length ? 1:0; }
