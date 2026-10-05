/**
 * Dev page: visual verification of terrain LOD, atmosphere, rings, sky.
 * URL params (for automated screenshots): body, quality, alt (m), lat, lon, head, pitch, hour, dec, exp, ui=0, fov
 * `window.__preview.ready` becomes true once terrain work has settled.
 */
import * as THREE from 'three';
import { BODY_DEFS } from '../data/bodies';
import { scaleBodyDef, SCALE_PRESETS } from '../sim/bodies/scale';
import type { BodyDef } from '../sim/bodies/types';
import { createTerrain } from '../sim/terrain';
import type { Vec3 } from '../util/vec3';
import { RenderPipeline, getQuality, createPlanetaryCamera, updatePlanetaryClipping, type QualityId } from '../render/core';
import { Starfield, SunGlare } from '../render/sky';
import { PlanetRenderer } from '../render/planet';

const SCALE = SCALE_PRESETS.standard;
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const PREVIEW_IDS = ['earth', 'moon', 'mars', 'saturn', 'titan', 'jupiter', 'io', 'europa', 'enceladus', 'mercury', 'venus', 'uranus', 'neptune', 'callisto', 'iapetus', 'sun'];
const defs = new Map<string, BodyDef>(BODY_DEFS.map((d) => [d.id, d]));

const canvas = $<HTMLCanvasElement>('c');
let qualityId = (params.get('quality') as QualityId) || 'medium';
let quality = getQuality(qualityId);
const pipeline = new RenderPipeline({ canvas, quality, toneMapping: 'aces', exposure: 1 });
const scene = new THREE.Scene();
const camera = createPlanetaryCamera(Number(params.get('fov') ?? 60), innerWidth / innerHeight);
let stars = new Starfield({ count: quality.stars.count, milkyWay: quality.stars.milkyWay });
scene.add(stars.group);
const glare = new SunGlare();
scene.add(glare.mesh);

// --- UI wiring
const bodySel = $<HTMLSelectElement>('body');
for (const id of PREVIEW_IDS) if (defs.has(id)) bodySel.add(new Option(defs.get(id)!.name, id));
const ui = {
  alt: $<HTMLInputElement>('alt'), lat: $<HTMLInputElement>('lat'), lon: $<HTMLInputElement>('lon'),
  head: $<HTMLInputElement>('head'), pitch: $<HTMLInputElement>('pitch'), hour: $<HTMLInputElement>('hour'),
  dec: $<HTMLInputElement>('dec'), exp: $<HTMLInputElement>('exp'), anim: $<HTMLInputElement>('anim'),
  quality: $<HTMLSelectElement>('quality'),
};
if (params.get('ui') === '0') $('panel').classList.add('hidden');
bodySel.value = params.get('body') ?? 'earth';
ui.quality.value = qualityId;
for (const k of ['lat', 'lon', 'head', 'pitch', 'hour', 'dec', 'exp'] as const) {
  const v = params.get(k);
  if (v !== null) { ui[k].step = 'any'; ui[k].value = v; } // Preserve metre-scale ring-plane latitudes from URLs.
}

let body!: BodyDef;
let planet: PlanetRenderer | null = null;
let sun: PlanetRenderer | null = null;
let maxAlt = 1;
const bodyPos: Vec3 = { x: 0, y: 0, z: 0 };
const ORIENT = { x: 0, y: 0, z: 0, w: 1 };

function altFromSlider(v: number): number {
  return 2 * Math.pow(maxAlt / 2, v / 1000);
}
function sliderFromAlt(a: number): number {
  return (Math.log(Math.max(a, 2) / 2) / Math.log(maxAlt / 2)) * 1000;
}

