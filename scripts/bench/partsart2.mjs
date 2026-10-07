// Part-art pass 2 captures. Run with Windows Node over CDP 9333 against this worktree's dev server.
// node.exe partsart2.mjs <label> [cases] [base]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from './partsart-cdp.mjs';
const label = process.argv[2] ?? 'after';
const cases = (process.argv[3] ?? 'editor,engine,pad,orbit').split(',');
const base = process.argv[4] ?? 'http://localhost:5336';
const out = new URL('../../docs/screenshots/partsart2/', import.meta.url);
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
const only = process.argv[5]?.split(',');
try {
  if (cases.includes('editor')) {
    await page.goto(base + '/');
    await page.evaluate(() => window.__game.set({ scene: 'editor' }));
    await page.waitForFunction(() => !!window.__editor?.view);
    for (const id of only ?? ['selene', 'meridian', 'pebblecatcher']) {
      await page.evaluate(id => window.__editor.loadStock(id), id);
      await page.waitForTimeout(5000);
      await page.evaluate(async () => { await (await import('/src/render/parts/textures.ts')).partTexturesReady(); });
      await page.waitForTimeout(500);
      await shot(`editor-${id}`);
      await page.evaluate(() => { const v = window.__editor.view; v.setView({ dist: v.dist * 0.45, targetY: v.targetY + (v.dist > 20 ? 4 : 0) }); });
      await page.waitForTimeout(900);
      await shot(`editor-${id}-close`);
    }
  }
  if (cases.includes('engine')) {
    for (const [part, angle] of [['eng-zephyr', 0.7], ['eng-chinook', 0.5]]) {
      await page.goto(`${base}/parts-preview.html?part=${part}&spin=0&angle=${angle}`);
      await page.waitForTimeout(6000);
      await shot(`engine-${part.slice(4)}`);
    }
  }
  let flightLoaded = false;
  for (const kind of ['pad', 'orbit']) {
    if (!cases.includes(kind)) continue;
    if (!flightLoaded) {
      await page.close(); page = await context.newPage();
      await page.goto(`${base}/?flight=stock-selene`);
      await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000 });
      await page.evaluate(() => { window.__flight.paused = true; });
      await page.waitForTimeout(7000);
      flightLoaded = true;
    }
    if (kind === 'pad') {
      // Default chase camera, slightly closer, HUD hidden.
      await page.evaluate(() => { const f = window.__flight; f.cam.distance *= 0.75; document.querySelectorAll('.hud').forEach(el => el.style.visibility = 'hidden'); });
      await page.waitForTimeout(2500);
      await shot('pad');
      await page.evaluate(() => { const f = window.__flight; f.cam.distance *= 0.45; });
      await page.waitForTimeout(2500);
      await shot('pad-close');
      continue;
    }
    // Orbit: day side, vessel broadside to the sun, camera above it looking down so Earth fills the background.
    await page.evaluate(async () => {
      const f = window.__flight, w = f.world, u = w.universe, t = w.ut;
      const V = await import('/src/util/vec3.ts');
      const { placeInCircularOrbit } = await import('/src/game/scenarios.ts');
      const es = u.ephem.getBodyState('earth', t), ss = u.ephem.getBodyState('sun', t);
      const sun = V.normalize(V.sub(ss.position, es.position));
      const pole = { x: 0, y: 0, z: 1 };
      const perp = V.normalize(V.cross(sun, pole));
      const up = V.normalize(V.add(V.scale(sun, 0.62), V.scale(perp, 0.78)));
      w.active.state.position = V.add(es.position, V.scale(up, u.body('earth').radius + 1000));
      placeInCircularOrbit(w, w.active, 'earth', 220000);
      w.renderHistory.invalidate();
    });
    await page.waitForTimeout(2500);
    await page.evaluate(async () => {
      const f = window.__flight, w = f.world, u = w.universe, t = w.ut;
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const es = u.ephem.getBodyState('earth', t), ss = u.ephem.getBodyState('sun', t), p = w.active.state.position;
      const radial = new THREE.Vector3(p.x - es.position.x, p.y - es.position.y, p.z - es.position.z).normalize();
      const sun = new THREE.Vector3(ss.position.x - p.x, ss.position.y - p.y, ss.position.z - p.z).normalize();
      const sunH = sun.clone().addScaledVector(radial, -sun.dot(radial)).normalize();
      const axis = new THREE.Vector3().crossVectors(radial, sunH).normalize(); // horizontal, perpendicular to sun
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      Object.assign(w.active.state.orientation, { x: q.x, y: q.y, z: q.z, w: q.w });
      w.active.state.angularVelocity = { x: 0, y: 0, z: 0 };
      w.renderHistory.invalidate();
      f.paused = true;
      // Camera: above the craft, looking down past it at the lit planet.
      // Mostly overhead, so the lit planet fills the frame; the sun rakes across the hull at ~70 degrees.
      const camDir = radial.clone().multiplyScalar(0.94).addScaledVector(sunH, -0.342).addScaledVector(axis, 0.12).normalize();
      f.cam.update = () => {};
      const cam = f.cam.camera;
      cam.up.copy(axis);
      cam.position.copy(camDir).multiplyScalar(40);
      cam.lookAt(0, 0, 0);
      cam.zoom = 1.4; cam.updateProjectionMatrix();
      window.__orbitCam = { camDir: camDir.toArray(), axis: axis.toArray() };
      document.querySelectorAll('.hud').forEach(el => el.style.visibility = 'hidden');
    });
    await page.waitForTimeout(4000);
    result.orbit = await page.evaluate(async () => {
      const p = window.__flight.pipeline; const s = [];
      for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); s.push(p.gpuMs); }
      s.sort((a, b) => a - b); return { medianGpuMs: s[20], stats: p.stats };
    });
    await shot('orbit');
    await page.evaluate(() => { const cam = window.__flight.cam.camera; cam.zoom = 3.2; cam.updateProjectionMatrix(); });
    await page.waitForTimeout(1200);
    await shot('orbit-close');
    // Engine close-up in flight light.
    await page.evaluate(async () => {
      const f = window.__flight, v = f.world.active.state;
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const eng = v.parts.filter(p => p.engine).sort((a, b) => a.position.y - b.position.y)[0];
      const axis = new THREE.Vector3().fromArray(window.__orbitCam.axis), camDir = new THREE.Vector3().fromArray(window.__orbitCam.camDir);
      const target = axis.clone().multiplyScalar(eng.position.y - v.com.y + 0.6);
      const cam = f.cam.camera;
      cam.position.copy(target).addScaledVector(camDir, 9).addScaledVector(axis, -1.5);
      cam.lookAt(target); cam.zoom = 1; cam.updateProjectionMatrix();
    });
    await page.waitForTimeout(1500);
    await shot('orbit-engine');
    console.log('orbit', JSON.stringify(result.orbit));
  }
  writeFileSync(new URL(`${label}-metrics.json`, out), JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
