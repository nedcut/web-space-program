import * as THREE from 'three';

/**
 * Flight camera: orbits the active vessel. The scene origin is the vessel (floating origin), so the camera
 * only needs a local offset. "Up" blends from local vertical (near a body) to the orbit normal / free mode.
 *
 * Modes: 'auto' (locked to local horizon near surface, free in space), 'chase' (follows vessel attitude),
 * 'free' (inertial).
 */
export type CameraMode = 'auto' | 'chase' | 'free';

export class FlightCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'auto';
  yaw = Math.PI * 0.75;
  pitch = 0.15;
  distance = 25;
  minDistance = 3;
  maxDistance = 5000;
  private dragging = false;
  private lx = 0;
  private ly = 0;
  private smoothedUp = new THREE.Vector3(0, 0, 1);

  constructor(fov = 60) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 1e13);
  }

  /**
   * @param localUp radial-out unit vector (scene space) at the vessel
   * @param vesselQuat vessel attitude (scene space) for chase mode
   * @param dt real seconds
   */
  update(localUp: THREE.Vector3, vesselQuat: THREE.Quaternion, dt: number) {
    let up: THREE.Vector3;
    let basis: THREE.Quaternion;
    if (this.mode === 'chase') {
      basis = vesselQuat.clone();
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(vesselQuat);
    } else {
      up = localUp.clone().normalize();
      basis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    }
    this.smoothedUp.lerp(up, 1 - Math.exp(-dt * 4)).normalize();

    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp)
      .multiplyScalar(this.distance)
      .applyQuaternion(basis);
    this.camera.position.copy(offset);
    this.camera.up.copy(this.smoothedUp);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.05, this.distance * 0.005);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  attach(el: HTMLElement) {
    const down = (e: PointerEvent) => {
      if (e.button !== 2 && e.button !== 0) return;
      this.dragging = true;
      this.lx = e.clientX;
      this.ly = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lx) * 0.005;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - this.ly) * 0.005));
      this.lx = e.clientX;
      this.ly = e.clientY;
    };
    const up = () => (this.dragging = false);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * Math.exp(e.deltaY * 0.001)));
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
    };
  }
}
