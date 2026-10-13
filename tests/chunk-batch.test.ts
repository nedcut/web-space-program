import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkBatch } from '../src/render/planet/ChunkBatch';

/** Minimal WebGL 2 buffer model: enough to check what the batch stores on the GPU and how it binds. */
class FakeGL {
  readonly FLOAT = 0x1406; readonly UNSIGNED_BYTE = 0x1401; readonly UNSIGNED_SHORT = 0x1403; readonly SHORT = 0x1402; readonly UNSIGNED_INT = 0x1405;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893; readonly COPY_READ_BUFFER = 0x8f36; readonly COPY_WRITE_BUFFER = 0x8f37;
  readonly STATIC_DRAW = 0x88e4; readonly VERTEX_ARRAY_BINDING = 0x85b5;
  readonly canvas = new EventTarget();
  readonly live = new Set<{ data: Uint8Array; type?: string }>();
  private bound = new Map<number, { data: Uint8Array; type?: string } | null>();
  vao: object | null = null;
  vaoElement = new Map<object | null, unknown>();
  createBuffer() { const b = { data: new Uint8Array(0) as Uint8Array, type: undefined as string | undefined }; this.live.add(b); return b; }
  deleteBuffer(b: { data: Uint8Array }) { this.live.delete(b as never); }
  bindBuffer(target: number, b: { data: Uint8Array; type?: string } | null) {
    if (b) {
      const kind = target === this.ELEMENT_ARRAY_BUFFER ? 'element' : target === this.COPY_READ_BUFFER || target === this.COPY_WRITE_BUFFER ? b.type ?? 'other' : 'other';
      if (b.type && b.type !== kind) throw new Error(`buffer type ${b.type} rebound as ${kind}`);
      b.type = kind;
    }
    if (target === this.ELEMENT_ARRAY_BUFFER) this.vaoElement.set(this.vao, b);
    this.bound.set(target, b);
  }
  bufferData(target: number, bytes: number) { this.bound.get(target)!.data = new Uint8Array(bytes); }
  bufferSubData(target: number, offset: number, src: ArrayBufferView) {
    this.bound.get(target)!.data.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength), offset);
  }
  copyBufferSubData(r: number, w: number, ro: number, wo: number, n: number) {
    this.bound.get(w)!.data.set(this.bound.get(r)!.data.subarray(ro, ro + n), wo);
  }
  getParameter() { return this.vao; }
  createVertexArray() { return {}; }
  bindVertexArray(v: object | null) { this.vao = v; }
  deleteVertexArray() {}
}

const V = 3, I = 3;
function source(value = 1): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, value]), 3));
  geometry.setAttribute('aNormalOct', new THREE.BufferAttribute(new Int16Array(6), 2, true));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(12).fill(value), 4, true));
  geometry.setIndex([0, 1, 2]);
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry);
}
type GLAttr = THREE.GLBufferAttribute & { buffer: { data: Uint8Array } };
const attr = (b: ChunkBatch, name: string) => b.mesh.geometry.getAttribute(name) as unknown as GLAttr;
const colorOf = (b: ChunkBatch, slot: number) => attr(b, 'aColor').buffer.data[slot * V * 4];
const indexOf = (b: ChunkBatch, slot: number) => Array.from(new Uint32Array((b.mesh.geometry.index as unknown as GLAttr).buffer.data.buffer.slice(slot * I * 4, (slot + 1) * I * 4)));
const slotOf = (b: ChunkBatch, m: THREE.Mesh) => (b as unknown as { slots: Map<THREE.Mesh, number> }).slots.get(m)!;
const draws = (b: ChunkBatch) => {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1e4);
  cam.position.set(0, 0, 50); cam.updateMatrixWorld();
  b.mesh.onBeforeRender(null as never, null as never, cam, null as never, null as never, null as never);
  return b.drawnChunks;
};
/** Draw ranges of the last draw list as [first slot, slot count]. */
const ranges = (b: ChunkBatch) => {
  const m = b.mesh as unknown as { _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number };
  return Array.from({ length: m._multiDrawCount }, (_, i) => [m._multiDrawStarts[i] / (I * 4), m._multiDrawCounts[i] / I]);
};

