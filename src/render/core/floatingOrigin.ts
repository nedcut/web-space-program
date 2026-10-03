import * as THREE from 'three';
import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';

/**
 * Floating origin: the render-space origin is a float64 sim position (usually the active vessel or the
 * focused body). Every object's render position is (simPos − origin) computed in float64 and only then
 * cast to float32, so nothing near the camera ever loses precision.
 */
export class FloatingOrigin {
  /** Current origin in sim (inertial, float64) coordinates. */
  readonly origin: Vec3 = { x: 0, y: 0, z: 0 };

  set(p: Vec3): this {
    this.origin.x = p.x;
    this.origin.y = p.y;
    this.origin.z = p.z;
    return this;
  }

  /** Sim position → render-space Vector3 (float32, relative to origin). */
  toRender(simPos: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(simPos.x - this.origin.x, simPos.y - this.origin.y, simPos.z - this.origin.z);
  }

  /** (a + b) − origin in float64, e.g. body position + rotated local offset. */
  toRenderSum(a: Vec3, b: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(a.x + b.x - this.origin.x, a.y + b.y - this.origin.y, a.z + b.z - this.origin.z);
  }

  /** Render-space → sim position (float64). */
  toSim(v: THREE.Vector3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    out.x = v.x + this.origin.x;
    out.y = v.y + this.origin.y;
    out.z = v.z + this.origin.z;
    return out;
  }

  /** Place an Object3D at a sim position. */
  place(obj: THREE.Object3D, simPos: Vec3): void {
    this.toRender(simPos, obj.position);
  }
}

/** Copy a float64 sim quaternion into a three.js quaternion. */
export function toThreeQuat(q: Quat, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(q.x, q.y, q.z, q.w);
}

/** Copy a float64 sim vector into a three.js vector (only for small/relative values!). */
export function toThreeVec(v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v.x, v.y, v.z);
}
