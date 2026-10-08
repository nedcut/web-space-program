import { describe, expect, it } from 'vitest';
import { buildChunk } from '../src/render/planet/chunkBuilder';
import { skyOcclusionRadius } from '../src/render/planet/skyOcclusion';

describe('sky ground occlusion bound', () => {
  it('stays below actual cube-sphere triangle interiors on all faces and LODs', () => {
    const radius = 637100;
    const terrain = { heightAt: () => -1800, minHeight: -1800, maxHeight: -1800, ocean: false };
    for (const res of [8, 24, 32]) for (const level of [0, 2, 6]) for (let face = 0; face < 6; face++) {
      const chunk = buildChunk(terrain, { radius, res, level, face, ix: 0, iy: 0, ocean: false });
      const inner = skyOcclusionRadius(radius, terrain.minHeight, 4 / (res * 2 ** level));
      // Surface triangles only: skirts overlap existing surface and do not make holes.
      for (let i = 0; i < res * res * 6; i += 3) {
        const vertices = [0, 1, 2].map((j) => chunk.indices[i + j] * 3);
        for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
          const xyz = chunk.center.map((center, axis) => center + vertices.reduce((sum, v, j) => sum + chunk.positions[v + axis] * weights[j], 0));
          expect(Math.hypot(...xyz)).toBeGreaterThan(inner);
        }
      }
    }
  });
});
