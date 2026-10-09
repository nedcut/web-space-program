import * as THREE from 'three';

/** Fraction of a shadow texel a caster or the light may move before the depth map is redrawn. */
const TEXEL_FRACTION = 0.25;

/**
 * Redraw a directional light's shadow map only when it could change.
 *
 * The flight scene's casters (vessel parts, launch site) are usually still relative to the floating origin: on the
 * pad, while coasting under attitude hold, or paused. Re-rendering their depth every frame costs one draw per
 * caster. This compares each visible caster's world matrix, geometry and instance data, plus the light camera, with
 * the state last drawn. Tolerances are a quarter of a shadow texel (rotation scaled by each caster's reach), so a
 * skipped update cannot move a shadow edge visibly. Call after `scene.updateMatrixWorld()`, before rendering.
 */
export class ShadowMapCache {
  private objects: THREE.Object3D[] = [];
  private reach: number[] = [];
  private matrices = new Float64Array(0);
  private keys = new Float64Array(0);
  private lightState = new Float64Array(12);
  private count = 0;
  private wasEnabled = false;
  private dirty = true;
  /** Shadow passes drawn / skipped since construction (diagnostics). */
  readonly stats = { rendered: 0, skipped: 0 };
  private readonly scratch: THREE.Object3D[] = [];

  /** Force the next frame to redraw (e.g. a material or shadow setting changed). */
  invalidate(): void { this.dirty = true; }

  /** Decide whether `light` redraws its shadow map this frame; returns true when it will. */
  update(scene: THREE.Object3D, light: THREE.DirectionalLight, enabled: boolean): boolean {
    const shadow = light.shadow;
    shadow.autoUpdate = false;
    if (!enabled || !light.castShadow) {
      this.wasEnabled = false;
      shadow.needsUpdate = false;
      return false;
    }
    const cam = shadow.camera;
    const extent = Math.max(cam.right - cam.left, cam.top - cam.bottom, 1e-6);
    const tol = TEXEL_FRACTION * extent / Math.max(1, shadow.mapSize.x);
    const list = this.scratch;
    list.length = 0;
    setVolume(light);
    collectCasters(scene, list);
    let changed = this.dirty || !this.wasEnabled || shadow.map === null || this.lightChanged(light, extent, tol) || list.length !== this.count;
    for (let i = 0; !changed && i < list.length; i++) changed = this.casterChanged(i, list[i], tol);
    if (changed) {
      this.snapshot(light, list);
      this.stats.rendered++;
    } else this.stats.skipped++;
    this.dirty = false;
    this.wasEnabled = true;
    shadow.needsUpdate = changed;
    return changed;
  }

  private lightChanged(light: THREE.DirectionalLight, extent: number, tol: number): boolean {
    const s = this.lightState, cam = light.shadow.camera;
    const p = light.matrixWorld.elements, t = light.target.matrixWorld.elements;
    // Direction (rotation of the shadow camera) at the frustum edge, position along it, then the frustum itself.
    let dx = p[12] - t[12], dy = p[13] - t[13], dz = p[14] - t[14];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const rotTol = tol / extent;
    return Math.abs(dx - s[0]) > rotTol || Math.abs(dy - s[1]) > rotTol || Math.abs(dz - s[2]) > rotTol
      || Math.abs(t[12] - s[3]) > tol || Math.abs(t[13] - s[4]) > tol || Math.abs(t[14] - s[5]) > tol
      || cam.left !== s[6] || cam.right !== s[7] || cam.top !== s[8] || cam.bottom !== s[9] || cam.near !== s[10] || cam.far !== s[11];
  }

  private casterChanged(i: number, o: THREE.Object3D, tol: number): boolean {
    if (this.objects[i] !== o) return true;
    const k = this.keys, b = i * 4;
    if (k[b] !== geometryKey(o) || k[b + 1] !== positionVersion(o) || k[b + 2] !== instanceKey(o) || k[b + 3] !== (o as THREE.InstancedMesh).count) return true;
    const e = o.matrixWorld.elements, m = this.matrices, base = i * 16;
    const rotTol = tol / this.reach[i];
    for (let j = 0; j < 12; j++) {
      if ((j & 3) === 3) continue;
      if (Math.abs(e[j] - m[base + j]) > rotTol) return true;
    }
    return Math.abs(e[12] - m[base + 12]) > tol || Math.abs(e[13] - m[base + 13]) > tol || Math.abs(e[14] - m[base + 14]) > tol;
  }

