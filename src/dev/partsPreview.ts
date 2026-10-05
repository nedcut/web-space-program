/**
 * Dev-only parts gallery: `npm run dev` then open /parts-preview.html
 * URL params: ?cat=engine  ?part=eng-sirocco  ?plume=1  ?pressure=0.2  ?deploy=1  ?spin=0  ?cols=8
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { PART_DEFS, findModule, partWetMass } from '../data/parts';
import { createStudioEnvironment } from '../render/core/studioEnv';
import { buildPartMesh, createPlume, getExhaustAnchors, setControlDeflection, setEngineGimbal, setPartDeploy, type Plume } from '../render/parts';
import type { PartDef } from '../sim/vessel/types';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.style.position = 'fixed';
labels.domElement.style.inset = '0';
labels.domElement.style.pointerEvents = 'none';
app.appendChild(labels.domElement);

const scene = new THREE.Scene();
const BG = 0x0b1018;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 60, 160);
const studio = createStudioEnvironment(renderer, { variant: 'preview' }).texture;
scene.environment = studio;
scene.environmentIntensity = 0.9;

// Three-point studio rig: warm key (the only shadow caster), cool fill, warm rim; a faint hemisphere lift.
const sun = new THREE.DirectionalLight(0xfff3e6, 2.8);
sun.position.set(30, 50, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xa8c8ff, 0.7);
fill.position.set(-35, 18, 30);
scene.add(fill);
// Rim from the back-left side: its glint on the glossy floor reflects away from the default camera.
const rim = new THREE.DirectionalLight(0xffe6d0, 1.4);
rim.position.set(-45, 22, -14);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xbcd0ec, 0x1a1d22, 0.25));

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Seamless studio floor: a soft light pool under the gallery fading into the background colour (no horizon line).
function floorPoolTexture(): THREE.Texture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#3a4452');
  gr.addColorStop(0.12, '#2a323d');
  gr.addColorStop(0.35, '#121821');
  gr.addColorStop(1, '#080c12');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  // Fine grid, fading with the pool.
  g.globalCompositeOperation = 'overlay';
  g.strokeStyle = 'rgba(160,190,220,0.1)';
  g.lineWidth = 1;
  for (let i = 0; i <= 160; i++) {
    const x = (i / 160) * S;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
    g.beginPath(); g.moveTo(0, x); g.lineTo(S, x); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: floorPoolTexture(), roughness: 0.55, metalness: 0, envMap: studio, envMapIntensity: 0.18 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const catSel = $<HTMLSelectElement>('cat');
for (const c of [...new Set(PART_DEFS.map((p) => p.category))]) {
  const o = document.createElement('option');
  o.value = o.textContent = c;
  catSel.appendChild(o);
}

interface Cell {
  def: PartDef;
  pivot: THREE.Group;
  mesh: THREE.Object3D;
  plumes: Plume[];
}
let cells: Cell[] = [];
const gallery = new THREE.Group();
scene.add(gallery);
const pedestalGeo = new THREE.CylinderGeometry(1.1, 1.2, 0.08, 48);
const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x29323e, roughness: 0.38, metalness: 0.3, envMap: studio, envMapIntensity: 0.45 });

function fmtMass(kg: number) {
  return kg >= 1000 ? `${(kg / 1000).toFixed(kg >= 10000 ? 0 : 1)} t` : `${Math.round(kg)} kg`;
}

function build() {
  for (const c of cells) for (const p of c.plumes) p.dispose();
  gallery.clear();
  cells = [];
  const list = (params.get('parts') ?? params.get('part') ?? '').split(',').filter(Boolean);
  const cat = catSel.value;
  const defs = list.length ? list.map((id) => PART_DEFS.find((d) => d.id === id)!).filter(Boolean) : PART_DEFS.filter((d) => !cat || d.category === cat);
  const single = defs.length <= 4 ? 'few' : null;
  const cols = Math.min(defs.length, Number(params.get('cols')) || Math.max(1, Math.ceil(Math.sqrt(defs.length * 1.6))));
  const spacing = 3.2;
  const rows = Math.ceil(defs.length / cols);
  defs.forEach((def, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * spacing;
    const z = (row - (rows - 1) / 2) * spacing * 1.15;
    const cell = new THREE.Group();
    cell.position.set(x, 0, z);
    gallery.add(cell);
    if (!plumesOn()) {
      const ped = new THREE.Mesh(pedestalGeo, pedestalMat);
      ped.position.y = 0.04;
      ped.receiveShadow = true;
      cell.add(ped);
    }

    const mesh = buildPartMesh(def);
    const bb = new THREE.Box3();
    if (def.mesh !== 'parachute') {
      setPartDeploy(mesh, 1);
      bb.setFromObject(mesh, true);
    }
    setPartDeploy(mesh, 0);
    bb.union(new THREE.Box3().setFromObject(mesh, true));
    const size = bb.getSize(new THREE.Vector3());
    const s = 2.2 / Math.max(size.x, size.y, size.z, 0.3);
    const pivot = new THREE.Group();
    pivot.position.y = 0.08 + 0.15;
    const holder = new THREE.Group();
    holder.scale.setScalar(s);
    const c = bb.getCenter(new THREE.Vector3());
    // plumes need room below engines: lift them
    const isEngine = !!findModule(def, 'engine');
    // in plume mode, hang parts with their top at y = 2.4 so plumes stream into open space
    holder.position.set(-c.x * s, plumesOn() ? 2.4 - bb.max.y * s : -bb.min.y * s, -c.z * s);
    void isEngine;
    holder.add(mesh);
    pivot.add(holder);
    cell.add(pivot);

    const plumes: Plume[] = [];
    const eng = findModule(def, 'engine');
    if (eng && plumesOn()) {
      for (const a of getExhaustAnchors(mesh)) {
        const p = createPlume({ type: eng.plume, exitRadius: a.userData.exitRadius ?? 0.3 });
        a.add(p.object);
        plumes.push(p);
      }
    }

    const el = document.createElement('div');
    el.className = 'label';
    const dims = def.shape.kind === 'cylinder' ? `${(Math.max(def.shape.radiusTop, def.shape.radiusBottom) * 2).toFixed(2)} m` : `${def.shape.size.y.toFixed(2)} m`;
    el.innerHTML = `<b>${def.name}</b><i>${def.manufacturer}</i><br>${fmtMass(partWetMass(def))} · ${dims}`;
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, -0.05, 1.35);
    cell.add(lbl);
    cells.push({ def, pivot, mesh, plumes });
  });
  const w = cols * spacing;
  const d = rows * spacing * 1.15;
  floor.visible = !plumesOn();

  const dist = (single ? 4.2 + w * 0.9 : Math.max(w, d) * 1.05) * (plumesOn() ? 1.3 : 1);
  camera.position.set(dist * 0.12, dist * (single ? 0.3 : 0.75), dist * (single ? 0.95 : 0.7));
  controls.target.set(0, plumesOn() ? 0 : single ? 1.25 : 0.6, single ? 0 : d * 0.04);
  if (plumesOn()) camera.position.y = 1.2;
  // Floor pool sized to the gallery; fog dissolves its far edge into the background (no horizon line).
  floor.scale.setScalar(Math.max(w, d, 6) * 10);
  (scene.fog as THREE.Fog).near = dist * 1.8;
  (scene.fog as THREE.Fog).far = dist * 5;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -Math.max(w, d) * 0.7;
  sun.shadow.camera.right = sun.shadow.camera.top = Math.max(w, d) * 0.7;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.updateProjectionMatrix();
}

const plumesOn = () => $<HTMLInputElement>('plume').checked;
if (params.get('cat')) catSel.value = params.get('cat')!;
if (params.get('plume')) $<HTMLInputElement>('plume').checked = params.get('plume') !== '0';
if (params.get('pressure')) $<HTMLInputElement>('pressure').value = params.get('pressure')!;
if (params.get('throttle')) $<HTMLInputElement>('throttle').value = params.get('throttle')!;
if (params.get('deploy')) $<HTMLInputElement>('deploy').value = params.get('deploy')!;
if (params.get('spin') === '0') $<HTMLInputElement>('spin').checked = false;
if (params.get('cycle')) $<HTMLInputElement>('cycle').checked = true;
catSel.onchange = build;
$<HTMLInputElement>('plume').onchange = build;
build();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});

const timer = new THREE.Timer();
let spinAngle = Number(params.get('angle') ?? 0.6);
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  if ($<HTMLInputElement>('spin').checked) spinAngle += dt * 0.35;
  const cyc = $<HTMLInputElement>('cycle').checked;
  const deploy = cyc ? 0.5 - 0.5 * Math.cos(t * 0.8) : Number($<HTMLInputElement>('deploy').value);
  const pressure = Number($<HTMLInputElement>('pressure').value) * 101325;
  const throttle = Number($<HTMLInputElement>('throttle').value);
  const wiggle = $<HTMLInputElement>('gimbal').checked;
  for (const c of cells) {
    c.pivot.rotation.y = spinAngle;
    // chutes are 10-25 m wide: don't blow them up in the gallery unless explicitly asked
    if (c.def.mesh !== 'parachute' || params.get('chutes')) setPartDeploy(c.mesh, deploy);
    if (wiggle) {
      setEngineGimbal(c.mesh, Math.sin(t * 1.3) * 0.08, Math.cos(t * 1.1) * 0.08);
      setControlDeflection(c.mesh, Math.sin(t * 1.7) * 0.35);
    }
    for (const p of c.plumes) p.update({ throttle, ambientPressure: pressure, time: t });
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

// expose for automated screenshots
(window as unknown as { __previewReady: boolean }).__previewReady = true;
