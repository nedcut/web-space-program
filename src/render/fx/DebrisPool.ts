import * as THREE from 'three';
import type { Vec3 } from '../../util/vec3';

/** Render-only shrapnel. Geometry belongs to part templates; slots and motion scratch are reused. */
export class DebrisPool {
  readonly root = new THREE.Group();
  private readonly placeholder = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshStandardMaterial({ color: 0x858b91, roughness: .85 });
  private readonly slots = Array.from({ length: 32 }, () => ({
    mesh: new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(this.placeholder, this.material), position: new THREE.Vector3(),
    velocity: new THREE.Vector3(), spin: new THREE.Vector3(), remaining: 0,
  }));
  private cursor = 0;
  private live = 0;
  private seed = 821;
  constructor() {
    this.root.visible=false; this.root.matrixAutoUpdate=false; this.root.matrixWorldAutoUpdate=false;
    for (const s of this.slots) { s.mesh.visible = false; s.mesh.frustumCulled = false; this.root.add(s.mesh); }
  }
  private random() { this.seed = (Math.imul(this.seed,1664525)+1013904223)>>>0; return this.seed/4294967296; }
  emit(geometry: THREE.BufferGeometry, position: Vec3, inherited: Vec3, diameter: number, count = 6) {
    this.root.visible=true;
    for (let i = 0; i < count; i++) {
      const s = this.slots[this.cursor++ % this.slots.length];
      if (s.remaining <= 0) this.live++;
      s.remaining = 3.5 + this.random(); s.mesh.geometry = geometry;
      s.mesh.visible = true; s.mesh.scale.setScalar(.15 + this.random() * .25);
      s.mesh.rotation.set(this.random()*6,this.random()*6,this.random()*6);
      s.position.copy(position);
      s.velocity.set(this.random()-.5,this.random()-.5,this.random()-.5).normalize()
        .multiplyScalar(5 + Math.min(25,diameter)*this.random()).add(inherited);
      s.spin.set(this.random()-.5,this.random()-.5,this.random()-.5).multiplyScalar(8);
    }
  }
  update(origin: Vec3, dt: number, gravity: THREE.Vector3, groundPosition: Vec3, up: THREE.Vector3, altitude: number) {
    if (!this.live) return;
    for (const s of this.slots) {
      if (s.remaining <= 0) continue;
      s.remaining -= dt;
      if (s.remaining <= 0) { s.mesh.visible = false; this.live--; continue; }
      s.velocity.addScaledVector(gravity,dt); s.position.addScaledVector(s.velocity,dt);
      const h = (s.position.x-groundPosition.x)*up.x + (s.position.y-groundPosition.y)*up.y + (s.position.z-groundPosition.z)*up.z + altitude;
      if (h < .15) {
        s.position.addScaledVector(up,.15-h);
        const vn = s.velocity.dot(up);
        if (vn < 0) s.velocity.addScaledVector(up,-1.25*vn).multiplyScalar(.6);
      }
      s.mesh.position.set(s.position.x-origin.x,s.position.y-origin.y,s.position.z-origin.z);
      s.mesh.rotateX(s.spin.x*dt); s.mesh.rotateY(s.spin.y*dt); s.mesh.rotateZ(s.spin.z*dt);
    }
    this.root.visible=this.live>0;
    this.root.updateMatrixWorld(true);
  }
  clear() { for (const s of this.slots) { s.remaining=0; s.mesh.visible=false; } this.live=0; this.root.visible=false; }
  get activeCount() { return this.live; }
  dispose() { this.placeholder.dispose(); this.material.dispose(); this.root.removeFromParent(); }
}
