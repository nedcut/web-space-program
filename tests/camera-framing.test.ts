import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cameraModeCycle, FlightCamera, nextCameraMode, type CameraFrame } from '../src/flight/camera';
import {
  hudLensShift, LIFTOFF_DOLLY, liftoffDollyPitch, liftoffDollyScale, LiftoffDetector, MAX_LENS_SHIFT, smootherstep,
  speedFovBoost, TOWER_MIN_FOV, towerAvailable, towerFov, towerRevertDistance,
} from '../src/flight/cameraFraming';

const frame = (over: Partial<CameraFrame> = {}): CameraFrame => ({
  up: new THREE.Vector3(0, 0, 1),
  vesselQuat: new THREE.Quaternion(),
  velocity: new THREE.Vector3(100, 0, 0),
  orbitNormal: new THREE.Vector3(0, 1, 0),
  spaceBlend: 0,
  vesselId: 'a',
  radius: 5,
  ...over,
});

/** Screen y of the scene origin (the vessel) in NDC: +1 top, -1 bottom. */
const vesselNdcY = (cam: FlightCamera) => new THREE.Vector3().project(cam.camera).y;

describe('HUD framing', () => {
  it('places the vessel in the clear band above the navball cluster', () => {
    // 1080 px tall, 64 px top HUD, 270 px navball cluster: band 64..810, centred 437 px from the top.
    const s = hudLensShift(1080, 64, 270);
    expect(s).toBeCloseTo((540 - (64 + 0.5 * 746)) / 1080, 9);
    expect(s).toBeGreaterThan(0.08);
  });

  it('never shifts down and clamps on short windows', () => {
    expect(hudLensShift(1080, 400, 0)).toBe(0);
    expect(hudLensShift(400, 64, 330)).toBe(MAX_LENS_SHIFT);
    expect(hudLensShift(0, 64, 270)).toBe(0);
  });

  it('moves the vessel up on screen without moving the camera', () => {
    const plain = new FlightCamera();
    const shifted = new FlightCamera();
    plain.update(frame(), 1 / 60);
    shifted.update(frame({ lensShift: 0.15 }), 1 / 60);
    expect(shifted.camera.position.distanceTo(plain.camera.position)).toBeLessThan(1e-9);
    expect(vesselNdcY(plain)).toBeCloseTo(0, 6);
    // NDC spans 2 per viewport height: a 0.15 shift is +0.3.
    expect(vesselNdcY(shifted)).toBeCloseTo(0.3, 6);
  });

  it('frames the middle of a tall vessel whose COM sits low in the stack', () => {
    const cam = new FlightCamera();
    cam.pitch = 0;
    // Vessel centre 2 m above the pivot (scene z is up): it should land where the pivot alone would have.
    const centre = new THREE.Vector3(0, 0, 2);
    for (let i = 0; i < 120; i++) cam.update(frame({ lensShift: 0.1, frameCentre: centre }), 1 / 60);
    expect(centre.clone().project(cam.camera).y).toBeCloseTo(0.2, 2);
    expect(vesselNdcY(cam)).toBeLessThan(0.2);
  });

  it('eases the shift when the HUD is hidden, and drops it for photo mode', () => {
    const cam = new FlightCamera();
    cam.update(frame({ lensShift: 0.15 }), 1 / 60);
    cam.update(frame({ lensShift: 0 }), 1 / 60);
    const y = vesselNdcY(cam);
    expect(y).toBeGreaterThan(0.25);
    for (let i = 0; i < 180; i++) cam.update(frame({ lensShift: 0 }), 1 / 60);
    expect(vesselNdcY(cam)).toBeCloseTo(0, 3);
    cam.update(frame({ lensShift: 0.15 }), 1 / 60);
    cam.clearLensShift();
    cam.camera.updateProjectionMatrix();
    expect(vesselNdcY(cam)).toBeCloseTo(0, 6);
  });
});

