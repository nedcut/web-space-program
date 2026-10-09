import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FlightCamera } from '../src/flight/camera';
import { EVA_PART } from '../src/data/eva';
import { buildVessel, neutralInput } from '../src/sim/vessel';
import { stepEva, EVA_HEIGHT, EVA_WALK_SPEED } from '../src/sim/vessel/eva';
import { flatEarthEnv, NOSE_UP } from '../src/sim/vessel/testing';
import type { VesselState } from '../src/sim/vessel/runtime';
import { qRotate, type Quat } from '../src/util/quat';
import { v3 } from '../src/util/vec3';

const DT = 0.02;
function standing(): VesselState {
  const v = buildVessel({ name: 'EVA', version: 1, type: 'VAB', parts: [{ uid: 1, partId: EVA_PART.id, position: v3(), rotation: { x: 0, y: 0, z: 0, w: 1 } }] }, new Map([[EVA_PART.id, EVA_PART]]));
  v.eva = { astronautId: 'test', walkPhase: 0, walking: false, jetting: false };
  v.position = v3(0, 0, EVA_HEIGHT);
  v.orientation = NOSE_UP;
  v.situation = 'landed';
  return v;
}
/** Heading (rad) of a -Z forward about +Z (flat world, +Z up). */
const heading = (q: Quat | THREE.Quaternion) => { const f = qRotate({ x: q.x, y: q.y, z: q.z, w: q.w }, v3(0, 0, -1)); return Math.atan2(f.y, f.x); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Camera and astronaut in the loop, as in flight: the camera's attitude is the EVA control frame. */
function loop(eva: boolean, seconds: number, input: { translateX?: number; translateZ?: number }, yawDrive = (_t: number) => 0) {
  const v = standing();
  const env = flatEarthEnv({ g: 1.62, rho0: 0, p0: 0 });
  const cam = new FlightCamera();
  cam.mode = 'locked';
  const frame = () => ({ up: new THREE.Vector3(0, 0, 1), vesselQuat: new THREE.Quaternion(v.orientation.x, v.orientation.y, v.orientation.z, v.orientation.w), vesselId: 'eva', radius: 1, eva });
  cam.update(frame(), DT);
  // Look a little off the astronaut's back, as after any mouse drag.
  cam.yaw += 0.6;
  const views: number[] = [], bodies: number[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    cam.drive.yaw = yawDrive(i * DT);
    cam.update(frame(), DT);
    const q = cam.camera.quaternion;
    stepEva(v, neutralInput({ ...input, evaHeading: { x: q.x, y: q.y, z: q.z, w: q.w }, evaFaceView: eva }), env, i * DT, DT);
    views.push(heading(q)); bodies.push(heading(v.orientation));
  }
  return { v, views, bodies };
}

describe('EVA locked camera', () => {
  it('strafes sideways without the astronaut and the camera chasing each other round', () => {
    const { v, views, bodies } = loop(true, 4, { translateX: -1 });
    // The view holds still and the astronaut settles facing it.
    expect(Math.abs(wrap(views.at(-1)! - views[10]))).toBeLessThan(0.02);
    expect(Math.abs(wrap(bodies.at(-1)! - views.at(-1)!))).toBeLessThan(0.02);
    // A straight sidestep at walking speed, to the view's left.
    const left = views.at(-1)! + Math.PI / 2;
    const travelled = Math.hypot(v.position.x, v.position.y);
    expect(travelled).toBeGreaterThan(EVA_WALK_SPEED * 3.5);
    expect(Math.abs(wrap(Math.atan2(v.position.y, v.position.x) - left))).toBeLessThan(0.05);
  });

  it('turns the astronaut with the view when the camera is swung round', () => {
    // Swing for 2 s (the astronaut follows ~0.3 rad behind at full rate), then let it settle.
    const { views, bodies } = loop(true, 3, {}, t => (t < 2 ? 1 : 0));
    const swung = wrap(views.at(-1)! - views[0]);
    expect(Math.abs(swung)).toBeGreaterThan(1);
    expect(Math.abs(wrap(bodies.at(-1)! - views.at(-1)!))).toBeLessThan(0.02);
  });

  it('would spin when the camera is attached to an astronaut that turns to walk (the old behaviour)', () => {
    const { views } = loop(false, 4, { translateX: -1 });
    let turned = 0;
    for (let i = 1; i < views.length; i++) turned += Math.abs(wrap(views[i] - views[i - 1]));
    expect(turned).toBeGreaterThan(Math.PI);
  });
});
