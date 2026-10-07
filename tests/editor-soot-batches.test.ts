import * as THREE from 'three';
import { expect, it } from 'vitest';
import { bakeEngineSoot, isSooted, prepareEngineSoot, releaseSoot } from '../src/render/parts/soot';
function fixture() {
  const frame = new THREE.Group(), engine = new THREE.Group();
  engine.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5)));
  const anchor = new THREE.Object3D(); anchor.name = 'exhaustAnchor'; anchor.position.y = -0.5; anchor.userData.exitRadius = 0.4;
  engine.add(anchor); frame.add(engine);
  const targets = [0.6, -0.6].map(x => {
    const geometry = new THREE.BoxGeometry(0.5, 1, 0.5);
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
    const root = new THREE.Group(); root.position.set(x, 0.2, 0); root.add(mesh); frame.add(root);
    return { root, mesh, template: geometry };
  });
  return { frame, engine, targets, parts: [engine, ...targets.map(t => t.root)] };
}
it('batched editor soot matches the synchronous bake after the hall recenters, without changing templates', () => {
  const sync = fixture(), batch = fixture();
  bakeEngineSoot(sync.parts, sync.frame, { cloneShared: true });
  const apply = prepareEngineSoot(batch.parts, batch.frame, { cloneShared: true });
  apply([batch.targets[0].root]);
  batch.frame.position.set(11, 22, -5);
  apply([batch.targets[1].root]);
  for (let i=0; i<2; i++) {
    const target = batch.targets[i];
    expect(isSooted(target.mesh.geometry)).toBe(true);
    expect(target.mesh.geometry.getAttribute('color').array).toEqual(sync.targets[i].mesh.geometry.getAttribute('color').array);
    expect([...target.template.getAttribute('color').array].every(v => v === 1)).toBe(true);
    releaseSoot(target.root);
    expect(target.mesh.geometry).toBe(target.template);
  }
});
