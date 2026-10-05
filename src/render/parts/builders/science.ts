import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';

/** Radial housings stay flush with the authored −Z mount face. */
export function buildInstrument(def: PartDef): THREE.Object3D {
  const root = new THREE.Group();
  const size = def.shape.kind === 'box' ? def.shape.size : { x: 0.3, y: 0.35, z: 0.2 };
  const housing = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z * 0.65), M.greyPanel());
  housing.position.z = -size.z * 0.175;
  root.add(housing);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.86, size.y * 0.82, size.z * 0.25), M.greyPanel());
  lid.position.z = size.z * 0.275;
  root.add(lid);
  const antenna = def.modules.some(m => m.type === 'antenna');
  const rings = antenna ? (def.id === 'antenna-relay' ? 5 : 2) : 3;
  for (let i = 0; i < rings; i++) {
    const detail = new THREE.Mesh(new THREE.CylinderGeometry(size.x * 0.08, size.x * 0.08, size.x * 0.8, 10), M.greyPanel());
    detail.rotation.z = Math.PI / 2;
    detail.position.set(0, size.y * (i / Math.max(1, rings - 1) - 0.5) * 0.7, size.z * 0.42);
    root.add(detail);
  }
  if (def.id === 'antenna-arc' || def.id === 'antenna-horizon') {
    const dish = new THREE.Mesh(new THREE.SphereGeometry(size.x * 0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3), M.greyPanel());
    dish.rotation.x = Math.PI / 2;
    dish.scale.y = 0.25;
    dish.position.z = size.z * 0.42;
    root.add(dish);
  }
  return root;
}
