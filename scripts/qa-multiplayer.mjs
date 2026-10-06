// Multiplayer browser QA. Start HOST=127.0.0.1 PORT=8792 npm run server, then node scripts/qa-multiplayer.mjs.
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
const save = () => writeFile(new URL('multiplayer-report.json', out), JSON.stringify(report, null, 2));
const check = async (name, fn) => { console.log('START',name); try { const detail = await fn(); report.checks.push({ name, status: 'pass', detail }); console.log('PASS', name, JSON.stringify(detail ?? '')); } catch (e) { await page.screenshot({path:new URL('failure-'+report.checks.length+'.png',out).pathname,timeout:10000}).catch(()=>{}); console.log('PAGE',await page.locator('body').innerText({timeout:10000}).catch(()=>'')); report.checks.push({ name, status: 'fail', error: e.message }); console.log('FAIL', name, e.message); } await save(); };
const shot = name => page.screenshot({ path: new URL(`${name}.png`, out).pathname, timeout: 90000 });
try {
  await page.addInitScript(()=>{localStorage.setItem('wsp.settings.v1',JSON.stringify({quality:'low',shadows:false,bloom:false,clouds:false,scatter:false,renderScale:0.5,masterVolume:0,autoSaveInterval:0,commsEnabled:true,commsRestrictControl:true}));localStorage.setItem('wsp.help.seen.v1','1');localStorage.setItem('wsp.world.v1.autosave','qa-single-player-sentinel');});
  await page.goto('http://localhost:5192/');
  await check('Multiplayer room creation, probe ownership and server comms authority',async()=>{
    await page.getByRole('button',{name:'Multiplayer (experimental)',exact:true}).click();
    await page.getByRole('textbox',{name:'Host URL'}).fill('ws://127.0.0.1:8792');
    await page.getByRole('textbox',{name:'Display name'}).fill('QA pilot');
    await page.getByRole('button',{name:'Create room',exact:true}).click();
    await page.waitForFunction(()=>window.__flight?.network?.connected);
    await page.locator('.loading-screen').waitFor({state:'hidden'});
    await page.getByLabel('Launch craft').selectOption('stock-tender');
    await page.getByRole('button',{name:'Launch',exact:true}).click();
    await page.waitForFunction(()=>window.__flight?.network?.ownId);
    const authority=await page.evaluate(()=>{const c=window.__flight;return{comms:c.world.commsSettings.enabled,canControl:c.world.canControl(),owner:c.network.ownId,active:c.world.activeId,crew:c.world.crewFor().length};});
    expect(authority.comms).toBe(false);expect(authority.canControl).toBe(true);expect(authority.owner).toBe(authority.active);
    await page.keyboard.press('z');await page.keyboard.press('Space');
    await page.waitForFunction(()=>window.__flight.world.active?.mode==='physics');
    await page.keyboard.press('x');await shot('multiplayer');
    expect(await page.locator('[data-tutorial="app-assist"]').count()).toBe(0);
    expect(await page.locator('[data-tutorial="app-science"]').count()).toBe(0);
    expect(await page.locator('[data-tutorial="app-comms"]').count()).toBe(0);
    await page.getByRole('button',{name:'Disconnect to menu',exact:true}).click();
    expect(await page.evaluate(()=>localStorage.getItem('wsp.world.v1.autosave'))).toBe('qa-single-player-sentinel');
    return authority;
  });
  await check('Multiplayer console has no runtime or framebuffer errors',async()=>{expect(report.errors).toEqual([]);expect(report.warnings.filter(x=>/INVALID_FRAMEBUFFER|zero size/.test(x))).toEqual([]);});
}finally{await save();await browser.close();process.exitCode=report.checks.some(c=>c.status==='fail')||report.errors.length ? 1:0;}
