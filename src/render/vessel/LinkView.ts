import * as THREE from 'three';
import type { PartInstance } from '../../sim/vessel/types';
import type { PartState } from '../../sim/vessel/runtime';
import { linkEndpoints } from '../../sim/vessel/links';
import type { Vec3 } from '../../util/vec3';

type RenderPart = Pick<PartInstance, 'uid' | 'partId' | 'position' | 'rotation' | 'link'>;
const up = new THREE.Vector3(0, 1, 0);
/** Owned reusable meshes in craft coordinates, independent of part batching and COM/origin shifts. */
export class LinkView {
  readonly root = new THREE.Group();
  private geometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  private strutMaterial = new THREE.MeshStandardMaterial({ color: 0xaeb7c4, metalness: 0.8, roughness: 0.35 });
  private fuelMaterial = new THREE.MeshStandardMaterial({ color: 0xe4a233, metalness: 0.15, roughness: 0.8 });
  private brokenMaterial = new THREE.MeshStandardMaterial({ color: 0x71352c, metalness: 0.25, roughness: 0.8 });
  private meshes = new Map<number, THREE.Group>();
  private segment(mesh: THREE.Mesh, a: Vec3, b: Vec3, radius: number) {
    const start = new THREE.Vector3(a.x, a.y, a.z), end = new THREE.Vector3(b.x, b.y, b.z);
    const delta = end.sub(start), span = delta.length();
    mesh.position.copy(start).addScaledVector(delta, 0.5);
    mesh.quaternion.setFromUnitVectors(up, span > 1e-9 ? delta.divideScalar(span) : up);
    mesh.scale.set(radius, span, radius);
    mesh.visible = span > 1e-6;
  }
  update(parts: RenderPart[] | PartState[]) {
    // Most craft have no physical links. Avoid allocating a part index and UID tuples every frame.
    if (!parts.some(p => p.link) && this.meshes.size === 0) return;
    const by = new Map(parts.map(p => [p.uid, p]));
    const seen = new Set<number>();
    for (const p of parts) {
      if (!p.link) continue;
      const endpoints = linkEndpoints(p.link, by);
      let group = this.meshes.get(p.uid);
      if (!group) {
        group = new THREE.Group(); group.userData.uid = p.uid;
        group.add(new THREE.Mesh(this.geometry, this.strutMaterial), new THREE.Mesh(this.geometry, this.strutMaterial));
        this.meshes.set(p.uid, group); this.root.add(group);
      }
      seen.add(p.uid);
      const first = group.children[0] as THREE.Mesh, second = group.children[1] as THREE.Mesh;
      const radius = p.partId === 'fuel-line' ? 0.025 : 0.018;
      first.material = second.material = p.link.broken ? this.brokenMaterial : p.partId === 'fuel-line' ? this.fuelMaterial : this.strutMaterial;
      if (!endpoints) {
        // Retain a short broken stub at the surviving anchor after staging/destruction.
        const host = by.get(p.link.sourceUid);
        group.visible = !!host;
        if (host) {
          const stub = linkEndpoints({ ...p.link, targetUid: p.link.sourceUid, targetPos: {
            x: p.link.sourcePos.x + p.link.sourceNormal.x * 0.15,
            y: p.link.sourcePos.y + p.link.sourceNormal.y * 0.15,
            z: p.link.sourcePos.z + p.link.sourceNormal.z * 0.15,
          } }, by)!;
          this.segment(first, stub.a, stub.b, radius);
        }
        second.visible = false; continue;
      }
      group.visible = true;
      if (p.link.broken) {
        const at = (f: number) => ({ x: endpoints.a.x + (endpoints.b.x - endpoints.a.x) * f,
          y: endpoints.a.y + (endpoints.b.y - endpoints.a.y) * f, z: endpoints.a.z + (endpoints.b.z - endpoints.a.z) * f });
        this.segment(first, endpoints.a, at(0.35), radius);
        this.segment(second, at(0.65), endpoints.b, radius);
      } else {
        this.segment(first, endpoints.a, endpoints.b, radius); second.visible = false;
      }
    }
    for (const [uid, group] of this.meshes) if (!seen.has(uid)) { group.removeFromParent(); this.meshes.delete(uid); }
  }
  dispose() {
    this.root.removeFromParent(); this.root.clear(); this.meshes.clear();
    this.geometry.dispose(); this.strutMaterial.dispose(); this.fuelMaterial.dispose(); this.brokenMaterial.dispose();
  }
}
