import * as THREE from 'three';

interface Slot { geometry: number; instance: number }

/**
 * Visible chunks only, in reusable fixed-size slots. Cached chunks retain their
 * CPU geometry; GPU storage grows with peak visible chunks, not the terrain cache.
 * Slot reuse avoids BatchedMesh deletion/compaction during continuous LOD streaming.
 */
export class ChunkBatch {
  readonly mesh: THREE.BatchedMesh;
  private readonly slots = new Map<THREE.Mesh, Slot>();
  private readonly free: Slot[] = [];
  private count = 0;

  constructor(material: THREE.Material, private readonly vertices: number, private readonly indices: number) {
    this.mesh = new THREE.BatchedMesh(32, 32 * vertices, 32 * indices, material);
    this.mesh.name = 'terrain-chunk-batch';
    this.mesh.frustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  place(source: THREE.Mesh, changed: boolean): void {
    let slot = this.slots.get(source);
    if (!slot) {
      slot = this.free.pop();
      if (slot) {
        this.mesh.setGeometryAt(slot.geometry, source.geometry);
      } else {
        if (this.count === this.mesh.maxInstanceCount) {
          const capacity = this.mesh.maxInstanceCount * 2;
          this.mesh.setInstanceCount(capacity);
          this.mesh.setGeometrySize(capacity * this.vertices, capacity * this.indices);
        }
        const geometry = this.mesh.addGeometry(source.geometry, this.vertices, this.indices);
        slot = { geometry, instance: this.mesh.addInstance(geometry) };
        this.count++;
      }
      this.slots.set(source, slot);
      this.mesh.setVisibleAt(slot.instance, true);
      changed = true;
    }
    // Matrices are already rebased in JS float64 by Quadtree.place, then cast by
    // BatchedMesh's texture upload. Never store solar-system or body-centred translations.
    if (changed) this.mesh.setMatrixAt(slot.instance, source.matrix);
    this.mesh.visible = true;
  }

  release(source: THREE.Mesh): void {
    const slot = this.slots.get(source);
    if (!slot) return;
    this.mesh.setVisibleAt(slot.instance, false);
    this.slots.delete(source);
    this.free.push(slot);
    if (!this.slots.size) this.mesh.visible = false;
  }

  dispose(): void {
    this.slots.clear();
    this.free.length = 0;
    this.mesh.dispose();
  }
}
