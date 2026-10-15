// Run with Windows Node over CDP 9333; all output stays beside this worktree.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from './partsart-cdp.mjs';
const label = process.argv[2] ?? 'after';
const base = process.argv[4] ?? 'http://localhost:5333';
const cases = (process.argv[3] ?? 'editor,engine,pad,orbit,heat').split(',');
const out = new URL('../../docs/screenshots/partsart/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await connect();
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__partsArtSource = location.pathname.startsWith('/.tmp/partsart-baseline') ? '/.tmp/partsart-baseline/src' : '/src';
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'medium', shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, graphicsProfile: 99, masterVolume: 0, autoSaveInterval: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
});
let page = await context.newPage();
page.on('pageerror', e => console.error(e.message));
const result = {};
async function shot(name) {
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-${name}.png`, out)), scale: 'device' });
}
try {
  if (cases.includes('editor')) {
    await page.goto(base + '/');
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await page.waitForFunction(() => !!window.__editor?.view);
    for (const id of ['meridian', 'selene', 'pebblecatcher']) {
      await page.evaluate(id => window.__editor.loadStock(id), id);
      await page.waitForTimeout(5000);
      await page.evaluate(async () => { await (await import(window.__partsArtSource + '/render/parts/textures.ts')).partTexturesReady(); });
      await shot(`editor-${id}`);
      await page.evaluate(() => { const v = window.__editor.view; v.setView({ dist: v.dist * 0.5, targetY: v.targetY + (v.dist > 20 ? 4 : 0) }); });
      await page.waitForTimeout(700);
      await shot(`editor-${id}-close`);
    }
  }
  if (cases.includes('engine')) {
    await page.goto(base + '/parts-preview.html?part=eng-zephyr&spin=0&angle=0.7');
    await page.waitForTimeout(5000);
    await shot('engine');
  }
  let flightLoaded = false;
  for (const kind of ['pad', 'orbit', 'heat', 'burn']) {
    if (!cases.includes(kind)) continue;
    if (!flightLoaded) {
      await page.close(); page = await context.newPage();
      await page.goto(`${base}/?flight=stock-selene`);
      await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
      await page.evaluate(() => { window.__flight.paused = true; });
      await page.waitForTimeout(6000);
      flightLoaded = true;
    }
    if (kind !== 'pad') {
      await page.evaluate(async () => {
        const f = window.__flight;
        const { placeInCircularOrbit } = await import(window.__partsArtSource + '/game/scenarios.ts');
        placeInCircularOrbit(f.world, f.world.active, 'earth', 200000);
        f.world.renderHistory.invalidate();
      });
      await page.waitForTimeout(1500);
    }
    await page.evaluate(async kind => {
      const f = window.__flight;
      f.paused = true;
      f.cam.distance *= 0.7;
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const root = f.views.get(f.world.active.state.id).root;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
      const sun = f.lighting.sunLight.position.clone().sub(f.lighting.sunLight.target.position).normalize();
      if (kind !== 'pad') {
        up.crossVectors(sun, up).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        Object.assign(f.world.active.state.orientation, { x: q.x, y: q.y, z: q.z, w: q.w });
        f.world.renderHistory.invalidate();
      }
      const side = new THREE.Vector3().crossVectors(sun, up).normalize();
      f.cam.update = () => {};
      f.cam.camera.up.copy(up);
      f.cam.camera.position.copy(sun).multiplyScalar(42).addScaledVector(side, 22).addScaledVector(up, 2);
      f.cam.camera.lookAt(up.clone().multiplyScalar(3));
      f.cam.camera.zoom = 1.6; f.cam.camera.updateProjectionMatrix();
      if (kind === 'heat') for (const p of f.world.active.state.parts) p.skinTemperature.fill(1450);
      if (kind === 'burn') {
        const v = f.world.active.state;
        const engine = v.parts.filter(p => p.engine).sort((a, b) => a.position.y - b.position.y)[0];
        engine.engine.thrust = 100; // Controlled 30-second burn-history rendering fixture.
        f.views.get(v.id).parts.get(engine.uid).heat.update(engine, 30);
        const target = up.clone().multiplyScalar(engine.position.y - v.com.y);
        f.cam.camera.position.copy(target).addScaledVector(sun, 5).addScaledVector(side, 4).addScaledVector(up, -1);
        f.cam.camera.lookAt(target); f.cam.camera.zoom = 1; f.cam.camera.updateProjectionMatrix();
      }
      document.querySelectorAll('.hud').forEach(el => el.style.visibility = 'hidden');
    }, kind);
    await page.waitForTimeout(2000);
    result[kind] = await page.evaluate(async () => {
      const f = window.__flight, p = f.pipeline;
      const materials = new Set();
      f.views.get(f.world.active.state.id).root.traverseVisible(o => {
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      let resolutions = 0;
      const originalKeys = new Map();
      for (const m of materials) {
        originalKeys.set(m, m.customProgramCacheKey);
        m.customProgramCacheKey = function () { resolutions++; return originalKeys.get(m).call(this); };
      }
      const frame0 = f.framesRendered;
      const samples = [];
      for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); samples.push(p.gpuMs); }
      samples.sort((a, b) => a - b);
      for (const [m, key] of originalKeys) m.customProgramCacheKey = key;
      if (window.__game.get().scene !== 'flight') throw new Error('Scene changed during capture');
      const gl = p.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { programResolutions: resolutions, sampledFrames: f.framesRendered - frame0, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), medianGpuMs: samples[30], stats: p.stats, passes: p.gpuPassMs, parts: f.world.active.state?.parts.length, canvas: [p.renderer.domElement.width, p.renderer.domElement.height] };
    });
    await shot(kind);
    if (kind === 'pad' || kind === 'orbit') {
      await page.evaluate(() => {
        const f = window.__flight, v = f.world.active.state, camera = f.cam.camera;
        const top = Math.max(...v.parts.map(p => p.position.y)) - v.com.y - 4;
        const target = camera.up.clone().multiplyScalar(top);
        camera.position.add(target); camera.lookAt(target);
        camera.zoom = 3.4; camera.updateProjectionMatrix();
      });
      await page.waitForTimeout(700); await shot(kind + '-close');
    }
    console.log(kind, JSON.stringify(result[kind]));
    writeFileSync(new URL(`${label}-metrics.json`, out), JSON.stringify(result, null, 2));
  }
  if (cases.includes('reentry')) {
    await page.close(); page = await context.newPage();
    await page.goto(base + '/?scenario=reentry');
    await page.evaluate(async () => {
      const { buildOrbiter } = await import(window.__partsArtSource + '/editor/stockCrafts.ts');
      const craft = buildOrbiter(); craft.parts = craft.parts.slice(0, 3);
      window.__game.set({ craft, scene: 'flight', launchPending: true });
    });
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
    result.reentry = await page.evaluate(async () => {
      const f = window.__flight; f.paused = true;
      const { neutralInput } = await import(window.__partsArtSource + '/sim/vessel/runtime.ts');
      const input = neutralInput({ sas: 'retrograde', sasReference: 'surface' });
      const { add, sub, scale, normalize } = await import(window.__partsArtSource + '/util/vec3.ts');
      const state = f.world.active.state;
      const body = f.world.universe.body('earth');
      const bs = f.world.universe.ephem.getBodyState('earth', f.world.ut);
      const radial = normalize(sub(state.position, bs.position));
      state.position = add(bs.position, scale(radial, body.radius + 22000));
      state.velocity = add(bs.velocity, add(scale(normalize(sub(state.velocity, bs.velocity)), 4500), scale(radial, -850)));
      let seconds = 0;
      for (let i = 0; i < 7500; i++) {
        f.world.tick(0.02, input); seconds += 0.02;
        if (!f.world.active || Math.max(...f.world.active.state.parts.flatMap(p => p.skinTemperature)) > 1100) break;
      }
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const v = f.world.active.state;
      const q = new THREE.Quaternion(v.orientation.x, v.orientation.y, v.orientation.z, v.orientation.w);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      f.cam.update = () => {};
      f.cam.camera.up.copy(up);
      f.cam.camera.position.copy(side).multiplyScalar(5.2).addScaledVector(up, -2.5);
      f.cam.camera.lookAt(0, 0, 0);
      document.querySelectorAll('.hud').forEach(el => el.style.visibility = 'hidden');
      return { seconds, parts: v.parts.map(p => ({ id: p.partId, skin: p.skinTemperature, ablator: p.resources.ablator })) };
    });
    await page.waitForTimeout(6000);
    await shot('reentry');
    console.log('reentry', JSON.stringify(result.reentry));
  }
  writeFileSync(new URL(`${label}-metrics.json`, out), JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
