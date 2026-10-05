import * as THREE from 'three';
import { Universe } from '../game/universe';
import { MapView } from '../render/map/MapView';
import { DEFAULT_START_UT } from '../game/store';

const params = new URLSearchParams(location.search);
const universe = new Universe((params.get('scale') as 'standard') ?? 'standard');
const { bodies, ephem } = universe;
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const map = new MapView(bodies, ephem, document.body, universe);
let focusId = params.get('focus') ?? 'sun';
map.distance = +(params.get('dist') ?? 6e11);
map.attachControls(renderer.domElement, () => (bodies.get(focusId)!.radius * 1.5));
const ui = document.getElementById('ui')!;
const sel = document.createElement('select');
for (const b of bodies.values()) sel.add(new Option(b.name, b.id, false, b.id === focusId));
sel.onchange = () => { focusId = sel.value; map.distance = Math.max(bodies.get(focusId)!.radius * 6, 1e6); };
ui.appendChild(sel);
let t = Number(params.get('ut') ?? DEFAULT_START_UT);
renderer.domElement.addEventListener('dblclick', e => {
  const hit = map.pick(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2);
  if (hit) { universe.activateAsteroid(hit.id); map.setTarget(hit); }
});
const loop = () => {
  t += +(params.get('rate') ?? 0);
  map.update({ t, focus: ephem.getBodyState(focusId, t).position, viewport: { width: innerWidth, height: innerHeight } });
  renderer.render(map.scene, map.camera);
  requestAnimationFrame(loop);
};
loop();