function loadBody(id: string): void {
  planet?.dispose();
  sun?.dispose();
  body = scaleBodyDef(defs.get(id)!, SCALE);
  const sunDef = scaleBodyDef(defs.get('sun')!, SCALE);
  // Place the body at its (scaled) orbital distance from the Sun at the origin.
  const parent = body.parent ? defs.get(body.parent) : undefined;
  const a = (parent && parent.id !== 'sun' ? parent.orbit?.a ?? 1.5e11 : body.orbit?.a ?? 1.5e11) * SCALE.s;
  bodyPos.x = id === 'sun' ? 0 : a;
  maxAlt = body.radius * (body.rings ? 12 : 8);
  const terrain = body.solidSurface ? createTerrain(body) : null;
  planet = new PlanetRenderer(body, terrain, { quality, scale: SCALE });
  scene.add(planet.root);
  if (id !== 'sun') {
    sun = new PlanetRenderer(sunDef, null, { quality, scale: SCALE });
    scene.add(sun.root);
  } else sun = null;
  const altParam = params.get('alt');
  ui.alt.value = String(altParam !== null ? sliderFromAlt(Number(altParam)) : ui.alt.value);
  readyFrames = 0;
  renderedFrames = 0;
}

let readyFrames = 0;
let renderedFrames = 0;
const SETTLE = params.get('settle') === '1';
const state = { ready: false, stats: {} as Record<string, unknown> };
(window as unknown as { __preview: typeof state }).__preview = state;

bodySel.addEventListener('change', () => loadBody(bodySel.value));
ui.quality.addEventListener('change', () => {
  qualityId = ui.quality.value as QualityId;
  quality = getQuality(qualityId);
  pipeline.setQuality(quality);
  scene.remove(stars.group);
  stars.dispose();
  stars = new Starfield({ count: quality.stars.count, milkyWay: quality.stars.milkyWay });
  scene.add(stars.group);
  loadBody(bodySel.value);
});

// Mouse: drag = look around, wheel = altitude.
let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  ui.head.value = String((Number(ui.head.value) + e.movementX * 0.2 + 360) % 360);
  ui.pitch.value = String(Math.max(-90, Math.min(45, Number(ui.pitch.value) - e.movementY * 0.2)));
});
canvas.addEventListener('wheel', (e) => {
  ui.alt.value = String(Math.max(0, Math.min(1000, Number(ui.alt.value) + Math.sign(e.deltaY) * 12)));
  e.preventDefault();
}, { passive: false });

