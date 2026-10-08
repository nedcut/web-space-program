import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkBatch } from '../src/render/planet/ChunkBatch';

function source(value = 1): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(9).fill(value), 3, true));
  geometry.setAttribute('aDetail', new THREE.BufferAttribute(new Float32Array(9).fill(value), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry);
}

describe('visible terrain chunk batches', () => {
  it('retains normalized attributes and rebases matrices before float32 storage', () => {
    const material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, 3, 3);
    const mesh = source(123);
    const solar = 1.5e11;
    mesh.position.set(solar + 12.25 - solar, -4.5, 0.03125);
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
    mesh.updateMatrix();
    batch.place(mesh, false);
    const stored = new THREE.Matrix4();
    batch.mesh.getMatrixAt(0, stored);
    expect(stored.elements[12]).toBe(12.25);
    expect(stored.elements[13]).toBe(-4.5);
    expect(stored.elements[14]).toBe(0.03125);
    expect(batch.mesh.geometry.getAttribute('aColor').normalized).toBe(true);
    expect(Array.from(batch.mesh.geometry.getAttribute('aColor').array).slice(0, 9)).toEqual(Array(9).fill(123));
    batch.dispose(); mesh.geometry.dispose(); material.dispose();
  });

  it('grows for the visible peak and reuses storage through repeated LOD replacements', () => {
    const material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, 3, 3);
    const meshes = Array.from({ length: 70 }, () => source());
    for (const mesh of meshes) batch.place(mesh, true);
    expect(batch.mesh.maxInstanceCount).toBe(128);
    expect(batch.mesh.instanceCount).toBe(70);
    for (const mesh of meshes) { batch.release(mesh); mesh.geometry.dispose(); }
    expect(batch.mesh.visible).toBe(false);
    for (let i = 0; i < 500; i++) {
      const mesh = source(i % 255);
      mesh.position.set(i / 10, 1, 2); mesh.updateMatrix();
      batch.place(mesh, false);
      batch.release(mesh);
      mesh.geometry.dispose();
    }
    expect(batch.mesh.maxInstanceCount).toBe(128);
    expect(batch.mesh.instanceCount).toBe(70);
    expect(batch.mesh.visible).toBe(false);
    batch.dispose(); material.dispose();
  });
});
