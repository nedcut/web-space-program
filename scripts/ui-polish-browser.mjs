import { chromium, expect as baseExpect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const expect = baseExpect.configure({ timeout: 120000 });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width:1366,height:768 } });
page.setDefaultTimeout(60000);
const report = { checks: [], errors: [], autoplayWarnings: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (/AudioContext.*not allowed/.test(m.text())) report.autoplayWarnings.push(m.text()); });
await page.addInitScript(() => {
 localStorage.setItem('wsp.help.seen.v1','1');
 localStorage.setItem('wsp.settings.v1',JSON.stringify({quality:'low',shadows:false,bloom:false,clouds:false,renderScale:.5,autoSaveInterval:0}));
 window.__audioContexts=[];
 const Context=window.AudioContext;
 window.AudioContext = new Proxy(Context,{construct(Target,args) { const ctx=new Target(...args);window.__audioContexts.push(ctx);return ctx; }});
});
try {
 await page.goto('http://localhost:5200/?scene=menu');
 await expect(page.getByRole('button',{name:'New Game',exact:true})).toBeVisible();
 await page.waitForTimeout(800);
 expect(await page.evaluate(()=>window.__audioContexts.length)).toBe(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__audioContexts.length)).toBe(1);
 await expect.poll(()=>page.evaluate(()=>window.__audioContexts[0].state)).toBe('running');
 report.checks.push('No pre-gesture context; first real gesture creates one running context');
 for(const name of ['Graphics','Audio','Controls','Gameplay','Accessibility']) { await page.getByRole('tab',{name,exact:true}).click(); await expect(page.getByRole('tabpanel',{name,exact:true})).toBeVisible(); }
 await page.getByRole('tab',{name:'Graphics',exact:true}).focus(); await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('tab',{name:'Audio',exact:true})).toBeFocused();
 await expect(page.getByRole('tab',{name:'Audio',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Accessibility',exact:true}).click();
 await page.getByRole('switch',{name:'Reduce motion (camera effects / flicker)',exact:true}).check();
 expect(await page.evaluate(()=>document.documentElement.dataset.reduceMotion)).toBe('true');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 report.checks.push('All settings tabs, arrow-key navigation, native switches, reduced motion and dialog close');
 await page.getByRole('button',{name:'New Game',exact:true}).click();
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.getByRole('button',{name:/Vehicle Assembly/}).click();
 await expect(page.locator('.vab-topbar')).toBeAttached();
 await expect(page.locator('.vab-card').first()).toBeVisible();
 const palette = await page.locator('.vab-cards').evaluate(el => ({ client:el.clientWidth, scroll:el.scrollWidth }));
 expect(palette.scroll).toBeLessThanOrEqual(palette.client+1);
 report.checks.push('Menu → new program → hub → editor; palette has no horizontal overflow');
 for (const scene of ['research','missions','training','pedia','scenarios','flightlog','tracking']) {
  await page.goto(`http://localhost:5200/?scene=${scene}`);
  await expect(page.locator('h1,h2').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 report.checks.push('All document/tracking screens render within the laptop viewport');
 await page.goto('http://localhost:5200/?flight=stock-meridian');
 await expect(page.locator('[data-tutorial="sas"]')).toBeVisible({timeout:120000});
 await expect(page.locator('[data-tutorial="throttle"]')).toBeVisible();
 report.checks.push('Flight HUD preserves SAS and throttle tutorial hooks');
 expect(report.errors).toEqual([]); expect(report.autoplayWarnings).toEqual([]);
 report.checks.push('Zero page errors and zero AudioContext autoplay warnings');
} finally {
 writeFileSync('docs/screenshots/ui-polish/browser-report.json',JSON.stringify(report,null,2));
 await browser.close();
}
