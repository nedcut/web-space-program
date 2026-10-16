import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { RESOURCES } from '../src/data/resources';
import { buildTender } from '../src/editor/stockCrafts';
import { buildVessel, dockedPorts, freePorts, neutralInput, stepDocking, stepVessel, systemAngularMomentum, undock } from '../src/sim/vessel';
import type { VesselState } from '../src/sim/vessel/runtime';
import { TEST_CATALOG, stackCraft, vacuumEnv } from '../src/sim/vessel/testing';
import { stepVesselContacts } from '../src/sim/vessel/vesselContact';
import { qFromAxisAngle, qMul, qRotate } from '../src/util/quat';
import { add, dot, length, scale, sub, v3 } from '../src/util/vec3';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../src/game/scenarios';

const DT = 0.02, env = vacuumEnv();
const momentum = (vs: VesselState[]) => vs.reduce((p, v) => add(p, scale(v.velocity, v.mass)), v3());
function box(id: string, x: number, y = 0): VesselState {
  const v = buildVessel(stackCraft(['probe']), TEST_CATALOG, { id });
  v.position = v3(x, y, 0);
  return v;
}
function ports(gap: number, speed: number, tilt = 0): [VesselState, VesselState] {
  const a = buildVessel(buildTender(), PART_CATALOG, { id: 'a', resourceDefs: RESOURCES });
  const b = buildVessel(buildTender(), PART_CATALOG, {
    id: 'b', resourceDefs: RESOURCES,
    orientation: qMul(qFromAxisAngle(v3(0, 0, 1), tilt * Math.PI / 180), qFromAxisAngle(v3(1, 0, 0), Math.PI)),
  });
  b.position = sub(add(freePorts(a)[0].pos, v3(0, gap, 0)), freePorts(b)[0].pos);
  b.velocity = v3(0, -speed, 0);
  return [a, b];
}
function run(vs: VesselState[], seconds: number): { vessels: VesselState[]; contacts: number } {
  let contacts = 0;
  for (let t = 0; t < seconds; t += DT) {
    for (const v of vs) stepVessel(v, neutralInput(), env, t, DT);
    contacts += stepVesselContacts(vs, DT);
    stepDocking(vs, DT);
    vs = vs.filter(v => !v.destroyed);
  }
  return { vessels: vs, contacts };
}

