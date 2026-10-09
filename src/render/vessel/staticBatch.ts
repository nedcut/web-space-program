import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isThermalVariant } from '../fx/thermalSurface';
import { nodeAttribute, nodeDepthMaterial } from '../core/rigidNodes';

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
 * Animated nodes that only move (no material or visibility changes of their own leaves): merged geometry follows them
 * through a rigid node slot. Exhaust anchors (plumes), lamp lenses (per-part material) and EVA limbs stay individual.
 */
const MOVING_NODE = /^(gimbal|controlSurface|gearSlide|gearSteer|gearWheel|gearLinkU|gearLinkL|braceStage)$/;
export function isMovingNode(o: THREE.Object3D): boolean {
  return MOVING_NODE.test(o.name) || !!o.userData.deploy;
}

export interface BatchOptions {
  /** A matching node and its subtree stay individually drawn. */
  skip?: (o: THREE.Object3D) => boolean;
  /**
   * A matching node becomes a moving frame: its rigid leaves merge in the node's own frame with the node's slot
   * (`slotBase + index` in `StaticBatch.nodes`). Checked after `skip`.
   */
  node?: (o: THREE.Object3D) => boolean;
  /** First rigid-node slot reserved for this batch (see rigidNodes.allocateNodes). */
  slotBase?: number;
}

export interface StaticBatch {
  group: THREE.Group;
  /** Moving frames in slot order (slot = slotBase + index). */
  nodes: THREE.Object3D[];
  /** Merged meshes containing node-slotted geometry (their shadows change when a node moves). */
  moving: THREE.Mesh[];
}

/** One leaf (or one material group of a multi-material leaf) to merge. */
interface Piece { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; slot: number; group?: THREE.GeometryGroup }

/** Only node-capable (thermal) materials can follow a moving frame in the shader. */
const followsNodes = (m: THREE.Material) => isThermalVariant(m);
const opaque = (m: THREE.Material) => !m.transparent;

/**
 * Merge opaque leaves into one mesh per material (and vertex layout). Inputs keep their shared template resources and
 * are hidden (`userData.batchedVisible`). Repeated geometry is flattened into the merge rather than instanced: an
 * instanced draw needs its own program variant and material setup, which costs more GL calls than its vertices.
 * Multi-material leaves are split by geometry group.
 */
export function batchStaticParts(objects: THREE.Object3D[], options: BatchOptions | ((o: THREE.Object3D) => boolean) = {}): THREE.Group {
  return buildStaticBatch(objects, typeof options === 'function' ? { skip: options } : options).group;
}

/** Moving frames buildStaticBatch would create for these inputs (to reserve their slots first). */
export function countMovingNodes(objects: THREE.Object3D[], skip: (o: THREE.Object3D) => boolean, node: (o: THREE.Object3D) => boolean): number {
  let n = 0;
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || skip(o)) return;
    if (node(o)) n++;
    for (const child of o.children) visit(child);
  };
  for (const o of objects) visit(o);
  return n;
}

export function buildStaticBatch(objects: THREE.Object3D[], options: BatchOptions = {}): StaticBatch {
  const { skip, node, slotBase = 0 } = options;
  const result = new THREE.Group();
  const nodes: THREE.Object3D[] = [];
  const buckets = new Map<THREE.Material, Piece[]>();
  const add = (material: THREE.Material, piece: Piece) => {
    let list = buckets.get(material);
    if (!list) buckets.set(material, list = []);
    list.push(piece);
  };
  const visit = (o: THREE.Object3D, parent: THREE.Matrix4, slot: number) => {
    if (!o.visible || skip?.(o)) return;
    o.updateMatrix();
    let matrix: THREE.Matrix4;
    if (slotBase && node?.(o)) {
      // A moving frame: its subtree is stored in the node's own frame and placed by the slot each frame.
      slot = slotBase + nodes.length;
      nodes.push(o);
      matrix = new THREE.Matrix4();
    } else matrix = new THREE.Matrix4().multiplyMatrices(parent, o.matrix);
    if (o instanceof THREE.Mesh && o.children.length === 0) {
      const materials: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      const groups: (THREE.GeometryGroup | undefined)[] = Array.isArray(o.material) ? o.geometry.groups : [undefined];
      const usable = groups.length > 0 && groups.every(g => {
        const m = materials[g?.materialIndex ?? 0];
        return m && opaque(m) && (slot === 0 || followsNodes(m));
      });
      if (usable) {
        for (const g of groups) add(materials[g?.materialIndex ?? 0], { geometry: o.geometry, matrix, slot, group: g });
        o.userData.batchedVisible = true;
        o.visible = false;
        // Hidden for good: skip its per-frame world-matrix update (the vessel root moves every frame).
        o.matrixWorldAutoUpdate = false;
      }
    }
    for (const child of o.children) visit(child, matrix, slot);
  };
  for (const o of objects) visit(o, new THREE.Matrix4(), 0);
  const moving: THREE.Mesh[] = [];
  for (const [material, pieces] of buckets) {
    const capable = followsNodes(material);
    // Templates can have different attribute layouts. Keep those in separate compatible groups.
    const layouts = new Map<string, { geometries: THREE.BufferGeometry[]; moving: boolean }>();
    for (const piece of pieces) {
      const g = extract(piece.geometry, piece.group).applyMatrix4(piece.matrix);
      if (capable) g.setAttribute('wspNode', nodeAttribute(g.getAttribute('position').count, piece.slot));
      const key = `${!!g.index}:` + Object.keys(g.attributes).sort().map(k => `${k}/${g.attributes[k].itemSize}/${g.attributes[k].normalized}`).join(',');
      let entry = layouts.get(key);
      if (!entry) layouts.set(key, entry = { geometries: [], moving: false });
      entry.geometries.push(g);
      entry.moving ||= piece.slot !== 0;
    }
    for (const { geometries, moving: hasNodes } of layouts.values()) {
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries)!;
      if (geometries.length > 1) geometries.forEach(g => g.dispose());
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.ownedGeometry = true;
      mesh.castShadow = mesh.receiveShadow = true;
      if (capable) mesh.customDepthMaterial = nodeDepthMaterial(material);
      if (hasNodes) {
        // Moving frames can carry geometry outside the rest-pose bounds (deployed arrays, gimballed bells).
        mesh.frustumCulled = false;
        moving.push(mesh);
      }
      result.add(mesh);
    }
  }
  result.updateMatrix(); result.matrixAutoUpdate = false;
  return { group: result, nodes, moving };
}

/** A standalone, non-indexed-or-indexed copy of one geometry group (or the whole geometry). */
function extract(source: THREE.BufferGeometry, group?: THREE.GeometryGroup): THREE.BufferGeometry {
  const g = source.clone();
  g.clearGroups();
  if (!group) return g;
  const index = source.index;
  const total = index ? index.count : source.getAttribute('position').count;
  const start = group.start, end = Math.min(total, group.count === Infinity ? total : start + group.count);
  if (index) {
    g.setIndex(Array.from(index.array.subarray(start, end) as ArrayLike<number>));
    return g;
  }
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const array = (a.array as Float32Array).slice(start * a.itemSize, end * a.itemSize);
    g.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize, a.normalized));
  }
  return g;
}

export function disposeStaticBatch(group: THREE.Group): void {
  group.traverse(o => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o instanceof THREE.Mesh && o.userData.ownedGeometry) o.geometry.dispose();
  });
  group.removeFromParent();
}
