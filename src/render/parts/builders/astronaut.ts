import * as THREE from 'three';

/** Original human proportions, +Y upright, -Z forward; ~3,500 triangles. */
export function buildAstronaut(): THREE.Group {
  const root = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e9e3, roughness: 0.8 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe76724, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x293340, roughness: 0.75 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a33d, metalness: 0.8, roughness: 0.2 });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); parent.add(m); return m;
  };
  add(root, new THREE.CapsuleGeometry(0.24, 0.32, 4, 12), white, 0, 0.1, 0).scale.z = 0.78;
  add(root, new THREE.BoxGeometry(0.37, 0.21, 0.08), orange, 0, 0.12, -0.22);
  add(root, new THREE.BoxGeometry(0.13, 0.075, 0.025), dark, 0, 0.14, -0.27);
  add(root, new THREE.BoxGeometry(0.43, 0.56, 0.24), white, 0, 0.12, 0.23);
  add(root, new THREE.BoxGeometry(0.34, 0.12, 0.025), orange, 0, 0.25, 0.36);
  add(root, new THREE.CylinderGeometry(0.23, 0.23, 0.065, 16), dark, 0, 0.43, 0);
  add(root, new THREE.SphereGeometry(0.28, 20, 14), white, 0, 0.64, 0).scale.set(1, 1, 0.94);
  add(root, new THREE.SphereGeometry(0.245, 20, 12), gold, 0, 0.65, -0.115).scale.set(0.92, 0.74, 0.8);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.name = `arm${side}`; arm.position.set(side * 0.3, 0.33, 0); root.add(arm);
    add(arm, new THREE.CapsuleGeometry(0.085, 0.35, 3, 10), white, side * 0.045, -0.22, 0);
    add(arm, new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), orange, side * 0.045, -0.35, 0);
    add(arm, new THREE.SphereGeometry(0.09, 10, 8), dark, side * 0.045, -0.46, -0.025);
    const leg = new THREE.Group(); leg.name = `leg${side}`; leg.position.set(side * 0.13, -0.19, 0); root.add(leg);
    add(leg, new THREE.CapsuleGeometry(0.1, 0.41, 3, 10), white, 0, -0.28, 0);
    add(leg, new THREE.BoxGeometry(0.12, 0.12, 0.045), orange, 0, -0.29, -0.095);
    add(leg, new THREE.BoxGeometry(0.2, 0.16, 0.32), dark, 0, -0.62, -0.065);
    add(root, new THREE.CylinderGeometry(0.055, 0.075, 0.1, 10), dark, side * 0.25, -0.14, 0.3);
    const puff = add(root, new THREE.ConeGeometry(0.12, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xb5e3fc, transparent: true, opacity: 0.3, depthWrite: false }), side * 0.25, -0.43, 0.3);
    puff.name = `evaPuff${side}`;
    puff.visible = false;
  }
  return root;
}
