import type { Vec3 } from '../../util/vec3';

/** One applied wrench. All vectors are body-frame; point is relative to craft origin. */
export interface PartLoad {
  partUid: number;
  point: Vec3;
  force: Vec3;
  /** Free couple (reaction wheels), in addition to point × force. */
  torque?: Vec3;
}

export interface JointLoad {
  /** Force and moment supplied by the parent at the attachment, body-frame. */
  force: Vec3;
  torque: Vec3;
  fraction: number;
}
