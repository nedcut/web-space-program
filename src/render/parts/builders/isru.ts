import * as THREE from 'three';
import type { Builder } from './common';
import { M } from '../materials';

/** Original industrial housings, telescoping augers, finned processor and survey dishes. */
export const buildISRU: Builder = def => {
  const root = new THREE.Group();
  const h = def.shape.kind === 'box' ? def.shape.size.y : def.shape.height;
  const stack = def.shape.kind === 'cylinder';
  const housing = new THREE.Mesh(stack ? new THREE.CylinderGeometry(0.625, 0.625, h, 24)
    : new THREE.BoxGeometry(0.4, h, 0.4), def.modules.some(m => m.type === 'drill') ? M.orangeFoam() : M.charcoalPanel());
  root.add(housing);
  const metal = M.steel();
  if (def.modules.some(m => m.type === 'drill')) {
    const auger = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h * 0.8, 12), metal);
    auger.add(shaft);
    for (let i = 0; i < 9; i++) {
      const tooth = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.055, 0.055, 12), metal);
      tooth.position.y = -h * 0.36 + i * h * 0.085;
      auger.add(tooth);
    }
    auger.userData.deploy = { pos0: [0, 0, 0], pos1: [0, -h * 0.65, 0.16] };
    root.add(auger);
  } else if (def.modules.some(m => m.type === 'converter')) {
    for (let i = 0; i < 12; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.8, 0.22), metal);
      const a = i * Math.PI / 6;
      fin.position.set(Math.sin(a) * 0.63, 0, Math.cos(a) * 0.63);
      fin.rotation.y = a;
      root.add(fin);
    }
  } else if (def.modules.some(m => m.type === 'surveyScanner')) {
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.15, 24, 1, true), metal);
    dish.rotation.x = Math.PI / 2;
    dish.position.z = 0.25;
    root.add(dish);
  } else if (def.modules.some(m => m.type === 'surfaceScanner')) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), M.glass());
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.23; root.add(lens);
  } else {
    for (const y of [-h * 0.35, h * 0.35]) {
      const band = new THREE.Mesh(stack ? new THREE.TorusGeometry(0.628, 0.025, 6, 32)
        : new THREE.BoxGeometry(0.42, 0.035, 0.42), metal);
      if (stack) band.rotation.x = Math.PI / 2;
      band.position.y = y; root.add(band);
    }
  }
  return root;
};
