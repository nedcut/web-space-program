import type * as THREE from 'three';

// Explicit opt-in for immutable colour-only families. Do not infer compatibility from material names:
// most part families also differ in clearcoat, normals, textures or emission. Clones used for highlights
// deliberately do not inherit this registration.
const neutralMaterials = new WeakMap<THREE.Material, THREE.Material>();

/** Register a white material with otherwise identical surface/shader settings, owned by the same library. */
export function registerColorBatch(source: THREE.Material, neutral: THREE.Material): void {
  neutralMaterials.set(source, neutral);
}

/** Batch-only replacement: the caller must bake source.color into its own copy of the vertex colours. */
export function colorBatchMaterial(source: THREE.Material): THREE.Material {
  return neutralMaterials.get(source) ?? source;
}
