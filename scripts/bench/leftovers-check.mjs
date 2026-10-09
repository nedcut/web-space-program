// CDP Chrome evidence for op/leftovers. Copy beside playwright-core in C:\wsp-tools\drv; run under wsp-gpu.lock.
// node leftovers-check.mjs <base-url> terrain <label>   → <body>-<alt>m-<label>.png for Mercury, Moon, Mars
// node leftovers-check.mjs <base-url> pad <label>       → launch-pad ignition/liftoff sequence
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, mode = 'terrain', label = 'x'] = process.argv.slice(2);
const dir = 'C:/wsp-tools/shots/leftovers';
mkdirSync(dir, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [], results = {};
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ graphicsProfile: 99, quality: 'medium', adaptiveQuality: false, shadows: true, bloom: true, clouds: true, scatter: true, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
const sleep = ms => page.waitForTimeout(ms);
const shot = name => page.screenshot({ path: `${dir}/${name}.png` });
const go = async query => { await page.goto(base + query, { timeout: 120000 }); };
const ready = async () => { await page.waitForFunction(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 120000 }); await sleep(4000); };
const hideHud = () => page.evaluate(() => {
  const s=document.createElement('style'); s.textContent='.hud,.hud *, .toast,[class*="scenario"],[class*="Scenario"]{visibility:hidden!important}'; document.head.appendChild(s);
});
try {
  if (mode === 'terrain') {
    const place = async (body, alt, distance = 0) => page.evaluate(({ body, alt, distance }) => {
      const f = window.__flight, w = f.world, u = w.universe, v = w.active.state;
      f.paused = true; w.active.body = body;
      const bs = u.ephem.getBodyState(body, w.ut), sun = u.ephem.getBodyState('sun', w.ut), b = u.body(body);
      const unit = a => { const n = Math.hypot(...a); return a.map(x => x/n); };
      const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      if (!window.__surfaceStart || window.__surfaceStart.body !== body) {
        let up;
        if (body === 'earth') up = unit([v.position.x-bs.position.x,v.position.y-bs.position.y,v.position.z-bs.position.z]);
        else {
          const s = unit([sun.position.x-bs.position.x,sun.position.y-bs.position.y,sun.position.z-bs.position.z]);
          const tangent = unit(cross(s,[0,0,1])); up = s.map((x,i) => .8*x+.6*tangent[i]);
        }
        window.__surfaceStart = { body, up, east: unit(cross(up,[0,0,1])) };
      }
      const start = window.__surfaceStart;
      const up = unit(start.up.map((x,i) => x + start.east[i]*distance/b.radius));
      let r = b.radius + alt;
      const put = () => { v.position = { x:bs.position.x+up[0]*r,y:bs.position.y+up[1]*r,z:bs.position.z+up[2]*r }; };
      put(); for(let i=0;i<4;i++) { r += alt-u.surfaceInfo(body,v.position,w.ut).heightAboveTerrain; put(); }
      const tangent = unit(cross(up,[0,0,1])), speed = Math.sqrt(b.gm/r);
      v.velocity = {x:bs.velocity.x+tangent[0]*speed,y:bs.velocity.y+tangent[1]*speed,z:bs.velocity.z+tangent[2]*speed};
      return { body, altitude: u.surfaceInfo(body,v.position,w.ut).heightAboveTerrain, distance };
    }, { body, alt, distance });
    for (const body of ['mercury', 'moon', 'mars']) {
      await go('/?flight=stock-kestrel&scenario=moon'); await ready();
      await page.evaluate(() => {
        const f=window.__flight; f.paused=true;
        const c=f.cam; c.tYaw=c.cYaw=Math.PI*.75; c.tPitch=c.cPitch=.8; c.tDist=c.cDist=30; c.distanceSet=true;
      });
      await hideHud();
      results[body] = {};
      for (const alt of [8000, 2000, 200]) {
        results[body][alt] = await place(body, alt); await sleep(10000);
        await shot(`${body}-${alt}m-${label}`);
      }
      console.log(body, JSON.stringify(results[body]));
    }
  }
  if (mode === 'site') {
    // Same body-fixed point as the Node albedo maps; the clock is moved (whole steps) until the sun is ~35° up.
    const sites = [['mercury', -30, 100, 1.6, -2.6], ['mercury', 12, 40, 0, 0], ['moon', 10, -60, 0, 0], ['mars', -20, 30, 0, 0]];
    for (const [body, lat, lon, eastKm, northKm] of sites) {
      await go('/?flight=stock-kestrel&scenario=moon'); await ready();
      await hideHud();
      for (const [alt, pitch] of [[8000, 1.2], [2000, 1.45], [200, 0.9]]) {
        results[`${body}${lat}-${alt}`] = await page.evaluate(({ body, lat, lon, eastKm, northKm, alt, pitch }) => {
          const f = window.__flight, w = f.world, u = w.universe, v = w.active.state, b = u.body(body);
          f.paused = true; w.active.body = body;
          const la = (lat * Math.PI / 180) + northKm * 1000 / b.radius;
          const lo = (lon * Math.PI / 180) + eastKm * 1000 / (b.radius * Math.cos(lat * Math.PI / 180));
          const fixed = { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) };
          const elev = t => {
            const bs = u.ephem.getBodyState(body, t), sun = u.ephem.getBodyState('sun', t);
            const up = u.ephem.fromBodyFixed(body, fixed, t);
            const s = [sun.position.x - bs.position.x, sun.position.y - bs.position.y, sun.position.z - bs.position.z];
            const n = Math.hypot(...s);
            return Math.asin((up.x * s[0] + up.y * s[1] + up.z * s[2]) / n) * 180 / Math.PI;
          };
          if (!window.__siteUt || window.__siteKey !== body + lat) {
            let t = w.ut; const step = body === 'mercury' ? 3600 * 6 : 3600 * 0.5;
            for (let i = 0; i < 4000 && !(elev(t) > 30 && elev(t) < 40); i++) t += step;
            window.__siteUt = t; window.__siteKey = body + lat;
          }
          const t = window.__siteUt; w.ut = t;
          const bs = u.ephem.getBodyState(body, t);
          const up = u.ephem.fromBodyFixed(body, fixed, t);
          let r = b.radius + alt;
          const put = () => { v.position = { x: bs.position.x + up.x * r, y: bs.position.y + up.y * r, z: bs.position.z + up.z * r }; };
          put(); for (let i = 0; i < 4; i++) { r += alt - u.surfaceInfo(body, v.position, t).heightAboveTerrain; put(); }
          // Tangential velocity (a radial orbit upsets the readouts); the world is paused.
          const tx = -up.y, ty = up.x, tn = Math.hypot(tx, ty) || 1, speed = Math.sqrt(b.gm / r);
          v.velocity = { x: bs.velocity.x + tx / tn * speed, y: bs.velocity.y + ty / tn * speed, z: bs.velocity.z };
          const c = f.cam; c.tYaw = c.cYaw = Math.PI * .75; c.tPitch = c.cPitch = pitch; c.tDist = c.cDist = 30; c.distanceSet = true;
          return { ut: t, sunElevation: elev(t), agl: u.surfaceInfo(body, v.position, t).heightAboveTerrain };
        }, { body, lat, lon, eastKm, northKm, alt, pitch });
        await sleep(12000);
        await shot(`site-${body}${lat}-${alt}m-${label}`);
      }
      console.log(body, lat, JSON.stringify(results));
    }
  }
  /*PAD*/
  results.errors = errors;
  console.log(JSON.stringify(results, null, 2));
} catch (e) { results.failure = String(e.stack); results.errors = errors; console.error(results); await shot(`${mode}-${label}-failure`).catch(() => {}); process.exitCode = 1; }
finally { writeFileSync(`${dir}/${mode}-${label}.json`, JSON.stringify(results, null, 2)); await context.close(); await browser.close(); }