describe('liftoff dolly', () => {
  it('starts and ends at rest along a smooth curve', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 9);
    expect(liftoffDollyScale(0)).toBe(1);
    expect(liftoffDollyScale(LIFTOFF_DOLLY.duration * 2)).toBeCloseTo(LIFTOFF_DOLLY.distance, 9);
    expect(liftoffDollyPitch(LIFTOFF_DOLLY.duration)).toBeCloseTo(LIFTOFF_DOLLY.pitch, 9);
    // Zero initial velocity: the first 0.1 s moves the camera by well under 0.1 %.
    expect(liftoffDollyScale(0.1) - 1).toBeLessThan(1e-3);
    let prev = 1;
    for (let t = 0.05; t <= LIFTOFF_DOLLY.duration; t += 0.05) {
      const s = liftoffDollyScale(t);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('backs the auto camera out over the first seconds of ascent', () => {
    const cam = new FlightCamera();
    cam.update(frame(), 1 / 60);
    const d0 = cam.distance, p0 = cam.pitch;
    cam.startLiftoff();
    for (let i = 0; i < 60; i++) cam.update(frame(), 1 / 60);
    expect(cam.distance / d0).toBeLessThan(1.15);
    for (let i = 0; i < 60 * (LIFTOFF_DOLLY.duration + 2); i++) cam.update(frame(), 1 / 60);
    expect(cam.distance / d0).toBeCloseTo(LIFTOFF_DOLLY.distance, 2);
    expect(cam.pitch - p0).toBeCloseTo(LIFTOFF_DOLLY.pitch, 2);
  });

  it('yields to the player: zoom input stops it, and other modes skip it', () => {
    const cam = new FlightCamera();
    cam.update(frame(), 1 / 60);
    const d0 = cam.distance;
    cam.startLiftoff();
    for (let i = 0; i < 120; i++) cam.update(frame(), 1 / 60);
    cam.drive.zoom = -1;
    cam.update(frame(), 1 / 60);
    cam.drive.zoom = 0;
    const held = cam.targetDistance;
    for (let i = 0; i < 600; i++) cam.update(frame(), 1 / 60);
    expect(cam.targetDistance).toBeCloseTo(held, 6);

    const free = new FlightCamera();
    free.update(frame(), 1 / 60);
    free.mode = 'free';
    free.startLiftoff();
    for (let i = 0; i < 600; i++) free.update(frame(), 1 / 60);
    expect(free.distance).toBeCloseTo(d0, 6);
  });

  it('detects a powered liftoff after sitting on the pad, not a bounce or a vessel switch', () => {
    const d = new LiftoffDetector();
    expect(d.update('a', true, false, 1 / 60)).toBe(false);
    for (let i = 0; i < 180; i++) expect(d.update('a', true, i > 120, 1 / 60)).toBe(false);
    expect(d.update('a', false, true, 1 / 60)).toBe(true);
    expect(d.update('a', false, true, 1 / 60)).toBe(false);
    // A touch-and-go after 0.5 s on the ground is not a liftoff.
    for (let i = 0; i < 30; i++) d.update('a', true, true, 1 / 60);
    expect(d.update('a', false, true, 1 / 60)).toBe(false);
    // Unpowered: a tip-over or a gust.
    for (let i = 0; i < 180; i++) d.update('a', true, false, 1 / 60);
    expect(d.update('a', false, false, 1 / 60)).toBe(false);
    // Switching to a vessel that is already flying.
    expect(d.update('b', false, true, 1 / 60)).toBe(false);
  });
});

describe('speed FOV cue', () => {
  it('peaks at a few degrees through max-Q and vanishes in space', () => {
    expect(speedFovBoost(0, 0)).toBe(0);
    expect(speedFovBoost(35000, 0)).toBeCloseTo(5, 9);
    expect(speedFovBoost(1e6, 0)).toBeCloseTo(5, 9);
    expect(speedFovBoost(35000, 1)).toBe(0);
    expect(speedFovBoost(10000, 0)).toBeGreaterThan(speedFovBoost(5000, 0));
  });

  it('is eased on the camera and switched off with motion disabled', () => {
    const cam = new FlightCamera(60);
    cam.update(frame({ fovBoost: 5 }), 1 / 60);
    expect(cam.camera.fov).toBeGreaterThan(60);
    expect(cam.camera.fov).toBeLessThan(60.2);
    for (let i = 0; i < 600; i++) cam.update(frame({ fovBoost: 5 }), 1 / 60);
    expect(cam.camera.fov).toBeCloseTo(65, 2);
    for (let i = 0; i < 600; i++) cam.update(frame({ fovBoost: 5, motionEnabled: false }), 1 / 60);
    expect(cam.camera.fov).toBeCloseTo(60, 2);
  });
});

describe('tower camera', () => {
  it('joins the mode cycle only near the ground and not on EVA', () => {
    expect(cameraModeCycle(false, true)).toContain('tower');
    expect(cameraModeCycle(false, false)).not.toContain('tower');
    expect(cameraModeCycle(true, true)).toEqual(['auto', 'free', 'locked']);
    expect(nextCameraMode('locked', false, true)).toBe('tower');
    expect(nextCameraMode('tower', false, true)).toBe('auto');
    expect(nextCameraMode('locked', false, false)).toBe('auto');
    // Leaving the tower after it became unavailable restarts the cycle.
    expect(nextCameraMode('tower', false, false)).toBe('auto');
    expect(towerAvailable(true, 10, 15)).toBe(true);
    expect(towerAvailable(false, 10, 15)).toBe(false);
    expect(towerAvailable(true, 1e5, 15)).toBe(false);
  });

  it('zooms in as the craft climbs away and hands back once it is far', () => {
    expect(towerFov(60, 15, 60)).toBeCloseTo(60, 9);
    const near = towerFov(60, 15, 1000), far = towerFov(60, 15, 3000);
    expect(far).toBeLessThan(near);
    expect(towerFov(60, 15, 1e7)).toBe(TOWER_MIN_FOV);
    // At the hand-back distance the zoom is maxed out.
    expect(towerFov(60, 15, towerRevertDistance(15))).toBe(TOWER_MIN_FOV);
    expect(towerRevertDistance(0.5)).toBeGreaterThanOrEqual(1500);
  });

  it('looks from the ground eye at the vessel, level with the horizon', () => {
    const cam = new FlightCamera(60);
    cam.update(frame({ radius: 15 }), 1 / 60);
    cam.mode = 'tower';
    const eye = new THREE.Vector3(120, 0, -400);
    cam.update(frame({ radius: 15, eye }), 1 / 60);
    expect(cam.camera.position.distanceTo(eye)).toBeLessThan(1e-9);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
    expect(fwd.dot(eye.clone().negate().normalize())).toBeGreaterThan(0.999);
    expect(cam.camera.fov).toBeCloseTo(towerFov(60, 15, eye.length()), 6);
    // Without an eye point the tower falls back to the orbit camera.
    cam.update(frame({ radius: 15 }), 1 / 60);
    expect(cam.camera.position.length()).toBeCloseTo(cam.distance, 3);
    expect(cam.camera.fov).toBeCloseTo(60, 6);
  });
});
