import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PART_DEFS } from '../src/data/parts';
import { bakeEngineSoot, buildPartMesh, isSooted, releaseSoot } from '../src/render/parts';
import { VesselView } from '../src/render/vessel/VesselView';
import { buildVessel } from '../src/sim/vessel';
import { buildMoonLander } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';

const def = (id: string) => PART_DEFS.find((p) => p.id === id)!;

/** Mean vertex-colour luminance of a part's body meshes within a height band (part frame). */
function shade(o: THREE.Object3D, name: string, yMin: number, yMax: number): number {
  let sum = 0, n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.name !== name) return;
    const p = m.geometry.getAttribute('position'), col = m.geometry.getAttribute('color');
    for (let i = 0; i < p.count; i++) if (p.getY(i) >= yMin && p.getY(i) <= yMax) { sum += col.getX(i) + col.getY(i) + col.getZ(i); n++; }
  });
  return sum / Math.max(1, n);
}

describe('engine-aware soot', () => {
  it('darkens the tank end beside a nozzle, scales with the engine and leaves distant parts clean', () => {
    const frame = new THREE.Group();
    const tank = buildPartMesh(def('tank-1-mid')), pod = buildPartMesh(def('pod-lantern-1'));
    const engDef = def('eng-zephyr'), eng = buildPartMesh(engDef);
    const shape = def('tank-1-mid').shape;
    const th = shape.kind === 'cylinder' ? shape.height : 1;
    const top = engDef.attachNodes.find((a) => a.id === 'top')!.position.y;
    eng.position.y = -th / 2 - top;
    pod.position.y = th / 2 + 1.5;
    frame.add(tank, pod, eng);
    const cleanBottom = shade(tank, 'body', -th / 2, -th / 2 + 0.3), cleanTop = shade(tank, 'body', th / 2 - 0.3, th / 2);
    bakeEngineSoot([tank, pod, eng], frame, { cloneShared: true });
    const bottom = shade(tank, 'body', -th / 2, -th / 2 + 0.3), topShade = shade(tank, 'body', th / 2 - 0.3, th / 2);
    expect(bottom).toBeLessThan(cleanBottom * 0.85);
    expect(topShade).toBeGreaterThan(cleanTop * 0.94);
    let podSooted = false, engSooted = false;
    pod.traverse((c) => { if ((c as THREE.Mesh).isMesh && isSooted((c as THREE.Mesh).geometry)) podSooted = true; });
    eng.traverse((c) => { if ((c as THREE.Mesh).isMesh && isSooted((c as THREE.Mesh).geometry)) engSooted = true; });
    expect(podSooted).toBe(false);
    expect(engSooted).toBe(false); // an engine never soots itself
    // The shared template is untouched: a fresh clone is clean.
    expect(shade(buildPartMesh(def('tank-1-mid')), 'body', -th / 2, -th / 2 + 0.3)).toBeCloseTo(cleanBottom, 5);
    // Without the engine the soot goes away again.
    frame.remove(eng);
    bakeEngineSoot([tank, pod], frame, { cloneShared: true });
    expect(shade(tank, 'body', -th / 2, -th / 2 + 0.3)).toBeCloseTo(cleanBottom, 5);
    releaseSoot(tank);
  });

  it('flight views bake soot per craft and keep sooted parts out of shared instancing', () => {
    const v = buildVessel(buildMoonLander(), PART_CATALOG), view = new VesselView(v);
    let sooted = 0, instancedSooted = 0;
    view.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (isSooted(m.geometry)) sooted++;
      if ((m as THREE.InstancedMesh).isInstancedMesh && isSooted(m.geometry)) instancedSooted++;
    });
    expect(sooted).toBeGreaterThan(5);
    expect(instancedSooted).toBe(0);
    view.dispose();
  });
});
