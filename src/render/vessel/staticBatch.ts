import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { instancedVariant } from '../core/materialVariants';
import { bindThermalRadiance, thermalGeometry, thermalSources } from '../fx/thermalSurface';

/** Batch only opaque static leaves. Inputs retain their shared template resources. */
export function batchStaticParts(objects: THREE.Object3D[]): THREE.Group {
  const result = new THREE.Group();
  const buckets = new Map<THREE.Material, Map<THREE.BufferGeometry, { matrix: THREE.Matrix4; slot?: number }[]>>();
  const visit = (o: THREE.Object3D, parent: THREE.Matrix4) => {
    if (!o.visible) return;
    o.updateMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(parent, o.matrix);
    if (o instanceof THREE.Mesh && !Array.isArray(o.material) && !o.material.transparent && o.children.length === 0) {
      let materials = buckets.get(o.material);
      if (!materials) buckets.set(o.material, materials = new Map());
      const thermal = thermalSources.get(o.geometry);
      const source = thermal?.source ?? o.geometry;
      let transforms = materials.get(source);
      if (!transforms) materials.set(source, transforms = []);
      transforms.push({ matrix, slot: thermal?.slot });
      o.userData.batchedVisible = true;
      o.visible = false;
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
        if (heated) {
          g.setAttribute('wspHeatSlot', new THREE.InstancedBufferAttribute(new Float32Array(matrices.map(m => m.slot!)), 1));
          bindThermalRadiance(g);
        }
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
      bindThermalRadiance(geometry);
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
