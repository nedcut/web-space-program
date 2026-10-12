// op/panels evidence. node panels.mjs <base> <mode: torn|auto> <tag>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, mode = 'torn', tag = 'x'] = process.argv.slice(2);
const dir = 'C:/wsp-tools/shots/panels';
mkdirSync(dir, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [], log = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ graphicsProfile: 99, quality: 'medium', adaptiveQuality: false, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const sleep = ms => page.waitForTimeout(ms);
const shot = name => page.screenshot({ path: `${dir}/${mode}-${tag}-${name}.png` });
const sample = () => page.evaluate(() => {
  const f = window.__flight, w = f.world, wv = w.active, v = wv.state;
  const arrays = v.parts.filter(p => p.def.modules.some(m => m.type === 'solarPanel' && m.tracking));
  const rel = w.relativeState(wv);
  return { t: +(w.ut % 1e5).toFixed(1), alt: Math.round(Math.hypot(rel.position.x, rel.position.y, rel.position.z) - w.universe.body(wv.body).radius),
    q: Math.round(v.telemetry.dynamicPressure), load: +(v.telemetry.deployableLoad ?? 0).toFixed(2),
    arrays: arrays.map(p => `${p.tweaks?.extended ? 'out' : 'in'}:${(p.panelDeploy ?? -1).toFixed(2)}`).join(' '),
    caution: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /PANELS/.test(e.textContent ?? '')).map(e => e.textContent).join(' | '),
    msg: w.messages.map(m => m.text).join(' | ') };
});
try {
  await page.goto(base + '/?flight=stock-meridian', { timeout: 120000 });
  await page.waitForFunction(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
  await sleep(4000);
  await page.evaluate(m => {
    const f = window.__flight;
    const c = f.cam; c.tYaw = c.cYaw = 0.9; c.tPitch = c.cPitch = 0.25; c.tDist = c.cDist = 22; c.distanceSet = true;
    if (m === 'torn') for (const p of f.world.active.state.parts) if (p.def.modules.some(x => x.type === 'solarPanel' && x.tracking)) { p.tweaks = { ...p.tweaks, extended: true, autoDeploy: false }; p.panelDeploy = 1; }
  }, mode);
  await sleep(2500);
  await shot('0-pad');
  log.push(await sample());
  await page.evaluate(() => window.__flight.startAssist('orbit'));
  let shots = new Set(), lastArrays = '';
  for (let i = 0; i < 2 * 420; i++) {
    await sleep(500);
    const s = await sample();
    if (i % 10 === 0 || s.arrays !== lastArrays || s.caution) log.push(s);
    lastArrays = s.arrays;
    if (mode === 'torn') {
      if (s.caution && !shots.has('caution')) { shots.add('caution'); await shot('1-caution'); }
      if (!s.arrays && !shots.has('torn')) { shots.add('torn'); await sleep(300); await shot('2-torn'); await sleep(1500); await shot('3-after'); log.push(await sample()); break; }
    } else {
      if (s.q > 8000 && !shots.has('maxq')) { shots.add('maxq'); await shot('1-maxq-stowed'); }
      if (/out:0\.[3-7]/.test(s.arrays) && !shots.has('opening')) { shots.add('opening'); await shot('2-opening'); }
      if (/out:1\.00/.test(s.arrays) && !shots.has('open')) { shots.add('open'); await sleep(1000); await shot('3-open'); log.push(await sample()); break; }
    }
  }
} catch (e) { errors.push(String(e)); }
writeFileSync(`${dir}/${mode}-${tag}-log.json`, JSON.stringify({ log, errors }, null, 1));
console.log(JSON.stringify(log.slice(-12)), '\nerrors', errors.slice(0, 5));
await context.close();
await browser.close().catch(() => {});
