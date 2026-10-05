// Repository browser regression for map shader compilation and existing public interactions.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
const base = process.argv[2] ?? 'http://localhost:5209';
await page.goto(`${base}/map-preview.html?focus=saturn&dist=5e7`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
const result = await page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { MapView } = await import('/src/render/map/MapView.ts');
  const { createUniverse } = await import('/src/sim/bodies/index.ts');
  const { createEphemeris } = await import('/src/sim/orbit/ephemeris.ts');
  const bodies = createUniverse('standard'), ephem = createEphemeris(bodies);
  const host = document.createElement('div'); document.body.appendChild(host);
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '1280px', height: '800px' }); host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true }); renderer.setSize(1280,800);
  const map = new MapView(bodies, ephem, host); map.distance = 3e6;
  const orbit = { body: 'earth', mu: bodies.get('earth').gm, a: 8e5, e: .05, i: .2, lan: 0, argPe: 0, m0: 0, epoch: 0 };
  const node = { id: 4, time: 50, prograde: 10, normal: 0, radial: 0 };
  const patch = { orbit, startTime: 0, endTime: 3600, endReason: 'horizon' };
  const future = { ...patch, startTime: 3600, endTime: 7200 };
  const earth = ephem.getBodyState('earth',0).position;
  const input = { t: 0, focusId: 'earth', focus: earth, viewport: { width: 1280, height: 800 },
    vessel: { position: earth, patches: [patch,future], nodes: [node] }, markers: [{ body: 'earth', position: { x: 0,y: 9e5,z: 0 }, label: 'Readout', color: '#d066ff' }],
    comms: { nodes: [{ id: 'a', position: earth }, { id: 'b', position: { x: earth.x+1e6,y:earth.y,z:earth.z } }], links: [{ a: 'a',b: 'b',strength: .7 }] } };
  map.setExtraOrbits([{ id: 'probe', position: { x: earth.x+1e6,y:earth.y,z:earth.z }, orbit }]);
  map.setTarget({ kind: 'vessel', id: 'probe' });
  map.setApproach({ body: 'earth', positionA: { x: 0,y: 1e6,z: 0 },positionB: { x: 0,y: 1.1e6,z: 0 },label: 'Approach' });
  map.update(input); renderer.render(map.scene,map.camera);
  const lines = map.scene.children.filter(o => o.type === 'Line2'), geometries = lines.map(o => o.geometry);
  map.update(input);
  if (map.scene.children.filter(o => o.type === 'Line2').some((o,i) => o.geometry !== geometries[i])) throw new Error('Stable conics rebuilt');
  if (!lines.some(o => o.material.dashed)) throw new Error('Future patch not dashed');
  const detach = map.attachControls(canvas, () => 10);
  const handles = map.scene.children.filter(o => o.type === 'Sprite' && o.renderOrder === 15);
  let picked;
  for (const handle of handles) {
    const p = handle.position.clone().project(map.camera), hit = map.pickManeuver(p.x,p.y);
    if (hit?.axis === 'prograde') { picked = p; break; }
  }
  if (!picked) throw new Error('Maneuver handle not pickable');
  const x = (picked.x*.5+.5)*1280, y = (-picked.y*.5+.5)*800;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX:x,clientY:y,button:0,bubbles:true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX:x+30,clientY:y+10,bubbles:true }));
  window.dispatchEvent(new PointerEvent('pointerup'));
  if (node.prograde === 10) throw new Error('Maneuver dragging did not change delta-v');
  map.setResourceOverlay(['earth']); map.update(input); renderer.render(map.scene,map.camera);
  map.setResourceOverlay([],false); map.update(input); renderer.render(map.scene,map.camera);
  const stats = { stableConics: geometries.length, maneuverDeltaV: node.prograde, rendererCalls: renderer.info.render.calls };
  detach(); map.dispose(); renderer.dispose(); host.remove(); return stats;
});
await page.goto(`${base}/?scene=tracking`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
console.log(JSON.stringify({ ...result, tracking: await page.locator('h2').allTextContents(), errors },null,2));
await browser.close();
if (errors.length) process.exitCode = 1;
