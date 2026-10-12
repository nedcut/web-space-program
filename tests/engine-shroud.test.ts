import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPartMeshVariant, partMeshParams } from '../src/render/parts';
import { PART_CATALOG } from '../src/data/parts';
import { buildFoundationOrbiter, STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { activateNextStage, buildVessel } from '../src/sim/vessel';
import { CraftEditor } from '../src/editor/core';
import { engineShrouds } from '../src/sim/vessel/shroud';
import { tweakDescriptors, validTweaks } from '../src/sim/vessel/tweaks';
import type { CraftDef } from '../src/sim/vessel/types';

const craftShrouds = (craft: CraftDef) => engineShrouds(craft.parts, p => PART_CATALOG.get(p.partId));

describe('engine interstage skirts', () => {
  it('encloses an upper-stage engine from the tank above to the decoupler below', () => {
    const craft = buildFoundationOrbiter();
    const shrouds = craftShrouds(craft);
    const gust = craft.parts.find(p => p.partId === 'eng-gust')!;
    const booster = craft.parts.find(p => p.partId === 'eng-sirocco')!;
    // 0.625 m engine under a 1.25 m tank onto a 1.25 m decoupler: a full-width skirt.
    expect(shrouds.get(gust.uid)).toEqual({ radiusTop: 0.625, radiusBottom: 0.625, length: 0, below: craft.parts.find(p => p.parent === gust.uid)!.uid });
    // Nothing below the first-stage engine.
    expect(shrouds.has(booster.uid)).toBe(false);
  });

  it('is jettisoned when the decoupler below fires and stays off on the upper stage', () => {
    const craft = buildFoundationOrbiter();
    const v = buildVessel(craft, PART_CATALOG);
    const gust = v.parts.find(p => p.partId === 'eng-gust')!;
    expect(engineShrouds(v.parts, p => p.def).has(gust.uid)).toBe(true);
    // Fire stages until the booster decoupler under the upper engine has gone.
    const below = engineShrouds(v.parts, p => p.def).get(gust.uid)!.below;
    for (let i = 0; i < 6 && !v.cache.byUid.get(below)!.activated; i++) activateNextStage(v);
    expect(v.cache.byUid.get(below)!.activated).toBe(true);
    expect(engineShrouds(v.parts, p => p.def).has(gust.uid)).toBe(false);
  });

  it('tapers between unequal stages and never pinches the nozzle', () => {
    const craft = buildFoundationOrbiter();
    const gust = craft.parts.find(p => p.partId === 'eng-gust')!;
    const dec = craft.parts.find(p => p.parent === gust.uid)!;
    dec.partId = 'dec-0';
    const s = craftShrouds(craft).get(gust.uid)!;
    expect(s.radiusTop).toBeCloseTo(0.625);
    expect(s.radiusBottom).toBeCloseTo(0.3125);
    const nozzle = PART_CATALOG.get('eng-gust')!.shape;
    expect(nozzle.kind === 'cylinder' && s.radiusBottom >= nozzle.radiusBottom).toBe(true);
  });

  it('continues over a narrow decoupler and taper to the full-width stage below', () => {
    const ed = new CraftEditor(PART_CATALOG, { name: 'taper', type: 'VAB', parts: [], version: 1 });
    const uids: Record<string, number> = {};
    let p = ed.addRoot('pod-lantern-1').uid;
    for (const id of ['tank-1-mid', 'eng-wisp', 'dec-0', 'adapt-0-1', 'tank-1-mid', 'eng-sirocco']) uids[id] = p = ed.attachPart(id, p, 'bottom', 'top').uid;
    const s = craftShrouds(ed.craft).get(uids['eng-wisp'])!;
    expect(s).toEqual({ radiusTop: 0.625, radiusBottom: 0.625, length: 0.66, below: uids['dec-0'] });
    // The taper stays with the stage below; firing the decoupler drops the skirt.
    const v = buildVessel(ed.craft, PART_CATALOG);
    v.cache.byUid.get(uids['dec-0'])!.activated = true;
    expect(engineShrouds(v.parts, x => x.def).has(uids['eng-wisp'])).toBe(false);
  });

  it('can be switched off per engine', () => {
    const craft = buildFoundationOrbiter();
    const gust = craft.parts.find(p => p.partId === 'eng-gust')!;
    expect(tweakDescriptors(PART_CATALOG.get('eng-gust')!).some(d => d.key === 'shroud')).toBe(true);
    expect(tweakDescriptors(PART_CATALOG.get('srb-sparkler')!).some(d => d.key === 'shroud')).toBe(false);
    expect(validTweaks({ shroud: false })).toBe(true);
    gust.tweaks = { shroud: false };
    expect(craftShrouds(craft).has(gust.uid)).toBe(false);
  });

  it('gives every stock multi-stage rocket skirts only on engines with a stage below', () => {
    for (const s of STOCK_CRAFTS) {
      const craft = s.build();
      for (const [uid, shroud] of craftShrouds(craft)) {
        const engine = craft.parts.find(p => p.uid === uid)!;
        expect(PART_CATALOG.get(engine.partId)!.mesh).toBe('engine');
        expect(craft.parts.some(p => p.uid === shroud.below)).toBe(true);
        expect(shroud.radiusTop).toBeGreaterThan(0);
        expect(shroud.radiusBottom).toBeGreaterThan(0);
      }
    }
  });
});

describe('engine skirt mesh', () => {
  const tris = (o: THREE.Object3D, name?: string) => {
    let n = 0;
    const root = name ? o.getObjectByName(name)! : o;
    root.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; });
    return n;
  };
  const materials = (o: THREE.Object3D) => {
    const out = new Set<string>();
    o.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh) for (const x of [m.material].flat()) out.add(x.name || x.uuid); });
    return out;
  };

  it('builds jettisonable panels in materials the vessel already draws', () => {
    for (const id of ['eng-gust', 'eng-wisp', 'eng-zephyr', 'eng-foehn', 'eng-tempest']) {
      const def = PART_CATALOG.get(id)!;
      const plain = buildPartMeshVariant(def, undefined);
      const r = def.shape.kind === 'cylinder' ? def.shape.radiusTop : 1;
      const skirted = buildPartMeshVariant(def, partMeshParams(def, undefined, { radiusTop: r, radiusBottom: r * 0.8, length: 0.6, below: 1 }));
      const shroud = skirted.getObjectByName('engineShroud')!;
      expect(shroud.children.filter(c => c.userData.fairingPanel).length).toBeGreaterThanOrEqual(2);
      expect(plain.getObjectByName('engineShroud')).toBeUndefined();
      const added = tris(shroud);
      console.log(id, 'skirt triangles', added, 'of', tris(skirted));
      expect(added).toBeLessThan(6000);
      // Tank skin, frame, rails, inner skin and decals: nothing a stacked rocket does not already draw.
      const tank = materials(buildPartMeshVariant(PART_CATALOG.get('tank-1-mid')!, undefined));
      for (const m of materials(shroud)) expect(tank.has(m) || materials(plain).has(m)).toBe(true);
    }
  });
});
