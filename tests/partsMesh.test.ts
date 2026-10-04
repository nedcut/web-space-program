import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PART_DEFS, findModule, landingLegLayout } from '../src/data/parts';
import { MESH_BUILDERS, buildPartMesh, getExhaustAnchors, setPartDeploy } from '../src/render/parts';
import type { PartDef } from '../src/sim/vessel/types';

function triCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

/** Bounds of the part, excluding deployables/fairing shells that legitimately extend past the shape. */
function coreBounds(def: PartDef, o: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  o.updateMatrixWorld(true);
  const skip = new Set(['chuteCanopy', 'fairingShell', 'panelWing', 'legUpper', 'controlSurface']);
  const visit = (c: THREE.Object3D) => {
    if (skip.has(c.name)) return;
    const m = c as THREE.Mesh;
    if (m.isMesh) box.expandByObject(m, true);
    for (const ch of c.children) visit(ch);
  };
  visit(o);
  return box;
}

describe('part meshes (headless)', () => {
  it('has a builder for every mesh id', () => {
    for (const p of PART_DEFS) expect(MESH_BUILDERS[p.mesh], `${p.id} -> ${p.mesh}`).toBeDefined();
  });

  it.each(PART_DEFS.map((p) => [p.id, p] as const))('%s builds within budget and matches its nodes', (_id, def: PartDef) => {
    const o = buildPartMesh(def);
    const tris = triCount(o);
    expect(tris).toBeGreaterThan(20);
    // target ~8k; the 4-chamber cluster engine is allowed a little more
    expect(tris).toBeLessThan(def.id === 'eng-tempest' ? 10000 : 8500);
    const b = coreBounds(def, o);
    const top = def.attachNodes.find((n) => n.id === 'top');
    const bottom = def.attachNodes.find((n) => n.id === 'bottom');
    // Stack faces coincide with the geometry's extent (within 2 cm), nothing pokes through them.
    if (top) expect(Math.abs(b.max.y - top.position.y), `${def.id} top`).toBeLessThan(0.02);
    if (bottom && def.mesh !== 'fairing') expect(Math.abs(b.min.y - bottom.position.y), `${def.id} bottom`).toBeLessThan(0.02);
    if (def.shape.kind === 'cylinder') {
      const r = Math.max(def.shape.radiusTop, def.shape.radiusBottom);
      // allow small protrusions (feedlines, raceways, RCS ports) up to 15 %
      expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z), `${def.id} radius`).toBeLessThan(r * 1.15 + 0.03);
    }
    const srf = def.attachNodes.find((n) => n.id === 'srf');
    if (srf && def.category !== 'engine') {
      // mount face sits on the srf node
      expect(Math.abs(b.min.z - srf.position.z), `${def.id} srf`).toBeLessThan(0.03);
    }
    if (findModule(def, 'engine')) {
      const anchors = getExhaustAnchors(o);
      expect(anchors.length).toBeGreaterThan(0);
      for (const a of anchors) {
        const wp = a.getWorldPosition(new THREE.Vector3());
        expect(Math.abs(wp.y - (bottom?.position.y ?? b.min.y)), `${def.id} exhaust`).toBeLessThan(0.05);
        expect(a.userData.exitRadius).toBeGreaterThan(0);
      }
    }
  });

  it('landing leg foot reaches the simulated contact point when deployed', () => {
    for (const id of ['leg-stilt', 'leg-strider']) {
      const def = PART_DEFS.find((p) => p.id === id)!;
      const o = buildPartMesh(def);
      setPartDeploy(o, 1);
      o.updateMatrixWorld(true);
      const pad = o.getObjectByName('pad')!;
      const bb = new THREE.Box3().setFromObject(pad, true);
      const leg = findModule(def, 'landingLeg')!;
      expect(Math.abs(bb.min.y - leg.footPosition.y)).toBeLessThan(0.02);
      const c = bb.getCenter(new THREE.Vector3());
      expect(Math.abs(c.z - leg.footPosition.z)).toBeLessThan(0.02);
      expect(landingLegLayout(1).contact.y).toBeLessThan(-1);
    }
  });

  it('landing gear tyre sits on the simulated wheel when deployed and folds up when stowed', () => {
    for (const def of PART_DEFS.filter((p) => findModule(p, 'wheel'))) {
      const w = findModule(def, 'wheel')!;
      const o = buildPartMesh(def);
      setPartDeploy(o, 1);
      o.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(o.getObjectByName('tyre')!, true);
      const c = bb.getCenter(new THREE.Vector3());
      expect(Math.abs(c.y - w.wheelCenter.y), def.id).toBeLessThan(0.02);
      expect(Math.abs(c.z - w.wheelCenter.z), def.id).toBeLessThan(0.02);
      expect(Math.abs(bb.max.z - (w.wheelCenter.z + w.radius)), def.id).toBeLessThan(0.02);
      if (w.retractable) {
        setPartDeploy(o, 0);
        o.updateMatrixWorld(true);
        const stowed = new THREE.Box3().setFromObject(o.getObjectByName('tyre')!, true);
        // Folded within the part's box depth (close to the mount surface).
        expect(stowed.max.z, def.id).toBeLessThan(def.shape.kind === 'box' ? def.shape.size.z / 2 + 0.02 : 1);
      }
    }
  });

  it('exposes animation nodes', () => {
    const byId = (id: string) => buildPartMesh(PART_DEFS.find((p) => p.id === id)!);
    expect(byId('eng-sirocco').getObjectByName('gimbal')).toBeDefined();
    expect(byId('eng-tempest').children.filter((c) => c.name === 'gimbal').length).toBe(4);
    expect(byId('solar-fold').getObjectByName('panelWing')).toBeDefined();
    expect(byId('chute-main').getObjectByName('chuteCanopy')!.visible).toBe(false);
    expect(byId('fin-pivot').getObjectByName('controlSurface')!.userData.hingeAxis).toHaveLength(3);
    expect(byId('fairing-1').getObjectByName('fairingHalfA')).toBeDefined();
    expect(byId('leg-stilt').getObjectByName('legUpper')).toBeDefined();
  });
});