describe('visible terrain chunk batches', () => {
  it('uploads straight from chunk arrays, keeps normalized attributes and rebases matrices before float32 storage', () => {
    const gl = new FakeGL(), material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, gl as never, V, I);
    const mesh = source(123);
    const solar = 1.5e11;
    mesh.position.set(solar + 12.25 - solar, -4.5, 0.03125);
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
    mesh.updateMatrix();
    batch.place(mesh, false);
    const m = (batch.mesh as unknown as { _matricesTexture: THREE.DataTexture })._matricesTexture.image.data as Float32Array;
    expect([m[12], m[13], m[14]]).toEqual([12.25, -4.5, 0.03125]);
    expect(attr(batch, 'aColor').normalized).toBe(true);
    expect(attr(batch, 'aColor').type).toBe(gl.UNSIGNED_BYTE);
    expect(Array.from(attr(batch, 'aColor').buffer.data.subarray(0, 12))).toEqual(Array(12).fill(123));
    expect(attr(batch, 'aNormalOct').type).toBe(gl.SHORT);
    expect(attr(batch, 'aNormalOct').normalized).toBe(true);
    expect(indexOf(batch, 0)).toEqual([0, 1, 2]);
    // three treats it as a batch; the index buffer is element-typed and no foreign VAO saw it bound.
    expect((batch.mesh as unknown as { isBatchedMesh: boolean }).isBatchedMesh).toBe(true);
    expect(gl.vaoElement.get(null)).toBeUndefined();
    expect(draws(batch)).toBe(1);
    batch.dispose(); mesh.geometry.dispose(); material.dispose();
    expect(gl.live.size).toBe(0);
  });

  it('merges adjacent visible slots into one draw range and sizes the shader slot to the chunk', () => {
    const gl = new FakeGL(), material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, gl as never, V, I);
    expect(material.defines.CHUNK_SLOT_VERTS).toBe(V);
    const meshes = Array.from({ length: 6 }, (_, i) => source(i + 1));
    for (const mesh of meshes) batch.place(mesh, true);
    expect(draws(batch)).toBe(6);
    expect(ranges(batch)).toEqual([[0, 6]]);
    batch.release(meshes[2]);
    // Culled (behind the camera at z = 50) also splits a run.
    meshes[4].position.set(0, 0, 100); meshes[4].updateMatrix(); batch.place(meshes[4], true);
    expect(draws(batch)).toBe(4);
    expect(ranges(batch)).toEqual([[0, 2], [3, 1], [5, 1]]);
    const other = new THREE.ShaderMaterial();
    batch.setMaterial(other);
    expect(other.defines.CHUNK_SLOT_VERTS).toBe(V);
    batch.dispose(); for (const mesh of meshes) mesh.geometry.dispose(); material.dispose(); other.dispose();
  });

  it('culls on the bounding sphere centre, not the chunk origin the matrix translates', () => {
    const gl = new FakeGL(), material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, gl as never, V, I);
    // Origin far off to the side, sphere centre (rotated by the matrix) back in front of the camera at z = 50.
    const mesh = source();
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5000, 0), 2);
    mesh.position.set(5000, 0, 0);
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    mesh.updateMatrix();
    batch.place(mesh, true);
    expect(draws(batch)).toBe(1);
    mesh.position.set(0, 0, 0); mesh.updateMatrix(); batch.place(mesh, true);
    expect(draws(batch)).toBe(0);
    batch.dispose(); mesh.geometry.dispose(); material.dispose();
  });

  it('grows by 1.5× for the visible peak, keeps slot data, and reuses storage through LOD replacements', () => {
    const gl = new FakeGL(), material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, gl as never, V, I);
    const meshes = Array.from({ length: 70 }, (_, i) => source(i + 1));
    for (const mesh of meshes) batch.place(mesh, true);
    expect(batch.capacity).toBe(72); // 32 → 48 → 72
    expect(batch.live).toBe(70);
    for (const mesh of meshes) expect(colorOf(batch, slotOf(batch, mesh))).toBe(mesh.geometry.getAttribute('aColor').array[0]);
    for (let s = 0; s < 70; s++) expect(indexOf(batch, s)).toEqual([s * V, s * V + 1, s * V + 2]);
    expect(draws(batch)).toBe(70);
    for (const mesh of meshes) { batch.release(mesh); mesh.geometry.dispose(); }
    expect(batch.mesh.visible).toBe(false);
    for (let i = 0; i < 500; i++) {
      const mesh = source(i % 255);
      mesh.position.set(i / 10, 1, 2); mesh.updateMatrix();
      batch.place(mesh, false);
      batch.release(mesh);
      mesh.geometry.dispose();
    }
    expect(batch.capacity).toBe(72);
    expect(batch.mesh.visible).toBe(false);
    batch.dispose(); material.dispose();
  });

  it('shrinks after the live count stays low, compacting live slots GPU-side, and frees everything when idle', () => {
    const gl = new FakeGL(), material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, gl as never, V, I);
    const meshes = Array.from({ length: 200 }, (_, i) => source((i % 250) + 1));
    for (const mesh of meshes) batch.place(mesh, true);
    const peak = batch.capacity;
    expect(peak).toBeGreaterThanOrEqual(200);
    // Keep a scattered few, including the highest slots.
    const kept = meshes.filter((_, i) => i % 13 === 0 || i >= 196);
    for (const mesh of meshes) if (!kept.includes(mesh)) batch.release(mesh);
    batch.maintain(0);
    batch.maintain(5000);
    expect(batch.capacity).toBe(peak); // hysteresis: not yet
    batch.place(meshes[1], true); // a brief rise inside the window raises the target
    batch.maintain(6000);
    batch.release(meshes[1]);
    batch.maintain(9000);
    expect(batch.capacity).toBe(Math.max(32, Math.ceil((kept.length + 1) * 1.5)));
    for (const mesh of kept) {
      const s = slotOf(batch, mesh);
      expect(s).toBeLessThan(batch.capacity);
      expect(colorOf(batch, s)).toBe(mesh.geometry.getAttribute('aColor').array[0]);
      expect(indexOf(batch, s)).toEqual([s * V, s * V + 1, s * V + 2]);
    }
    expect(draws(batch)).toBe(kept.length);
    const before = gl.live.size;
    for (const mesh of kept) batch.release(mesh);
    batch.maintain(10_000);
    batch.maintain(20_000);
    expect(batch.capacity).toBe(0);
    expect(gl.live.size).toBe(before); // old buffers deleted as new (empty) ones are created
    batch.place(meshes[0], true);
    expect(batch.capacity).toBe(32);
    expect(colorOf(batch, 0)).toBe(1);
    batch.dispose(); material.dispose();
  });

  it('re-uploads live slots from the chunks after a context restore', () => {
    const gl = new FakeGL(), material = new THREE.ShaderMaterial();
    const batch = new ChunkBatch(material, gl as never, V, I);
    const meshes = Array.from({ length: 40 }, (_, i) => source(i + 7));
    for (const mesh of meshes) batch.place(mesh, true);
    for (const mesh of meshes.slice(0, 20)) batch.release(mesh);
    gl.canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(draws(batch)).toBe(0);
    gl.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(batch.live).toBe(20);
    for (const mesh of meshes.slice(20)) expect(colorOf(batch, slotOf(batch, mesh))).toBe(mesh.geometry.getAttribute('aColor').array[0]);
    expect(draws(batch)).toBe(20);
    batch.dispose(); material.dispose();
  });
});
