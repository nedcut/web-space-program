import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createUniverse } from '../src/sim/bodies';
import { createTerrain } from '../src/sim/terrain';
import { PlanetRenderer } from '../src/render/planet/PlanetRenderer';
import { QUALITY_PRESETS } from '../src/render/core/quality';
import { TerrainWorkerPool } from '../src/render/planet/workerPool';

afterEach(() => vi.restoreAllMocks());

describe('planet renderer lifecycle', () => {
  it('backs off a far-LOD bake that keeps failing instead of re-sending it every frame', async () => {
    const body = createUniverse('standard').get('moon')!, pool = new TerrainWorkerPool(0);
    const bake = vi.spyOn(pool, 'bake').mockRejectedValue(new Error('worker failed'));
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const planet = new PlanetRenderer(body, createTerrain(body), { farOnly: true, pool, quality: { ...QUALITY_PRESETS.low, bakedTextureWidth: 16 } });
    const camera = new THREE.PerspectiveCamera(); camera.position.set(3e7, 0, 0);
    const input = { camera, origin: { x: 0, y: 0, z: 0 }, bodyPosition: { x: 0, y: 0, z: 0 },
      bodyRotation: { x: 0, y: 0, z: 0, w: 1 }, sunPosition: { x: 1e10, y: 0, z: 0 }, dt: 1 / 60 };
    const frames = async (n: number) => { for (let i = 0; i < n; i++) { planet.update(input); now += 1000 / 60; await new Promise(r => setTimeout(r, 0)); } };
    try {
      await frames(30); // half a second of frames: one attempt, its failure, then waiting
      expect(bake).toHaveBeenCalledTimes(1);
      await frames(40); // past the first 1 s delay: one retry, then a 2 s wait
      expect(bake).toHaveBeenCalledTimes(2);
      await frames(60);
      expect(bake).toHaveBeenCalledTimes(2);
      await frames(90);
      expect(bake).toHaveBeenCalledTimes(3);
      // A bake that finally works is used as before.
      bake.mockRestore();
      now += 10000;
      await frames(2);
      await vi.waitFor(() => expect(((planet.root.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uHasMap.value).toBe(1));
      expect(planet.surfaceReady).toBe(true);
    } finally { planet.dispose(); pool.dispose(); }
  });
});
