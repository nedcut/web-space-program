import * as THREE from 'three';

/** Far plane large enough for the whole solar system at real scale (Neptune ≈ 4.5e12 m). */
export const SOLAR_SYSTEM_FAR = 1e13;

/**
 * Create a perspective camera configured for planetary scales. With a logarithmic depth buffer the
 * near/far ratio can be enormous, but the near plane should still track the distance to the nearest
 * surface to keep close-up precision (see `updatePlanetaryClipping`).
 */
export function createPlanetaryCamera(fovDeg = 60, aspect = 16 / 9): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.05, SOLAR_SYSTEM_FAR);
  return cam;
}

/**
 * Adapt near/far to the camera's distance from the nearest surface (meters). Call once per frame.
 * - On the ground (≈2 m): near = 0.05 m.
 * - In orbit (100 km): near ≈ 100 m.
 */
export function updatePlanetaryClipping(cam: THREE.PerspectiveCamera, distanceToNearestSurface: number, nearestObjectDistance = Infinity): void {
  const d = Math.max(0, Math.min(distanceToNearestSurface, nearestObjectDistance));
  const near = Math.min(Math.max(d * 0.002, 0.05), 5000);
  if (Math.abs(near - cam.near) / cam.near > 0.05 || cam.far !== SOLAR_SYSTEM_FAR) {
    cam.near = near;
    cam.far = SOLAR_SYSTEM_FAR;
    cam.updateProjectionMatrix();
  }
}

/** Pixels per radian-ish factor for screen-space error: viewportHeight / (2 tan(fov/2)). */
export function screenSpaceFactor(cam: THREE.PerspectiveCamera, viewportHeightPx: number): number {
  return viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
}
