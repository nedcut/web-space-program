import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World, quatFromBasis } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildTender } from '../src/editor/stockCrafts';
import { dockedPorts, freePorts, neutralInput } from '../src/sim/vessel';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../src/game/scenarios';
import { DEFAULT_START_UT } from '../src/game/store';
import { add, cross, dot, length, normalize, scale, sub } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';

function setup(ahead: number) {
  const u = new Universe('standard');
  const w = new World(u, PART_CATALOG, DEFAULT_START_UT);
  const craft = buildTender();
  const wv = w.launch(craft);
  placeInCircularOrbit(w, wv, 'earth', 90_000);
  const target = spawnRendezvousTarget(w, craft, ahead)!;
  return { w, wv, target };
}

describe('world rendezvous & docking', () => {
  it('rendezvous scenario: target 100 m ahead on the same orbit, closest approach ~100 m', () => {
    const { w, target } = setup(100);
    expect(w.targetId).toBe(target.state.id);
    expect(w.targetPortUid).not.toBeNull();
    expect(w.targetKind()).toBe('vessel');
    const ts = w.targetState()!;
    expect(length(sub(ts.position, w.active!.state.position))).toBeGreaterThan(95);
    expect(length(sub(ts.position, w.active!.state.position))).toBeLessThan(105);
    w.tick(0.02, neutralInput());
    const ca = w.closestApproach()!;
    expect(ca).not.toBeNull();
    expect(ca.distance).toBeGreaterThan(90);
    expect(ca.distance).toBeLessThan(110);
    // Target survives a save/load round trip.
    const w2 = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), PART_CATALOG, w.universe);
    expect(w2.targetId).toBe(w.targetId);
    expect(w2.targetPortUid).toBe(w.targetPortUid);
  });

  it('SAS target mode points the nose at the targeted port; antiTarget away from it', () => {
    for (const mode of ['target', 'antiTarget'] as const) {
      const { w } = setup(100);
      const act = w.active!.state;
      // Start pointing 90 degrees off (radial out).
      const up = normalize(sub(act.position, w.universe.ephem.getBodyState('earth', w.ut).position));
      const fwd = up;
      const side = normalize(cross(fwd, w.relativeState(w.active!).velocity));
      act.orientation = quatFromBasis(side, fwd, cross(side, fwd));
      for (let i = 0; i < 50 * 25; i++) w.tick(0.02, neutralInput({ sas: mode, target: w.targetState()! }));
      const nose = qRotate(act.orientation, { x: 0, y: 1, z: 0 });
      const toT = normalize(sub(w.targetState()!.position, act.position));
      expect(dot(nose, toT)).toBeGreaterThan(mode === 'target' ? 0.999 : -2);
      if (mode === 'antiTarget') expect(dot(nose, toT)).toBeLessThan(-0.999);
    }
  });

  it('docks in orbit, survives save/load docked, and undocks', () => {
    const { w, wv } = setup(10);
    const act = wv.state;
    const tgt = w.vessels.get(w.targetId!)!.state;
    // Close the gap so the faces are 0.8 m apart, approaching at 0.2 m/s along the active vessel's nose.
    const pa = freePorts(act)[0];
    const pb = freePorts(tgt)[0];
    const nose = normalize(pa.dir);
    const shift = sub(add(pa.pos, scale(nose, 0.8)), pb.pos);
    tgt.position = add(tgt.position, shift);
    act.velocity = add(act.velocity, scale(nose, 0.2));
    const parts = act.parts.length + tgt.parts.length;
    for (let i = 0; i < 50 * 20 && w.vessels.size > 1; i++) w.tick(0.02, neutralInput());
    expect(w.vessels.size).toBe(1);
    expect(w.activeId).toBe(act.id);
    expect(w.targetId).toBeNull();
    expect(w.active!.state.parts.length).toBe(parts);
    expect(dockedPorts(w.active!.state).length).toBe(1);

    const w2 = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), PART_CATALOG, w.universe);
    expect(w2.vessels.size).toBe(1);
    const merged = w2.active!.state;
    expect(merged.parts.length).toBe(parts);
    expect(dockedPorts(merged).length).toBe(1);
    expect(merged.parts.some((p) => p.docked?.vesselName === 'Wren Tender Target')).toBe(true);

    const id = w2.undockActive();
    expect(id).not.toBeNull();
    expect(w2.vessels.size).toBe(2);
    expect(w2.vessels.get(id!)!.state.name).toBe('Wren Tender Target');
    for (let i = 0; i < 50 * 5; i++) w2.tick(0.02, neutralInput());
    expect(w2.vessels.size).toBe(2);
    const d = length(sub(w2.vessels.get(id!)!.state.position, w2.active!.state.position));
    expect(d).toBeGreaterThan(3);
  });
});
