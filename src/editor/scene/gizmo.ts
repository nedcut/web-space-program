import * as THREE from 'three';

export type GizmoAxis = 'x' | 'y' | 'z';
export type GizmoKind = 'offset' | 'rotate';
export interface GizmoHandle { kind: GizmoKind; axis: GizmoAxis }

const AXES: [GizmoAxis, number, THREE.Vector3][] = [
  ['x', 0xf0504a, new THREE.Vector3(1, 0, 0)],
  ['y', 0x6fe36a, new THREE.Vector3(0, 1, 0)],
  ['z', 0x4f9dff, new THREE.Vector3(0, 0, 1)],
];
/** Gizmo radius on screen, CSS px. */
const SCREEN_SIZE = 86;

/**
 * Offset arrows and rotation rings for a placed part, drawn on top of the craft at a constant screen size.
 * Axes are the craft frame (the gizmo lives in the craft group). Geometry and materials are built once.
 */
export class TransformGizmo {
  readonly group = new THREE.Group();
  private readonly offset = new THREE.Group();
  private readonly rotate = new THREE.Group();
  private readonly handles = new Map<THREE.Object3D, GizmoHandle>();
  private readonly materials = new Map<string, { base: THREE.MeshBasicMaterial; hot: THREE.MeshBasicMaterial }>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private hot: string | null = null;
  private readonly world = new THREE.Vector3();
  private readonly ownMaterials: THREE.Material[] = [];

  constructor() {
    const shaft = new THREE.CylinderGeometry(0.025, 0.025, 0.78, 10).translate(0, 0.39, 0);
    const head = new THREE.ConeGeometry(0.08, 0.24, 18).translate(0, 0.9, 0);
    const pickArrow = new THREE.CylinderGeometry(0.11, 0.11, 1.05, 8).translate(0, 0.52, 0);
    const ring = new THREE.TorusGeometry(0.82, 0.018, 8, 72);
    const pickRing = new THREE.TorusGeometry(0.82, 0.09, 6, 48);
    this.geometries.push(shaft, head, pickArrow, ring, pickRing);
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    this.ownMaterials.push(invisible);
    for (const [axis, color, dir] of AXES) {
      const mk = (hex: number, opacity: number) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
      const pair = { base: mk(color, 0.9), hot: mk(0xffe27a, 1) };
      this.materials.set(axis, pair);
      // Arrow along +axis (and a stub back the other way for orientation).
      const arrow = new THREE.Group();
      arrow.add(new THREE.Mesh(shaft, pair.base), new THREE.Mesh(head, pair.base));
      const pickA = new THREE.Mesh(pickArrow, invisible);
      arrow.add(pickA);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.offset.add(arrow);
      this.handles.set(pickA, { kind: 'offset', axis });
      // Ring in the plane normal to the axis.
      const r = new THREE.Group();
      r.add(new THREE.Mesh(ring, pair.base));
      const pickR = new THREE.Mesh(pickRing, invisible);
      r.add(pickR);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.rotate.add(r);
      this.handles.set(pickR, { kind: 'rotate', axis });
    }
    this.group.add(this.offset, this.rotate);
    this.group.traverse(o => { o.renderOrder = 30; o.userData.noTint = true; });
    const centre = new THREE.SphereGeometry(0.06, 14, 10);
    this.geometries.push(centre);
    const centreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false });
    this.ownMaterials.push(centreMaterial);
    const dot = new THREE.Mesh(centre, centreMaterial);
    dot.renderOrder = 30;
    this.offset.add(dot);
    this.group.visible = false;
  }

  /** Show the gizmo for a tool at a craft-frame point, or hide it. */
  show(kind: GizmoKind | null, x = 0, y = 0, z = 0) {
    this.group.visible = kind !== null;
    if (!kind) return;
    this.offset.visible = kind === 'offset';
    this.rotate.visible = kind === 'rotate';
    this.group.position.set(x, y, z);
  }

  get visible() { return this.group.visible; }

  /** Handle under the ray, if any. */
  pick(raycaster: THREE.Raycaster): GizmoHandle | null {
    if (!this.group.visible) return null;
    const live = this.offset.visible ? this.offset : this.rotate;
    const hits = raycaster.intersectObject(live, true);
    for (const h of hits) { const handle = this.handles.get(h.object); if (handle) return handle; }
    return null;
  }

  /** Highlight a handle (null clears). Returns true when the appearance changed. */
  setHot(handle: GizmoHandle | null): boolean {
    const key = handle?.axis ?? null;
    if (key === this.hot) return false;
    this.hot = key;
    for (const [axis, pair] of this.materials) {
      const want = axis === key ? pair.hot : pair.base;
      for (const g of [this.offset, this.rotate]) g.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material === pair.base || m.material === pair.hot)) m.material = want;
      });
    }
    return true;
  }

  /** Constant screen size: call before rendering. */
  updateScale(camera: THREE.PerspectiveCamera, viewportHeight: number) {
    if (!this.group.visible) return;
    this.group.getWorldPosition(this.world).applyMatrix4(camera.matrixWorldInverse);
    const pixelWorld = Math.max(0.01, -this.world.z) * 2 * Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, viewportHeight);
    const parentScale = this.group.parent ? this.group.parent.getWorldScale(this.world).x : 1;
    this.group.scale.setScalar((SCREEN_SIZE * pixelWorld) / parentScale);
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const pair of this.materials.values()) { pair.base.dispose(); pair.hot.dispose(); }
    for (const m of this.ownMaterials) m.dispose();
  }
}

/** Unit craft-frame vector of an axis. */
export const axisVector = (axis: GizmoAxis) => ({ x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 });
