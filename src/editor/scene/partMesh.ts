import * as THREE from 'three';
import type { PartDef } from '../../sim/vessel/types';

/**
 * Single import site for procedural part meshes.
 *
 * Uses `src/render/parts/index.ts` -> `buildPartMesh(def)` when it exists (part frame +Y up, origin at the
 * geometric centre). `import.meta.glob` resolves to an empty object if the module is missing, so the editor
 * still builds and falls back to simple shapes derived from `def.shape`.
 */
type Builder = (def: PartDef) => THREE.Object3D;
const mods = import.meta.glob<{ buildPartMesh?: Builder }>('../../render/parts/index.ts', { eager: true });
const external: Builder | undefined = Object.values(mods)[0]?.buildPartMesh;

const templates = new Map<string, THREE.Object3D>();

const FALLBACK_COLORS: Record<string, number> = {
  command: 0xd9dde3, fuelTank: 0xeeeeea, engine: 0x4a4f57, structural: 0x8d939c, coupling: 0x3b3f45,
  aero: 0xe8e8e8, control: 0xb8bec6, utility: 0xd8742c, electrical: 0x2d4a7a, ground: 0x9aa0a8, science: 0xc9b26b,
};
const fallbackMats = new Map<string, THREE.MeshStandardMaterial>();

function fallbackMesh(def: PartDef): THREE.Object3D {
  let mat = fallbackMats.get(def.category);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: FALLBACK_COLORS[def.category] ?? 0xcccccc, roughness: 0.5, metalness: 0.3 });
    fallbackMats.set(def.category, mat);
  }
  const geo = def.shape.kind === 'cylinder'
    ? new THREE.CylinderGeometry(Math.max(def.shape.radiusTop, 0.01), Math.max(def.shape.radiusBottom, 0.01), def.shape.height, 32)
    : new THREE.BoxGeometry(def.shape.size.x, def.shape.size.y, def.shape.size.z);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  return g;
}

export const usingFallbackMeshes = !external;

/** Returns a fresh instance (shares geometry & materials with a cached template). */
export function createPartMesh(def: PartDef): THREE.Object3D {
  let t = templates.get(def.id);
  if (!t) {
    try {
      t = external ? external(def) : fallbackMesh(def);
    } catch (e) {
      console.warn(`buildPartMesh failed for ${def.id}`, e);
      t = fallbackMesh(def);
    }
    t.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    templates.set(def.id, t);
  }
  return t.clone(true);
}