function resize(): void {
  pipeline.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

loadBody(bodySel.value);
resize();

let lastT = performance.now();
let simTime = 0;
const fmt = (m: number) => (m >= 1e6 ? `${(m / 1e3).toFixed(0)} km` : m >= 1e3 ? `${(m / 1e3).toFixed(2)} km` : `${m.toFixed(1)} m`);

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  simTime += dt;
  if (ui.anim.checked) ui.hour.value = String((Number(ui.hour.value) + dt * 0.25) % 24);

  const lat = Number(ui.lat.value) * DEG;
  const lon = Number(ui.lon.value) * DEG;
  const head = Number(ui.head.value) * DEG;
  const pitch = Number(ui.pitch.value) * DEG;
  const hour = Number(ui.hour.value);
  const dec = Number(ui.dec.value) * DEG;
  pipeline.exposure = Math.pow(2, Number(ui.exp.value));
  const alt = altFromSlider(Number(ui.alt.value));
  const R = body.radius;

  // Local frame at (lat, lon) in the body-fixed (= inertial here) frame.
  const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const north = new THREE.Vector3().crossVectors(up, east);
  const ground = planet ? planet.heightAt(up.x, up.y, up.z) : 0;
  const groundClamped = body.surface?.ocean ? Math.max(ground, 0) : ground;
  const camR = R + groundClamped + alt;
  const camSim: Vec3 = { x: bodyPos.x + up.x * camR, y: bodyPos.y + up.y * camR, z: bodyPos.z + up.z * camR };

  // Camera orientation from heading (from north, clockwise) and pitch.
  const fwd = new THREE.Vector3()
    .addScaledVector(north, Math.cos(head) * Math.cos(pitch))
    .addScaledVector(east, Math.sin(head) * Math.cos(pitch))
    .addScaledVector(up, Math.sin(pitch));
  camera.position.set(0, 0, 0); // floating origin = camera
  camera.up.copy(Math.abs(pitch) > 89 * DEG ? north : up);
  camera.lookAt(fwd);
  camera.updateMatrixWorld();
  updatePlanetaryClipping(camera, alt);

  // Sun: local solar time at the camera longitude.
  const ha = lon - (hour - 12) * 15 * DEG;
  const sunDir = new THREE.Vector3(Math.cos(dec) * Math.cos(ha), Math.cos(dec) * Math.sin(ha), Math.sin(dec));
  const sunDist = body.id === 'sun' ? 1e12 : Math.hypot(bodyPos.x, bodyPos.y, bodyPos.z);
  const sunPos: Vec3 = { x: bodyPos.x + sunDir.x * sunDist, y: bodyPos.y + sunDir.y * sunDist, z: bodyPos.z + sunDir.z * sunDist };
  const vh = innerHeight * pipeline.pixelRatio;

  planet!.update({ camera, origin: camSim, bodyPosition: bodyPos, bodyRotation: ORIENT, sunPosition: sunPos, dt, time: simTime, viewportHeight: vh });
  sun?.update({ camera, origin: camSim, bodyPosition: sunPos, bodyRotation: ORIENT, sunPosition: sunPos, dt, time: simTime, viewportHeight: vh });
  stars.update(camera, pipeline.pixelRatio);

  // Glare: occlusion + atmospheric tint along the camera→sun ray.
  if (body.id !== 'sun') {
    const vis = planet!.sunVisibility(camSim, bodyPos, sunPos);
    const m = (vis[0] + vis[1] + vis[2]) / 3;
    const sunRender = new THREE.Vector3(sunPos.x - camSim.x, sunPos.y - camSim.y, sunPos.z - camSim.z).normalize();
    const angR = (696e6 * SCALE.s) / sunDist;
    glare.update(camera, sunRender, m, m > 0 ? [vis[0] / m, vis[1] / m, vis[2] / m] : [1, 1, 1], angR, 1);
    // Eye adaptation: dim stars when the sky is bright.
    const inAtmo = planet!.atmosphere && camR < planet!.atmosphere.atmosphereRadius;
    const dayFactor = inAtmo ? Math.max(0, Math.min(1, up.dot(sunDir) * 4 + 0.6)) : 0;
    stars.setBrightness(1 - 0.97 * dayFactor);
  } else glare.mesh.visible = false;

  // settle=1 (automation): skip GPU work until terrain LOD has converged, then render.
  const settling = SETTLE && readyFrames <= 20;
  if (!settling) {
    pipeline.render(scene, camera);
    renderedFrames++;
  }

  const s = planet!.stats;
  readyFrames = planet!.idle ? readyFrames + 1 : 0;
  state.ready = readyFrames > 20 && renderedFrames > (SETTLE ? 2 : 0);
  state.stats = { ...s };
  $('altV').textContent = fmt(alt);
  $('latV').textContent = `${ui.lat.value}°`;
  $('lonV').textContent = `${ui.lon.value}°`;
  $('headV').textContent = `${ui.head.value}°`;
  $('pitchV').textContent = `${ui.pitch.value}°`;
  $('hourV').textContent = `${Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
  $('decV').textContent = `${ui.dec.value}°`;
  $('expV').textContent = `${Number(ui.exp.value) >= 0 ? '+' : ''}${ui.exp.value} EV`;
  const info = pipeline.renderer.info;
  $('stats').textContent =
    `mode ${s.mode}  chunks ${s.chunks}  meshes ${s.meshes}\n` +
    `jobs ${s.inflight} queued ${s.queued}  ground ${fmt(groundClamped)}\n` +
    `draws ${info.render.calls}  tris ${(info.render.triangles / 1e3).toFixed(0)}k  ${(1 / Math.max(dt, 1e-3)).toFixed(0)} fps\n` +
    `R ${fmt(R)}  ready ${state.ready}`;
}
frame();
