import * as THREE from 'three';
import { RenderPipeline, QUALITY_PRESETS } from '../render/core';
import { PlanetRenderer } from '../render/planet/PlanetRenderer';
import { Starfield } from '../render/sky/Starfield';
import { Universe } from '../game/universe';
import { SCALE_PRESETS, type ScalePresetId } from '../sim/bodies/scale';
import { game } from '../game/store';

/** Camera-local presentation scene; no heliocentric coordinates enter GPU buffers. */
export function mountPlanetPreview(canvas: HTMLCanvasElement, id: string, preset: ScalePresetId, cinematic: boolean, ready: (ok: boolean) => void) {
  const universe = new Universe(preset);
  const quality = { ...QUALITY_PRESETS.low, atmosphereScattering: true };
  const pipeline = new RenderPipeline({ canvas, quality, exposure: 1.25 });
  const scene = new THREE.Scene();
  const stars = new Starfield({ ...quality.stars, brightness: 1.4 });
  scene.add(stars.group);
  const body = universe.body(id);
  const r = body.radius;
  const camera = new THREE.PerspectiveCamera(cinematic ? 38 : 36, 1, r * 0.001, r * 5000);
  camera.up.set(cinematic ? -0.25 : 0, 0, 1).normalize();
  const ids = cinematic ? [id, 'titan', 'enceladus'] : [id];
  const planets = ids.map(bid => {
    const b = universe.body(bid);
    const planet = new PlanetRenderer(b, b.solidSurface ? universe.terrain(bid) : null, { quality, farOnly: true, scale: SCALE_PRESETS[preset], sunIlluminance: 5 });
    scene.add(planet.root);
    return planet;
  });
  let raf = 0, last = 0, elapsed = 0, rendered = false, stopped = false, visible = true;
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  visibility.observe(canvas);
  const setSize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    pipeline.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  setSize();
  const resize = new ResizeObserver(setSize);
  resize.observe(canvas);
  const lost = (event: Event) => { event.preventDefault(); stopped = true; cancelAnimationFrame(raf); ready(false); };
  canvas.addEventListener('webglcontextlost', lost);
  const frame = (now: number) => {
    if (stopped) return;
    if (!visible || now - last < 1000 / 30) { raf = requestAnimationFrame(frame); return; }
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!game.get().settings.reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) elapsed += dt;
    if (cinematic) {
      camera.position.set(r * (4.7 + Math.sin(elapsed * 0.025) * 0.18), -r * 6.1, r * 3.1);
      // Aim left of Saturn, leaving room for the menu typography.
      camera.lookAt(-r * 2.0, 0, -r * 0.6);
    } else {
      const distance = body.rings ? 9 : 5;
      camera.position.set(r * distance, -r * 0.4, r * distance * 0.38);
      camera.lookAt(0, 0, 0);
    }
    planets.forEach((planet, i) => {
      // Moons are staged at their true sizes; positions are a composed portrait, not an ephemeris.
      const position = i === 1 ? { x: r * 3.1, y: -r * 3.6, z: r * 2.6 } : i === 2 ? { x: -r * 2.7, y: -r, z: -r * 0.6 } : { x: 0, y: 0, z: 0 };
      const angle = cinematic ? elapsed * 0.008 : elapsed * 0.09;
      planet.update({ camera, origin: { x: 0, y: 0, z: 0 }, bodyPosition: position,
        bodyRotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
        sunPosition: { x: r * (cinematic ? -1000 : 1000), y: r * -700, z: r * 450 }, dt, viewportHeight: pipeline.drawingBufferHeight });
      planet.uniforms.uSunColor.value.set(4.6, 4.05, 3.15);
    });
    stars.update(camera, pipeline.pixelRatio);
    try {
      pipeline.render(scene, camera);
      if (!rendered) { rendered = true; ready(true); }
      raf = requestAnimationFrame(frame);
    } catch { stopped = true; ready(false); }
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    resize.disconnect();
    visibility.disconnect();
    canvas.removeEventListener('webglcontextlost', lost);
    planets.forEach(p => p.dispose());
    stars.dispose();
    pipeline.dispose();
    pipeline.renderer.forceContextLoss();
  };
}
