import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { instancedVariant } from '../src/render/core/materialVariants';

describe('program-stable material variants', () => {
  it('returns one cached clone per source, sharing textures and shader patches', () => {
    const map = new THREE.Texture();
    const src = new THREE.MeshStandardMaterial({ map, roughness: 0.4 });
    const patch = vi.fn();
    src.onBeforeCompile = patch;
    src.customProgramCacheKey = () => 'patched';
    const v = instancedVariant(src);
    expect(v).not.toBe(src);
    expect(instancedVariant(src)).toBe(v);
    expect(v.map).toBe(map);
    expect(v.roughness).toBe(0.4);
    expect(v.onBeforeCompile).toBe(patch);
    expect(v.customProgramCacheKey()).toBe('patched');
  });

  it('is disposed with its source', () => {
    const src = new THREE.MeshBasicMaterial();
    const v = instancedVariant(src);
    const disposed = vi.fn();
    v.addEventListener('dispose', disposed);
    src.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
