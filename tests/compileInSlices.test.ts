import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { compileInSlices, programRepresentatives } from '../src/render/core/compileInSlices';

describe('sliced shader warm-up', () => {
  it('keeps one object per program configuration', () => {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry();
    const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat), c = new THREE.Mesh(geo, mat);
    c.receiveShadow = true;
    const inst = new THREE.InstancedMesh(geo, mat, 2);
    const hidden = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    hidden.visible = false;
    scene.add(a, b, c, inst, hidden, new THREE.Group());
    const reps = programRepresentatives([scene]);
    expect(reps).toEqual([a, c, inst, hidden]);
  });

  it('compiles in budgeted slices and picks up objects added meanwhile', async () => {
    const scene = new THREE.Scene();
    const geo = new THREE.BoxGeometry();
    for (let i = 0; i < 5; i++) scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
    const compiled: THREE.Object3D[] = [];
    const renderer = {
      getRenderTarget: () => null, setRenderTarget: () => {}, initTexture: () => {},
      properties: { get: () => ({}) },
      compileAsync: (o: THREE.Object3D) => { compiled.push(o); return Promise.resolve(); },
    } as unknown as THREE.WebGLRenderer;
    let slices = 0;
    const late = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    await compileInSlices(renderer, [scene], new THREE.PerspectiveCamera(), scene, {
      budgetMs: 0,
      yieldFn: async () => { if (++slices === 2) scene.add(late); },
    });
    expect(compiled.length).toBe(6);
    expect(compiled).toContain(late);
    expect(slices).toBeGreaterThanOrEqual(4);
  });
});
