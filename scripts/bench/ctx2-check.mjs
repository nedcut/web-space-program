// CDP Chrome regression evidence. Copy beside playwright-core in C:\wsp-tools\drv and run under wsp-gpu.lock.
// node ctx2-check.mjs http://172.24.204.38:5582 ctx|thumbs|sea|terrain|lod-cost
// mercury-detail <file> uses the pre-10c1efe8 detail block from materials.ts ("// Three octaves;" up to,
// excluding, "float microFade") for a same-scene shader A/B; the file is plain shader source.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const [base, mode = 'ctx'] = process.argv.slice(2);
const oldDetail = mode === 'mercury-detail' ? readFileSync(process.argv[4], 'utf8') : null;
const dir = 'C:/wsp-tools/shots/ctx2';
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
  window.__contexts = [];
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
    const gl = get.call(this, type, ...rest);
    if (gl && /webgl/.test(type) && !window.__contexts.some(e => e.gl === gl)) {
      const e = { gl, canvas: this, ext: gl.getExtension('WEBGL_lose_context'), events: [] };
      this.addEventListener('webglcontextlost', () => e.events.push('lost'));
      this.addEventListener('webglcontextrestored', () => e.events.push('restored'));
      window.__contexts.push(e);
    }
    return gl;
  };
  const blob = HTMLCanvasElement.prototype.toBlob, data = HTMLCanvasElement.prototype.toDataURL;
  window.__readbacks = 0;
  const trigger = canvas => {
    const entry = window.__contexts.find(e => e.canvas === canvas);
    entry.ext.loseContext(); window.__triggered = true;
    setTimeout(() => entry.ext.restoreContext(), window.__hold || 1500);
  };
  HTMLCanvasElement.prototype.toBlob = function(...args) {
    if (this.width === 160 && window.__loseParts && ++window.__readbacks === 2) trigger(this);
    return blob.apply(this, args);
  };
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    if (this.width === 160 && window.__loseCraft && !window.__triggered) trigger(this);
    return data.apply(this, args);
  };
});
const sleep = ms => page.waitForTimeout(ms);
const shot = async name => {
  const b = await page.screenshot({ path: `${dir}/${name}.png` });
  return b.toString('base64');
};
const diff = (a, b) => page.evaluate(async ([a, b]) => {
  const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/png;base64,${s}`; });
  const images = await Promise.all([load(a), load(b)]);
  const px = images.map(i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; });
  let sum = 0, sea = 0, n = 0, ns = 0;
  for (let y = 0; y < images[0].height; y += 2) for (let x = 0; x < images[0].width; x += 2) {
    const at = (y * images[0].width + x) * 4;
    const d = (Math.abs(px[0][at] - px[1][at]) + Math.abs(px[0][at+1] - px[1][at+1]) + Math.abs(px[0][at+2] - px[1][at+2])) / 3;
    sum += d; n++; if (y > images[0].height * .55) { sea += d; ns++; }
  }
  return { mean: sum / n, sea: sea / ns };
}, [a, b]);
const go = async query => { await page.goto(base + query, { timeout: 120000 }); };
const ready = async () => { await page.waitForFunction(() => window.__flight?.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 120000 }); await sleep(4000); };
const imageStats = selector => page.evaluate(async selector => {
  const images = [...document.querySelectorAll(selector)]; let blank = 0;
  for (const im of images) {
    await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const p = x.getImageData(0, 0, c.width, c.height).data;
    let alpha = 0; for (let i = 3; i < p.length; i += 4) alpha += p[i];
    if (!alpha) blank++;
  }
  return { images: images.length, blank };
}, selector);
const loss = async () => {
  await page.evaluate(() => { const e = window.__contexts.find(e => e.canvas.isConnected && e.canvas.width > 500); e.ext.loseContext(); setTimeout(() => e.ext.restoreContext(), 1500); });
  await sleep(15000);
};
try {
  if (mode === 'ctx' || mode === 'thumbs') {
    if (mode === 'ctx') {
    await go('/?scene=spaceCenter&hubCam=2.62,700,100,0,20,-100');
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(c => c.width > 500 && c.style.opacity === '1'), null, { timeout: 120000 });
    await sleep(10000);
    const hub = await shot('hub-before');
    await sleep(1000); results.hubNoise = await diff(hub, await shot('hub-control'));
    await loss(); results.hubRestore = await diff(hub, await shot('hub-restored'));
    await loss(); results.hubRestore2 = await diff(hub, await shot('hub-restored-twice'));
    console.log('hub', JSON.stringify(results));
    await go('/?flight=stock-kestrel'); await ready();
    await page.evaluate(() => { window.__flight.paused = true; }); await sleep(7000);
    const pad = await shot('pad-before'); await loss();
    results.padRestore = await diff(pad, await shot('pad-restored'));
    console.log('pad', JSON.stringify(results.padRestore));
    }
    await page.addInitScript(() => { window.__loseParts = true; });
    await go('/?scene=editor');
    await page.waitForFunction(() => window.__triggered, null, { timeout: 120000 });
    await shot('parts-lost');
    await page.waitForFunction(() => document.querySelectorAll('.vab-thumb img').length >= 24, null, { timeout: 120000 });
    results.parts = await imageStats('.vab-thumb img'); await shot('parts-restored');
    await sleep(4000); await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.vab-thumb img').length >= 24, null, { timeout: 120000 });
    results.partsReload = await imageStats('.vab-thumb img');
    results.partsReload.contexts = await page.evaluate(() => window.__contexts.filter(e => e.canvas.width === 160).length);
    await shot('parts-cache-reload');
    await page.evaluate(() => { window.__loseCraft = true; window.__triggered = false; window.__hold = 6500; });
    await page.getByTitle('Load craft', { exact: true }).click();
    await page.waitForFunction(() => window.__triggered, null, { timeout: 120000 });
    await sleep(2000); results.craftsDuringLoss = await imageStats('.vab-stock img'); await shot('crafts-lost');
    await page.waitForFunction(() => document.querySelectorAll('.vab-stock img').length === document.querySelectorAll('.vab-stock').length, null, { timeout: 120000 });
    results.crafts = await imageStats('.vab-stock img'); await shot('crafts-restored');
    results.contexts = await page.evaluate(() => window.__contexts.map(e => ({ width: e.canvas.width, events: e.events })));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTitle('Load craft', { exact: true }).click();
    results.craftsReopen = await imageStats('.vab-stock img'); await shot('crafts-reopened');
  } else if (mode === 'terrain' || mode === 'mercury-detail') {
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
    for (const body of (oldDetail ? ['mercury'] : ['moon','earth','mars','mercury'])) {
      await go(body === 'earth' ? '/?flight=stock-kestrel' : '/?flight=stock-kestrel&scenario=moon'); await ready();
      await page.evaluate(() => {
        const f=window.__flight; f.paused=true;
        const c=f.cam; c.tYaw=c.cYaw=Math.PI*.75; c.tPitch=c.cPitch=.8; c.tDist=c.cDist=30; c.distanceSet=true;
        const s=document.createElement('style'); s.textContent='.hud,.hud *, .toast,[class*="scenario"],[class*="Scenario"]{visibility:hidden!important}'; document.head.appendChild(s);
      });
      results[body] = {};
      for (const alt of [8000,200]) {
        results[body][alt] = await place(body,alt); await sleep(10000);
        await shot(`${body}-${alt}m${oldDetail ? '-current' : ''}`);
        if (oldDetail) {
          results[body][alt].baselineMaterials = await page.evaluate(old => {
            const mats = new Set(); window.__flight.scene.traverse(o => { if(o.material?.uniforms?.uRockBlend) mats.add(o.material); });
            for (const m of mats) {
              m.__current = m.fragmentShader;
              m.fragmentShader = m.fragmentShader.replace(/\/\/ Three octaves[\s\S]*?(?=float microFade)/, old);
              m.needsUpdate = true;
            }
            return mats.size;
          }, oldDetail);
          await sleep(2000); await shot(`${body}-${alt}m-previous-detail`);
          await page.evaluate(() => { window.__flight.scene.traverse(o => { const m=o.material; if(m?.__current) {m.fragmentShader=m.__current; m.needsUpdate=true;} }); });
        }
      }
      if (body === 'moon' || body === 'earth') {
        const frames=[];
        for(let i=0;i<16;i++) {
          frames.push(await place(body,200-i*2,i*8)); await sleep(120);
          await shot(`${body}-motion-${String(i).padStart(2,'0')}`);
        }
        results[body].motion=frames;
        await place(body,200,0); await sleep(5000); await shot(`${body}-motion-return`);
      }
      results[body].render = await page.evaluate(body => {
        const f=window.__flight; let stats;
        f.scene.traverse(o => { if(o.userData?.planet?.body.id===body) stats={...o.userData.planet.stats}; });
        return {stats, renderer:f.pipeline.renderer.getContext().getParameter(f.pipeline.renderer.getContext().RENDERER)};
      },body);
      console.log(body,JSON.stringify(results[body]));
    }
  } else if (mode === 'lod-cost') {
    await go('/?flight=stock-kestrel'); await ready();
    await page.evaluate(() => { window.__flight.paused = true; }); await sleep(6000);
    results.switchCost = await page.evaluate(() => {
      const f=window.__flight,w=f.world,p=f.pipeline;
      const u={ t:w.ut,origin:w.active.state.position,camera:f.cam.camera,sunPos:w.universe.ephem.getBodyState('sun',w.ut).position,dt:0,focusBody:w.active.body,viewportHeight:p.lodViewportHeight,switchViewportHeight:undefined };
      const time=extra => { const start=performance.now(); for(let i=0;i<200;i++) { u.viewportHeight=p.lodViewportHeight; u.switchViewportHeight=extra?p.lodSwitchViewportHeight:undefined; f.planets.update(u); } return (performance.now()-start)/200; };
      time(false);time(true);
      const pairs=[]; for(let i=0;i<15;i++) { if(i%2) { const after=time(true);pairs.push([time(false),after]); } else pairs.push([time(false),time(true)]); }
      const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
      return {unit:'CPU ms per planet-layer update',baseline:median(pairs.map(p=>p[0])),withSwitch:median(pairs.map(p=>p[1])),medianPairedDelta:median(pairs.map(p=>p[1]-p[0])),pairs};
    });
  } else if (mode === 'sea') {
    await go('/?flight=stock-kestrel&scenario=sea'); await ready();
    await page.evaluate(() => {
      const f = window.__flight; f.paused = true;
      const c = f.cam; c.tYaw = c.cYaw = 2.5; c.tPitch = c.cPitch = .12; c.tDist = c.cDist = 35; c.distanceSet = true;
    });
    await sleep(8000);
    await page.evaluate(() => {
      const f = window.__flight; cancelAnimationFrame(f.raf);
      const s = document.createElement('style'); s.textContent = '.hud,.toast {visibility:hidden!important}'; document.head.appendChild(s);
    });
    const frame = async (t, name) => {
      results.oceanMaterials = await page.evaluate(t => {
        const f = window.__flight, mats = new Set();
        f.scene.traverse(o => { const m = o.material; if (m?.uniforms?.uShallow) mats.add(m); });
        for (const m of mats) m.uniforms.uTime.value = t;
        f.pipeline.render(f.scene, f.cam.camera); return mats.size;
      }, t);
      return shot(name);
    };
    const h = 1/120;
    for (const [name, a, b] of [['wrap', 1e5-h, h], ['ordinary', 5e4-h, 5e4+h], ['same', 50000, 50000], ['random', 50000, 53333.3]]) {
      results[name] = await diff(await frame(a, `sea-${name}-a`), await frame(b, `sea-${name}-b`));
    }
  }
  results.errors = errors;
  console.log(JSON.stringify(results, null, 2));
} catch (e) { results.failure = String(e.stack); results.errors = errors; console.error(results); await shot(`${mode}-failure`).catch(() => {}); process.exitCode = 1; }
finally { writeFileSync(`${dir}/${mode}.json`, JSON.stringify(results, null, 2)); await context.close(); await browser.close(); }
