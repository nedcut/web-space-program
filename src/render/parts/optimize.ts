import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call reduction for part templates (runs once per part definition, before cloning):
 *
 * 1. Multi-material meshes draw once per geometry group even when groups repeat a material
 *    (a box with 4 aluminium + 2 solar-cell faces costs 6 draws). Ranges are regrouped so each
 *    distinct material is one contiguous group.
 * 2. Sibling leaf meshes that share a material and carry no animation metadata are merged in their
 *    parent's frame, so they still follow any animated ancestor (folding panels, gimbals...).
 *
 * Triangles, transforms and materials are unchanged; only the number of draws drops.
 * Meshes that code looks up by name (gimbal, gear, EVA limbs, exhaust anchors) or with userData
 * are never merged, and nozzle/bell meshes stay separate from other meshes (heat glow uses names).
 */
const FUNCTIONAL_NAME = /^(gimbal|exhaustAnchor|gear\w*|arm-?\d|leg-?\d|evaPuff-?\d)$/;
const NOZZLE_NAME = /bell|nozzle/i;

export function optimizePartTemplate(root: THREE.Object3D): void {
  root.traverse((o) => { if (o instanceof THREE.Mesh && Array.isArray(o.material)) compactGroups(o); });
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.children.length > 1) parents.push(o); });
  for (const p of parents) mergeLeaves(p);
}

function layoutKey(g: THREE.BufferGeometry): string {
  return `${!!g.index}:` + Object.keys(g.attributes).sort().map((k) => `${k}/${g.attributes[k].itemSize}/${g.attributes[k].normalized}`).join(',')
    + `:${Object.keys(g.morphAttributes).length}`;
}

/** Regroup a multi-material mesh so each distinct material is drawn once. */
function compactGroups(mesh: THREE.Mesh): void {
  const materials = mesh.material as THREE.Material[];
  const geo = mesh.geometry;
  const groups = geo.groups;
  if (groups.length < 2) return;
  const unique: THREE.Material[] = [];
  const order: THREE.GeometryGroup[][] = [];
  for (const g of groups) {
    const m = materials[g.materialIndex ?? 0];
    if (!m) return; // Missing material: leave untouched (three skips such groups).
    let i = unique.indexOf(m);
    if (i < 0) { i = unique.length; unique.push(m); order.push([]); }
    order[i].push(g);
  }
  if (unique.length === groups.length) return;
  const out = geo.clone();
  out.clearGroups();
  if (geo.index) {
    const src = geo.index.array;
    const total = order.flat().reduce((n, g) => n + g.count, 0);
    const dst = new (src.constructor as new (n: number) => typeof src)(total);
    let at = 0;
    order.forEach((list, mi) => {
      const start = at;
      for (const g of list) { dst.set(src.subarray(g.start, g.start + g.count), at); at += g.count; }
      out.addGroup(start, at - start, mi);
    });
    out.setIndex(new THREE.BufferAttribute(dst, 1));
  } else {
    // Non-indexed: reorder whole vertices (every attribute) range by range.
    const total = order.flat().reduce((n, g) => n + g.count, 0);
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name] as THREE.BufferAttribute;
      if ((a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return;
      const dst = new (a.array.constructor as new (n: number) => typeof a.array)(total * a.itemSize);
      let at = 0;
      for (const list of order) for (const g of list) { dst.set(a.array.subarray(g.start * a.itemSize, (g.start + g.count) * a.itemSize), at * a.itemSize); at += g.count; }
      out.setAttribute(name, new THREE.BufferAttribute(dst, a.itemSize, a.normalized));
    }
    let at = 0;
    order.forEach((list, mi) => { const start = at; for (const g of list) at += g.count; out.addGroup(start, at - start, mi); });
  }
  out.computeBoundingSphere();
  mesh.geometry = out;
  mesh.material = unique.length === 1 ? unique[0] : unique;
  if (unique.length === 1) out.clearGroups();
}

function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  if (!(o instanceof THREE.Mesh) || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (o.children.length || !o.visible || Array.isArray(o.material) || o.material.transparent) return false;
  if (FUNCTIONAL_NAME.test(o.name) || Object.keys(o.userData).length || o.morphTargetInfluences?.length) return false;
  return true;
}

function mergeLeaves(parent: THREE.Object3D): void {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const c of parent.children) {
    if (!mergeable(c)) continue;
    const m = c.material as THREE.Material;
    const key = `${m.uuid}|${NOZZLE_NAME.test(c.name)}|${c.castShadow}|${c.receiveShadow}|${c.frustumCulled}|${c.renderOrder}|${layoutKey(c.geometry)}`;
    const list = buckets.get(key);
    if (list) list.push(c); else buckets.set(key, [c]);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const parts = list.map((c) => { c.updateMatrix(); const g = c.geometry.clone(); g.clearGroups(); return g.applyMatrix4(c.matrix); });
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = first.name;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = first.frustumCulled;
    mesh.renderOrder = first.renderOrder;
    const index = parent.children.indexOf(first);
    for (const c of list) parent.remove(c);
    parent.children.splice(Math.min(index, parent.children.length), 0, mesh);
    mesh.parent = parent;
  }
}
