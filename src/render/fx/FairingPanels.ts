import * as THREE from 'three';
import type { Vec3 } from '../../util/vec3';
import { thermalSources } from './thermalSurface';

/** Panel geometry recorded by the fairing builder (part frame: +Y up the shell). */
interface PanelInfo { azimuth: number; span: number; radius: number; baseY: number; height: number }

const LIFETIME = 6;
const _out = new THREE.Vector3(), _up = new THREE.Vector3(), _axis = new THREE.Vector3(), _arm = new THREE.Vector3();
const _spin = new THREE.Quaternion(), _rel = new THREE.Vector3();

/**
 * Jettisoned fairing panels: render-only rigid bodies that peel outward about their base hinge and tumble away under
 * gravity and drag, then disappear. The shared debris pool shrinks shrapnel and draws it in one grey material, so
 * panels get their own small pool: each slot holds a clone of the part's panel (template geometry and materials,
 * so nothing is uploaded) only while it flies. Simulation already removed the shell's mass at jettison.
 */
export class FairingPanels {
  readonly root = new THREE.Group();
  private readonly slots = Array.from({ length: 9 }, () => ({
    holder: new THREE.Group(), position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), remaining: 0,
  }));
  private cursor = 0;
  private live = 0;
  private seed = 4271;
  constructor() {
    this.root.visible = false;
    for (const s of this.slots) { s.holder.visible = false; this.root.add(s.holder); }
  }
  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  /**
   * Launch one panel. `position`/`quaternion` place the part frame in absolute world space; `kick` is the outward
   * separation speed (m/s) and `inherited` the vessel velocity.
   */
  emit(panel: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion, inherited: Vec3, kick: number) {
    const info = panel.userData.fairingPanel as PanelInfo | undefined;
    if (!info) return;
    const s = this.slots[this.cursor++ % this.slots.length];
    if (s.remaining <= 0) this.live++;
    s.holder.clear();
    const copy = panel.clone(true);
    copy.traverse(o => {
      o.visible = true;
      o.matrixAutoUpdate = true;
      o.matrixWorldAutoUpdate = true;
      delete o.userData.batchedVisible;
      const mesh = o as THREE.Mesh;
      // Template geometry outlives the part's own heat-slotted copy (disposed with the part).
      if (mesh.isMesh) mesh.geometry = thermalSources.get(mesh.geometry)?.source ?? mesh.geometry;
    });
    // Pivot about the panel's centroid: a thin arc of radius r and angle span has its centroid at r·sin(span/2)/(span/2).
    const half = info.span / 2, c = info.radius * Math.sin(half) / half;
    _out.set(Math.sin(info.azimuth), 0, Math.cos(info.azimuth));
    const centroidY = info.baseY + info.height * 0.4;
    copy.position.set(-_out.x * c, -centroidY, -_out.z * c);
    s.holder.add(copy);
    s.holder.quaternion.copy(quaternion);
    // Hinge to centroid arm, world frame.
    _arm.set(_out.x * (c - info.radius), centroidY - info.baseY, _out.z * (c - info.radius)).applyQuaternion(quaternion);
    s.position.set(_out.x * c, centroidY, _out.z * c).applyQuaternion(quaternion).add(position);
    // Rotating about up × out tips the panel's top outward about its base edge.
    _up.set(0, 1, 0);
    _axis.crossVectors(_up, _out).normalize().applyQuaternion(quaternion);
    const peel = THREE.MathUtils.clamp(2 * kick / info.height + 0.5, 0.5, 2) * (0.9 + 0.2 * this.random());
    s.spin.copy(_axis).multiplyScalar(peel);
    s.spin.x += (this.random() - 0.5) * 0.3; s.spin.y += (this.random() - 0.5) * 0.3; s.spin.z += (this.random() - 0.5) * 0.3;
    _out.applyQuaternion(quaternion);
    s.velocity.set(inherited.x, inherited.y, inherited.z).addScaledVector(_out, kick).add(_rel.crossVectors(s.spin, _arm));
    s.remaining = LIFETIME;
    s.holder.visible = true;
    this.root.visible = true;
  }

  /** `ambientVelocity` is the local air's world velocity; `density` in kg/m³ slows panels relative to it. */
  update(origin: Vec3, dt: number, gravity: THREE.Vector3, groundPosition: Vec3, up: THREE.Vector3, altitude: number, ambientVelocity: Vec3, density: number) {
    if (!this.live) return;
    for (const s of this.slots) {
      if (s.remaining <= 0) continue;
      s.remaining -= dt;
      if (s.remaining <= 0) { s.holder.visible = false; s.holder.clear(); this.live--; continue; }
      s.velocity.addScaledVector(gravity, dt);
      // Broad, light panels: strong drag (Cd·A / 2m ≈ 0.05 m²/kg).
      _rel.set(s.velocity.x - ambientVelocity.x, s.velocity.y - ambientVelocity.y, s.velocity.z - ambientVelocity.z);
      const slow = Math.min(1, 0.05 * density * _rel.length() * dt);
      s.velocity.addScaledVector(_rel, -slow);
      s.position.addScaledVector(s.velocity, dt);
      const h = (s.position.x - groundPosition.x) * up.x + (s.position.y - groundPosition.y) * up.y + (s.position.z - groundPosition.z) * up.z + altitude;
      if (h < 0.3) {
        // Come to rest on the ground in its moving frame.
        s.position.addScaledVector(up, 0.3 - h);
        s.velocity.set(ambientVelocity.x, ambientVelocity.y, ambientVelocity.z);
        s.spin.multiplyScalar(0.5);
      }
      const w = s.spin.length();
      if (w > 1e-6) s.holder.quaternion.premultiply(_spin.setFromAxisAngle(_axis.copy(s.spin).divideScalar(w), w * dt));
      s.holder.position.set(s.position.x - origin.x, s.position.y - origin.y, s.position.z - origin.z);
    }
    this.root.visible = this.live > 0;
  }

  clear() {
    for (const s of this.slots) { s.remaining = 0; s.holder.visible = false; s.holder.clear(); }
    this.live = 0;
    this.root.visible = false;
  }
  get activeCount() { return this.live; }
  dispose() { this.clear(); this.root.removeFromParent(); }
}
