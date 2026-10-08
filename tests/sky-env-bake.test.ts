import { expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { bakeInto } from '../src/render/core/skyEnv';

/** PMREMGenerator's shape: fromScene asks its private allocator for the output target. */
class FakeGenerator {
  allocated = 0;
  _allocateTargets(): THREE.WebGLRenderTarget { this.allocated++; return { dispose: vi.fn() } as unknown as THREE.WebGLRenderTarget; }
  fromScene(): THREE.WebGLRenderTarget { return this._allocateTargets(); }
}

it('allocates the first PMREM target, then re-bakes into it', () => {
  const generator = new FakeGenerator();
  const pmrem = generator as unknown as THREE.PMREMGenerator;
  const scene = {} as THREE.Scene;
  const first = bakeInto(pmrem, scene, null);
  expect(generator.allocated).toBe(1);
  expect(bakeInto(pmrem, scene, first)).toBe(first);
  expect(bakeInto(pmrem, scene, first)).toBe(first);
  expect(generator.allocated).toBe(1);
  expect(first.dispose).not.toHaveBeenCalled();
  // The private allocator is restored after each bake.
  expect(Object.hasOwn(generator, '_allocateTargets')).toBe(false);
  expect(generator.fromScene()).not.toBe(first);
});
