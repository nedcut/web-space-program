import * as THREE from 'three';

/**
 * Off-screen passes that first draw mid-flight — the cloud-field and Milky Way cube bakes, the Earth imagery
 * merge — would compile their program on that frame: 0.6–1 s for the cloud bake in Windows Firefox, which has no
 * parallel shader compile. Each pass registers a proxy (its own geometry and material) under this group, which is
 * never rendered; the flight warm-up compiles it with the flight scene behind the loading screen.
 */
export const offscreenWarmup = new THREE.Group();
offscreenWarmup.name = 'offscreen-warmup';

/** Register a pass for warm-up; returns the unregister function (call when the pass is finished or disposed). */
export function registerOffscreenPass(geometry: THREE.BufferGeometry, material: THREE.Material): () => void {
  const proxy = new THREE.Mesh(geometry, material);
  proxy.frustumCulled = false;
  offscreenWarmup.add(proxy);
  return () => { offscreenWarmup.remove(proxy); };
}