describe('loaded vessel contact', () => {
  it('bumps head on, conserves linear momentum, and does not pass through', () => {
    const a = box('a', 0), b = box('b', 0.999);
    a.velocity.x = 0.3;
    const before = momentum([a, b]);
    expect(stepVesselContacts([a, b], DT)).toBe(1);
    expect(b.velocity.x - a.velocity.x).toBeGreaterThanOrEqual(0);
    expect(length(sub(momentum([a, b]), before))).toBeLessThan(1e-10);
    const result = run([a, b], 10);
    expect(result.vessels.length).toBe(2);
    expect(b.position.x - a.position.x).toBeGreaterThan(0.998);
  });

  it('conserves angular and linear momentum with unequal masses, rotated inertia and friction', () => {
    const a = box('a', 0), b = buildVessel(stackCraft(['lander-core']), TEST_CATALOG, { id: 'b' });
    b.position = v3(1.1, 0.3, 0.2);
    b.orientation = qFromAxisAngle(v3(1, 1, 1), 0.2);
    a.velocity = v3(0.5, 0.4, -0.2);
    a.angularVelocity = v3(0.1, 0.02, -0.1);
    b.angularVelocity = v3(-0.2, 0, 0.1);
    const p = momentum([a, b]), l = systemAngularMomentum([a, b], v3(), v3());
    expect(stepVesselContacts([a, b], DT)).toBe(1);
    expect(length(sub(momentum([a, b]), p))).toBeLessThan(1e-9);
    expect(length(sub(systemAngularMomentum([a, b], v3(), v3()), l))).toBeLessThan(1e-9);
    expect(length(a.angularVelocity)).toBeGreaterThan(0.15);
  });

  it('uses shape separation rather than treating overlapping part spheres as contact', () => {
    const a = box('a', 0), b = box('b', 1.1, 1.1);
    b.velocity.x = -0.5;
    expect(stepVesselContacts([a, b], DT)).toBe(0);
    expect(b.velocity.x).toBe(-0.5);
  });

  it('collides rotated thin boxes and cone sides', () => {
    for (const partId of ['wing', 'capsule']) {
      const a = buildVessel(stackCraft([partId]), TEST_CATALOG, { id: 'a' });
      const b = box('b', 0.35);
      a.orientation = qFromAxisAngle(v3(0, 1, 0), Math.PI / 4);
      b.velocity.x = -0.3;
      expect(stepVesselContacts([a, b], DT)).toBe(1);
      expect(b.velocity.x).toBeGreaterThan(-0.3);
    }
  });

  it('rejects distant vessels before reading any part geometry', () => {
    const a = box('a', 0), b = box('b', 100);
    Object.defineProperty(a, 'parts', { get: () => { throw new Error('far pair reached narrow phase'); } });
    expect(stepVesselContacts([], DT)).toBe(0);
    expect(stepVesselContacts([a], DT)).toBe(0);
    expect(stepVesselContacts([a, b], DT)).toBe(0);
  });

  it('ignores destroyed vessels and EVA, which has its own hull solver', () => {
    const a = box('a', 0), b = box('b', 0.99);
    b.destroyed = true;
    expect(stepVesselContacts([a, b], DT)).toBe(0);
    b.destroyed = false;
    b.eva = { astronautId: 'test', walkPhase: 0, walking: false, jetting: false };
    expect(stepVesselContacts([a, b], DT)).toBe(0);
  });

  it('caps penetration recovery for an initially overlapping save', () => {
    const a = box('a', 0), b = box('b', 0.1);
    stepVesselContacts([a, b], DT);
    expect(b.velocity.x - a.velocity.x).toBeCloseTo(0.5, 9);
  });

  it('is invariant under a heliocentric translation and orbital velocity', () => {
    const a = box('a', 0), b = box('b', 0.999);
    a.velocity.x = 0.3;
    const c = structuredClone(a), d = structuredClone(b);
    for (const v of [c, d]) {
      v.position = add(v.position, v3(1.4e11, 2e10, -1e9));
      v.velocity = add(v.velocity, v3(30000, 10000, -7000));
    }
    stepVesselContacts([a, b], DT); stepVesselContacts([c, d], DT);
    expect(length(sub(sub(c.velocity, v3(30000, 10000, -7000)), a.velocity))).toBeLessThan(1e-5);
    expect(length(sub(c.angularVelocity, a.angularVelocity))).toBeLessThan(1e-5);
  });

  it('allows an aligned 0.3 m/s approach to latch with collision enabled', () => {
    const [a, b] = ports(0.9, 0.3);
    const p = momentum([a, b]);
    const result = run([a, b], 20);
    expect(result.vessels.length).toBe(1);
    expect(result.contacts).toBe(0);
    expect(dockedPorts(result.vessels[0]).length).toBe(1);
    expect(length(sub(momentum(result.vessels), p))).toBeLessThan(1e-6);
  });

  it('bumps at 53 degrees of port misalignment instead of passing through', () => {
    const [a, b] = ports(0.6, 0.3, 53);
    const initial = b.position.y - a.position.y;
    const result = run([a, b], 8);
    expect(result.vessels.length).toBe(2);
    expect(result.contacts).toBeGreaterThan(0);
    expect(b.position.y - a.position.y).toBeGreaterThan(initial - 1.5);
    expect(b.velocity.y - a.velocity.y).toBeGreaterThan(-0.2);
  });

  it('does not exempt a port against an ordinary hull', () => {
    const a = ports(0.6, 0)[0], port = freePorts(a)[0];
    const b = box('obstacle', port.pos.x, port.pos.y);
    b.velocity.y = -0.3;
    expect(stepVesselContacts([a, b], DT)).toBeGreaterThan(0);
  });

  it('undocks without a collision kick and drifts clear with the original separation speed', () => {
    const { vessels: [merged] } = run(ports(0.6, 0.3), 20);
    const other = undock(merged, dockedPorts(merged)[0].uid)!;
    const axis = qRotate(merged.orientation, v3(0, 1, 0));
    expect(dot(sub(other.velocity, merged.velocity), axis)).toBeCloseTo(0.12, 6);
    const result = run([merged, other], 30);
    expect(result.vessels.length).toBe(2);
    expect(result.contacts).toBe(0);
    expect(dot(sub(other.velocity, merged.velocity), axis)).toBeCloseTo(0.12, 6);
    expect(freePorts(merged).every(p => !p.part.dockDisarmed)).toBe(true);
  });

  it('resolves contact through World against a loaded neighbour', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, 0);
    const a = world.launch(buildTender());
    placeInCircularOrbit(world, a, 'earth', 90000);
    const b = spawnRendezvousTarget(world, buildTender(), 60)!;
    const pa = freePorts(a.state)[0], pb = freePorts(b.state)[0];
    b.state.orientation = qMul(a.state.orientation, qFromAxisAngle(v3(0, 0, 1), 127 * Math.PI / 180));
    const newPort = freePorts(b.state)[0];
    b.state.position = add(b.state.position, sub(add(pa.pos, scale(pa.dir, 0.15)), newPort.pos));
    a.state.velocity = add(b.state.velocity, scale(pa.dir, 0.3));
    const before = dot(sub(b.state.velocity, a.state.velocity), pa.dir);
    world.tick(DT, neutralInput());
    expect(world.vessels.size).toBe(2);
    expect(dot(sub(b.state.velocity, a.state.velocity), pa.dir)).toBeGreaterThan(before + 0.02);
    expect(pb.part.dockDisarmed).toBeFalsy();
  });
});