  private snapshot(light: THREE.DirectionalLight, list: THREE.Object3D[]): void {
    const n = list.length;
    if (this.matrices.length < n * 16) {
      this.matrices = new Float64Array(n * 32);
      this.keys = new Float64Array(n * 8);
    }
    this.objects.length = n;
    this.reach.length = n;
    for (let i = 0; i < n; i++) {
      const o = list[i];
      if (this.objects[i] !== o) { this.objects[i] = o; this.reach[i] = casterReach(o); }
      this.matrices.set(o.matrixWorld.elements, i * 16);
      const b = i * 4;
      this.keys[b] = geometryKey(o); this.keys[b + 1] = positionVersion(o); this.keys[b + 2] = instanceKey(o);
      this.keys[b + 3] = (o as THREE.InstancedMesh).count;
    }
    this.count = n;
    const s = this.lightState, cam = light.shadow.camera;
    const p = light.matrixWorld.elements, t = light.target.matrixWorld.elements;
    const dx = p[12] - t[12], dy = p[13] - t[13], dz = p[14] - t[14];
    const len = Math.hypot(dx, dy, dz) || 1;
    s[0] = dx / len; s[1] = dy / len; s[2] = dz / len; s[3] = t[12]; s[4] = t[13]; s[5] = t[14];
    s[6] = cam.left; s[7] = cam.right; s[8] = cam.top; s[9] = cam.bottom; s[10] = cam.near; s[11] = cam.far;
  }
}

/** The light camera's box, bounded laterally by a cylinder: from the light position along `dir`, near..far deep. */
const volume = { px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 1, near: 0, far: 0, lateral: 0 };
const sphere = new THREE.Sphere();

function setVolume(light: THREE.DirectionalLight): void {
  const p = light.matrixWorld.elements, t = light.target.matrixWorld.elements, cam = light.shadow.camera;
  let dx = t[12] - p[12], dy = t[13] - p[13], dz = t[14] - p[14];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  Object.assign(volume, { px: p[12], py: p[13], pz: p[14], dx, dy, dz, near: cam.near, far: cam.far,
    lateral: Math.hypot((cam.right - cam.left) / 2, (cam.top - cam.bottom) / 2) });
}

/** Conservative: false only when the caster's world bounding sphere is entirely outside the light volume. */
function inVolume(o: THREE.Object3D): boolean {
  const bounds = worldSphere(o);
  if (!bounds) return true;
  const v = volume;
  const x = bounds.center.x - v.px, y = bounds.center.y - v.py, z = bounds.center.z - v.pz;
  const depth = x * v.dx + y * v.dy + z * v.dz;
  if (depth + bounds.radius < v.near || depth - bounds.radius > v.far) return false;
  const lx = x - depth * v.dx, ly = y - depth * v.dy, lz = z - depth * v.dz;
  return Math.hypot(lx, ly, lz) - bounds.radius <= v.lateral;
}

function worldSphere(o: THREE.Object3D): THREE.Sphere | null {
  const im = o as THREE.InstancedMesh;
  if (im.isInstancedMesh) {
    if (!im.boundingSphere) im.computeBoundingSphere();
    if (!im.boundingSphere) return null;
    sphere.copy(im.boundingSphere);
  } else {
    const g = (o as THREE.Mesh).geometry;
    if (!g) return null;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere || !Number.isFinite(g.boundingSphere.radius)) return null;
    sphere.copy(g.boundingSphere);
  }
  return sphere.applyMatrix4(o.matrixWorld);
}

/** Visible shadow casters that can reach the light volume, in traversal order (three's shadow-pass rules). */
function collectCasters(o: THREE.Object3D, out: THREE.Object3D[]): void {
  if (!o.visible) return;
  if (o.castShadow && ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints)
    && (!o.frustumCulled || inVolume(o))) out.push(o);
  const c = o.children;
  for (let i = 0; i < c.length; i++) collectCasters(c[i], out);
}

function geometryKey(o: THREE.Object3D): number {
  return (o as THREE.Mesh).geometry?.id ?? -1;
}

function positionVersion(o: THREE.Object3D): number {
  const g = (o as THREE.Mesh).geometry;
  if (!g) return 0;
  const p = g.attributes.position;
  const version = p && 'version' in p ? p.version : (p as THREE.InterleavedBufferAttribute | undefined)?.data.version ?? 0;
  return version + (g.drawRange.count === Infinity ? 0 : g.drawRange.count * 1e6);
}

/** Instance matrices, or `userData.casterVersion` for casters moved by shader data (vessel node slots). */
function instanceKey(o: THREE.Object3D): number {
  const moved = (o.userData.casterVersion as number | undefined) ?? 0;
  return (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).instanceMatrix.version + moved * 2 ** 32 : moved;
}

/** How far a caster's geometry extends from its local origin (rotation tolerance scales with it). */
function casterReach(o: THREE.Object3D): number {
  const mesh = o as THREE.Mesh;
  const g = mesh.geometry;
  if (!g) return 1;
  if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
    const im = mesh as unknown as THREE.InstancedMesh;
    if (!im.boundingSphere) im.computeBoundingSphere();
    return Math.max(1, im.boundingSphere ? im.boundingSphere.center.length() + im.boundingSphere.radius : 1);
  }
  if (!g.boundingSphere) g.computeBoundingSphere();
  const s = g.boundingSphere;
  return Math.max(1, s ? s.center.length() + s.radius : 1);
}
