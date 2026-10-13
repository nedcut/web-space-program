// Run npm run dev and open /scripts/art/menu-portrait.html. Download to public/menu/saturn.webp.
// Original art from the game's own shaders; no external imagery. This exporter is never imported by the app.
import * as THREE from 'three';
import { RenderPipeline, QUALITY_PRESETS } from '../../src/render/core';
import { PlanetRenderer } from '../../src/render/planet/PlanetRenderer';
import { Starfield } from '../../src/render/sky/Starfield';
import { Universe } from '../../src/game/universe';
import { SCALE_PRESETS } from '../../src/sim/bodies/scale';

const canvas = document.querySelector('canvas')!;
const button = document.querySelector('button')!;
const width = 3840, height = 2400;
const quality = {
  ...QUALITY_PRESETS.ultra,
  maxPixelRatio: 1,
  upscale: { ...QUALITY_PRESETS.ultra.upscale, mode: 'off' as const },
  bloom: { ...QUALITY_PRESETS.ultra.bloom, enabled: false },
  shadowMapSize: 0,
  bakedTextureWidth: 1024, // The moons occupy only a few dozen pixels in the final portrait.
  atmosphereScattering: true,
  stars: { ...QUALITY_PRESETS.low.stars, brightness: 1.4 },
  planetDetails: { ...QUALITY_PRESETS.ultra.planetDetails, ringCells: 0 },
};
const pipeline = new RenderPipeline({ canvas, quality, exposure: 1.25 });
pipeline.updateAdaptive(0, false);
pipeline.setSize(width, height);
const universe = new Universe('standard');
const scene = new THREE.Scene();
const stars = new Starfield(quality.stars);
scene.add(stars.group);
const r = universe.body('saturn').radius;
const camera = new THREE.PerspectiveCamera(38, width / height, r * 0.001, r * 5000);
camera.up.set(-0.25, 0, 1).normalize();
camera.position.set(r * 4.7, -r * 6.1, r * 3.1);
camera.lookAt(-r * 2, 0, -r * 0.6);
const planets = ['saturn', 'titan', 'enceladus'].map(id => {
  const body = universe.body(id);
  const planet = new PlanetRenderer(body, body.solidSurface ? universe.terrain(id) : null,
    { quality, farOnly: true, scale: SCALE_PRESETS.standard, sunIlluminance: 5 });
  scene.add(planet.root);
  return planet;
});
function render() {
  planets.forEach((planet, i) => {
    const bodyPosition = i === 1 ? { x: r * 3.1, y: -r * 3.6, z: r * 2.6 }
      : i === 2 ? { x: -r * 2.7, y: -r, z: -r * 0.6 } : { x: 0, y: 0, z: 0 };
    planet.update({ camera, origin: { x: 0, y: 0, z: 0 }, bodyPosition,
      bodyRotation: { x: 0, y: 0, z: 0, w: 1 },
      sunPosition: { x: -r * 1000, y: -r * 700, z: r * 450 },
      dt: 0, time: 0, viewportHeight: height });
    planet.uniforms.uSunColor.value.set(4.6, 4.05, 3.15);
  });
  stars.update(camera, 1);
  pipeline.render(scene, camera);
}
// Warm shader-created sky textures and let the moons' surface bakes finish before freezing the portrait.
async function prepare() {
  for (let frame = 0; frame < 600; frame++) {
    render();
    if (frame >= 3 && planets.every(p => p.surfaceReady)) break;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  if (!planets.every(p => p.surfaceReady)) throw new Error('Moon surface bakes did not finish; do not export incomplete art.');
  render();
  // Read the canvas in the render's task (the drawing buffer is not preserved between frames).
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    b => b ? resolve(b) : reject(new Error('WebP export failed')), 'image/webp', 0.95));
  const url = URL.createObjectURL(blob);
  button.disabled = false;
  button.textContent = `Download ${width} × ${height} portrait (${Math.round(blob.size / 1024)} KB)`;
  button.onclick = () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'saturn.webp';
    link.click();
  };
  // Keep a static preview after disposing the GPU resources.
  const image = document.createElement('img');
  image.src = url;
  image.style.width = '100%';
  canvas.replaceWith(image);
  pipeline.detach(scene);
  planets.forEach(p => p.dispose());
  stars.dispose();
  pipeline.dispose();
}
void prepare().catch(error => { button.textContent = String(error); console.error(error); });
