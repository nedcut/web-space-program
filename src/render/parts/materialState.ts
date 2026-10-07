import type * as THREE from 'three';
/** Object3D.clone JSON-serializes userData: material/texture references belong in weak maps. */
export const untintedMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
export const lampMaterials = new WeakMap<THREE.Mesh, THREE.MeshStandardMaterial>();
