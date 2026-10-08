import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { instancedVariant } from '../core/materialVariants';
import { thermalGeometry, thermalSources } from '../fx/thermalSurface';
import { isSooted } from '../parts/soot';

/**
 * Nodes that flight animates or restyles every frame (VesselView.animatePart and its helpers): engine gimbals and
 * exhaust anchors, deployables, landing-gear joints, control surfaces, lamp lenses (per-part material) and EVA limbs.
 * Everything else in a part is rigid relative to the part, which is rigid relative to the vessel between rebuilds.
 */
const ANIMATED_NODE = /^(gimbal|exhaustAnchor|controlSurface|gearSlide|gearSteer|gearWheel|gearLinkU|gearLinkL|braceStage|lightLens|arm-?1|leg-?1|evaPuff-?1)$/;
export function isAnimatedNode(o: THREE.Object3D): boolean {
  return ANIMATED_NODE.test(o.name) || !!o.userData.deploy;
}

/**
 * Batch opaque static leaves. Inputs retain their shared template resources. With `skip`, a matching node and its
 * subtree stay individually drawn (used to batch the rigid remainder of animated parts).
 */
export function batchStaticParts(objects: THREE.Object3D[], skip?: (o: THREE.Object3D) => boolean): THREE.Group {
  const result = new THREE.Group();
  const buckets = new Map<THREE.Material, Map<THREE.BufferGeometry, { matrix: THREE.Matrix4; slot?: number }[]>>();
  const visit = (o: THREE.Object3D, parent: THREE.Matrix4) => {
    if (!o.visible || skip?.(o)) return;
    o.updateMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(parent, o.matrix);
    if (o instanceof THREE.Mesh && !Array.isArray(o.material) && !o.material.transparent && o.children.length === 0) {
      let materials = buckets.get(o.material);
      if (!materials) buckets.set(o.material, materials = new Map());
      // Craft-specific soot makes a part's geometry unique: draw it from its own (already heat-slotted) copy.
      const thermal = isSooted(o.geometry) ? undefined : thermalSources.get(o.geometry);
      const source = thermal?.source ?? o.geometry;
      let transforms = materials.get(source);
      if (!transforms) materials.set(source, transforms = []);
      transforms.push({ matrix, slot: thermal?.slot });
      o.userData.batchedVisible = true;
      o.visible = false;
      // Hidden for good: skip its per-frame world-matrix update (the vessel root moves every frame).
      o.matrixWorldAutoUpdate = false;
    }
    for (const child of o.children) visit(child, matrix);
  };
  for (const o of objects) visit(o, new THREE.Matrix4());
  for (const [material, geometries] of buckets) {
    const unique: THREE.BufferGeometry[] = [];
    for (const [geometry, matrices] of geometries) {
      if (matrices.length > 1) {
        const heated = matrices[0].slot !== undefined;
        const g = heated ? geometry.clone() : geometry;
        if (heated) g.setAttribute('wspHeatSlot', new THREE.InstancedBufferAttribute(new Float32Array(matrices.map(m => m.slot!)), 1));
        const mesh = new THREE.InstancedMesh(g, instancedVariant(material), matrices.length);
        mesh.userData.ownedGeometry = heated;
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m.matrix));
        mesh.computeBoundingSphere(); mesh.castShadow = mesh.receiveShadow = true;
        result.add(mesh);
      } else {
        const { matrix, slot } = matrices[0];
        const source = slot === undefined ? geometry : thermalGeometry(geometry, slot);
        unique.push(source.clone().applyMatrix4(matrix));
        if (source !== geometry) source.dispose();
      }
    }
    // Templates can have different attribute layouts. Keep those in separate compatible groups.
    const layouts = new Map<string, THREE.BufferGeometry[]>();
    for (const g of unique) {
      const key = `${!!g.index}:` + Object.keys(g.attributes).sort().map(k => `${k}/${g.attributes[k].itemSize}/${g.attributes[k].normalized}`).join(',');
      const group = layouts.get(key) ?? []; group.push(g); layouts.set(key, group);
    }
    for (const group of layouts.values()) {
      const geometry = group.length === 1 ? group[0] : mergeGeometries(group)!;
      if (group.length > 1) group.forEach(g => g.dispose());
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.ownedGeometry = true;
      mesh.castShadow = mesh.receiveShadow = true;
      result.add(mesh);
    }
  }
  result.updateMatrix(); result.matrixAutoUpdate = false;
  return result;
}

export function disposeStaticBatch(group: THREE.Group): void {
  group.traverse(o => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o instanceof THREE.Mesh && o.userData.ownedGeometry) o.geometry.dispose();
  });
  group.removeFromParent();
}
