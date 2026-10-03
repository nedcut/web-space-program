import * as THREE from 'three';
import type { Universe } from '../game/universe';
import type { Vec3 } from '../util/vec3';
import type { QualityId } from '../render/core';

export interface PlanetLayerUpdate {
  t: number;
  /** Floating origin (heliocentric, float64). */
  origin: Vec3;
  camera: THREE.PerspectiveCamera;
  sunPos: Vec3;
  dt: number;
  /** Body the active vessel is near (gets full-detail treatment). */
  focusBody: string;
}

export interface PlanetLayer {
  update(u: PlanetLayerUpdate): void;
  /** 0..1 fraction of the sun visible from a point (eclipses). */
  sunVisibility?(point: Vec3, sunPos: Vec3): number;
  dispose(): void;
}

/**
 * Simple fallback: shaded spheres per body. Replaced by the full planet renderer (src/render/planet) when available.
 */
export function createPlanetLayer(scene: THREE.Scene, universe: Universe, _quality: QualityId): PlanetLayer {
  const group = new THREE.Group();
  scene.add(group);
  const meshes = new Map<string, THREE.Mesh>();
  for (const b of universe.bodies.values()) {
    const c = b.surface.colors[1] ?? b.surface.colors[0] ?? [0.5, 0.5, 0.5];
    const mat =
      b.kind === 'star'
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(20, 18, 15) })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.95 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), mat);
    m.scale.setScalar(b.radius);
    group.add(m);
    meshes.set(b.id, m);
  }
  return {
    update(u) {
      for (const [id, m] of meshes) {
        const p = universe.ephem.getBodyState(id, u.t).position;
        m.position.set(p.x - u.origin.x, p.y - u.origin.y, p.z - u.origin.z);
      }
    },
    dispose() {
      group.removeFromParent();
      meshes.forEach((m) => m.geometry.dispose());
    },
  };
}
