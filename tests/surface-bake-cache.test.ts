import { describe, expect, it, vi } from 'vitest';
import { TerrainWorkerPool } from '../src/render/planet/workerPool';
import { acquireSurfaceBake } from '../src/render/planet/sharedBake';
import { createUniverse } from '../src/sim/bodies';
import { createTerrain } from '../src/sim/terrain';

function fixture(budget?: number) {
  const pool = new TerrainWorkerPool(0, budget);
  const body = createUniverse('standard').get('moon')!;
  const terrain = createTerrain(body);
  const height = vi.spyOn(terrain, 'heightAt');
  pool.register('moon', body, terrain, 6);
  return { pool, height };
}

describe('surface bake CPU cache', () => {
  it('reuses exact pixels after all scene textures have been disposed', async () => {
    const { pool, height } = fixture();
    const first = acquireSurfaceBake(pool, 'moon', 16);
    const a = await first.promise;
    const samples = height.mock.calls.length;
    const dispose = vi.spyOn(a.texture, 'dispose');
    first.release(); await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
    const second = acquireSurfaceBake(pool, 'moon', 16);
    const b = await second.promise;
    expect(b.texture).not.toBe(a.texture); // GPU ownership never survives the scene
    expect(b.texture.image.data).toBe(a.texture.image.data);
    expect(height).toHaveBeenCalledTimes(samples);
    second.release(); pool.dispose();
  });
  it('bounds retained bytes, separates resolutions, and clears on disposal', async () => {
    const { pool } = fixture(512); // 16×8 RGBA exactly fills the budget
    const a = await pool.bake('moon', 16);
    expect(await pool.bake('moon', 16)).toBe(a);
    await pool.bake('moon', 8); // evicts the 512-byte result
    const b = await pool.bake('moon', 16);
    expect(b).not.toBe(a);
    expect(b.data).toEqual(a.data);
    const oversized = await pool.bake('moon', 32);
    expect(await pool.bake('moon', 32)).not.toBe(oversized);
    pool.dispose();
    await expect(pool.bake('moon', 16)).rejects.toThrow('disposed');
  });
});
