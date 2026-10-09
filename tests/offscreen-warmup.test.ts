import { expect, it } from 'vitest';
import { offscreenWarmup } from '../src/render/core/offscreenWarmup';
import { ProceduralCubeMap } from '../src/render/core/proceduralCube';
import { programRepresentatives } from '../src/render/core/compileInSlices';

it('exposes a pending cube bake to the flight shader warm-up until it is disposed', () => {
  const before = offscreenWarmup.children.length;
  const map = new ProceduralCubeMap(64, 'vec4 bake(vec3 dir) { return vec4(dir, 1.0); }');
  expect(offscreenWarmup.children.length).toBe(before + 1);
  const reps = programRepresentatives([offscreenWarmup]);
  expect(reps.some(o => (o as unknown as { material: unknown }).material === (map as unknown as { material: unknown }).material)).toBe(true);
  map.dispose();
  expect(offscreenWarmup.children.length).toBe(before);
});
