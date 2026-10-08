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
type VariantBuilder = (def: PartDef, params: Record<string, number> | undefined) => THREE.Object3D;
const mods = import.meta.glob<{ buildPartMesh?: Builder; buildPartMeshVariant?: VariantBuilder }>('../../render/parts/index.ts', { eager: true });
const external: Builder | undefined = Object.values(mods)[0]?.buildPartMesh;
const externalVariant: VariantBuilder | undefined = Object.values(mods)[0]?.buildPartMeshVariant;

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

// Editor-only material values. Shared flight templates remain untouched and retain exactly
// the same shader variants; these clones use the existing maps and material features.
const studioMaterials = new WeakMap<THREE.Material, THREE.Material>();
function studioMaterial(material: THREE.Material): THREE.Material {
  const colors: Record<string, number> = {
    charcoalPanel: 0x1c2735,
    'accent-blue': 0x286bc0,
    'accent-teal': 0x149a92,
    'accent-orange': 0xe87126,
    gunmetal: 0x68788c,
    nozzleExt: 0xa8adbd,
    copperTubes: 0xffccab,
  };
  const color = colors[material.name];
  if (color === undefined) return material;
  let clone = studioMaterials.get(material);
  if (!clone) {
    clone = material.clone();
    (clone as THREE.MeshStandardMaterial).color.setHex(color);
    studioMaterials.set(material, clone);
  }
  return clone;
}

/** Template key of a part instance's mesh ('' for the catalogue mesh). */
export const variantKey = (params?: Record<string, number>) => params ? Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',') : '';

/** Returns a fresh instance (shares geometry & materials with a cached template). `params`: per-instance mesh variant. */
export function createPartMesh(def: PartDef, params?: Record<string, number>): THREE.Object3D {
  const key = params ? `${def.id}|${variantKey(params)}` : def.id;
  let t = templates.get(key);
  if (!t) {
    try {
      t = params && externalVariant ? externalVariant(def, params) : external ? external(def) : fallbackMesh(def);
    } catch (e) {
      console.warn(`buildPartMesh failed for ${def.id}`, e);
      t = fallbackMesh(def);
    }
    t.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(studioMaterial) : studioMaterial(mesh.material);
        // Coplanar printed markings have no independent silhouette. Avoid an alpha-tested
        // shadow draw for each label; the hull beneath it already casts the same shadow.
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        o.castShadow = !materials.every(m => m.name === 'decal');
        o.receiveShadow = true;
      }
    });
    templates.set(key, t);
  }
  return t.clone(true);
}
