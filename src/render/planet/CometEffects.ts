import * as THREE from 'three';
import { cometActivity } from '../../sim/orbit/comet';
import type { Vec3 } from '../../util/vec3';

/** Additive, tapered gas/dust volumes; local geometry never contains heliocentric float32s. */
export class CometEffects {
  readonly root = new THREE.Group();
  private coma: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private ion: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private dust: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private jets = new THREE.Group();
  constructor() {
    const material = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.coma = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material(0x65cab2));
    const tail = (color: number) => {
      const geometry = new THREE.CylinderGeometry(1, 0.035, 1, 16, 1, true);
      geometry.translate(0, 0.5, 0);
      return new THREE.Mesh(geometry, material(color));
    };
    this.ion = tail(0x5f91ff); this.dust = tail(0xdfc395);
    this.root.add(this.coma, this.ion, this.dust, this.jets);
    for (let i = 0; i < 6; i++) this.jets.add(tail(0xb3d9e2));
  }
  update(position: Vec3, sun: Vec3, origin: Vec3, radius: number, au: number, time: number, map = false) {
    const activity = cometActivity(position, sun, au);
    this.root.position.set(position.x - origin.x, position.y - origin.y, position.z - origin.z);
    this.root.visible = activity.brightness > 0.001;
    const dir = new THREE.Vector3(activity.direction.x, activity.direction.y, activity.direction.z);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const tailLength = au * 0.12 * activity.brightness;
    for (const [mesh, width, opacity] of [[this.ion, 0.012, 0.12], [this.dust, 0.055, 0.06]] as const) {
      mesh.quaternion.copy(q); mesh.scale.set(tailLength * width, tailLength, tailLength * width);
      mesh.material.opacity = opacity * activity.brightness;
    }
    this.coma.scale.setScalar(map ? Math.max(radius * 5, au * 0.001 * activity.brightness) : radius * 5);
    this.coma.material.opacity = activity.brightness * 0.09;
    this.jets.visible = !map && activity.jets > 0;
    this.jets.children.forEach((object, i) => {
      const jet = object as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
      const a = i * 2.39996;
      const normal = dir.clone().negate().add(new THREE.Vector3(Math.cos(a), Math.sin(a), Math.sin(a * 2)).multiplyScalar(0.45)).normalize();
      jet.position.copy(normal).multiplyScalar(radius * 0.8);
      jet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const pulse = 0.7 + 0.3 * Math.sin(time * 0.2 + i);
      jet.scale.set(radius * 0.18, radius * 5 * pulse, radius * 0.18);
      jet.material.opacity = activity.jets * 0.12 * pulse;
    });
  }
  dispose() {
    this.root.removeFromParent();
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
