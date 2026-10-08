import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter, buildSoundingRocket } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { CLAMP, PadEquipment, padVesselProfile } from '../src/render/site/padEquipment';
import { paintSurface } from '../src/render/site/siteSurfaces';

function onPad(craft: ReturnType<typeof buildOrbiter>) {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const wv = w.launch(craft);
  // World.launch rests the hull 5 cm above the deck with the COM straight above the pad centre.
  return { state: wv.state, com: new THREE.Vector3(0, w.bottomOffset(wv.state) + 0.05, 0) };
}

const paint = (_k: string, g: THREE.BufferGeometry) => {
  const geo = g.index ? g.toNonIndexed() : g;
  paintSurface(geo, { layer: null, color: 0xffffff, roughness: 1, metalness: 0 });
  return geo;
};

describe('launch pad equipment', () => {
  it('profiles stock vessels on the pad: hull on the deck, clamp hold point above the engine bells', () => {
    for (const craft of [buildSoundingRocket(), buildOrbiter()]) {
      const { state, com } = onPad(craft);
      const p = padVesselProfile(state, com)!;
      expect(p).not.toBeNull();
      expect(Math.abs(p.bottom - 0.05)).toBeLessThan(0.35);
      expect(p.top - p.bottom).toBeGreaterThan(5);
      expect(p.holdY).toBeGreaterThan(p.bottom + 0.3);
      expect(p.holdR).toBeGreaterThan(0.3);
      expect(p.holdR).toBeLessThan(5);
      expect(p.radiusAt(p.holdY)).toBeGreaterThanOrEqual(p.holdR - 1e-9);
      expect(p.radiusAt(p.top + 5)).toBe(0);
    }
  });

  it('engages the clamps at the aft skirt while held and swings them clear after release', () => {
    const { state, com } = onPad(buildOrbiter());
    const profile = padVesselProfile(state, com)!;
    const eq = new PadEquipment(new THREE.MeshBasicMaterial(), paint);
    const clamps = eq.group.getObjectByName('site:clamps') as THREE.InstancedMesh;
    const tip = (t: number) => {
      eq.update(t, { state, com, held: t < 10, firing: t >= 9 });
      const m = new THREE.Matrix4(); clamps.getMatrixAt(0, m);
      // The claw sits at the far end of the arm (its length is the arm's +X extent).
      clamps.geometry.computeBoundingBox();
      return new THREE.Vector3(clamps.geometry.boundingBox!.max.x - 0.1, 0, 0).applyMatrix4(m);
    };
    tip(0);
    const held = tip(5);
    // A resting pad must not re-upload instances: every upload invalidates the cached shadow map.
    const versions = () => eq.group.children.map((m) => (m as THREE.InstancedMesh).instanceMatrix.version);
    const before = versions();
    for (let t = 5; t < 6; t += 1 / 60) tip(t);
    expect(versions()).toEqual(before);
    expect(Math.hypot(held.x, held.z)).toBeCloseTo(profile.holdR + 0.25, 0);
    expect(held.y).toBeCloseTo(profile.holdY, 0);
    // Per-frame steps (the equipment clamps long frame gaps).
    for (let t = 9; t < 12; t += 1 / 30) tip(t);
    const released = tip(12);
    // Stowed back over the pedestal: outboard of the hinge and well clear of the vessel.
    expect(Math.hypot(released.x, released.z)).toBeGreaterThan(CLAMP.corner * Math.SQRT2);
    eq.dispose();
  });
});
