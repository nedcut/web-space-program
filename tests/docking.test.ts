import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { RESOURCES } from '../src/data/resources';
import { buildTender } from '../src/editor/stockCrafts';
import {
  angularMomentum,
  buildVessel,
  dockedPorts,
  freePorts,
  neutralInput,
  stepDocking,
  stepVessel,
  systemAngularMomentum,
  undock,
  totalResource,
} from '../src/sim/vessel';
import type { VesselState } from '../src/sim/vessel';
import { vacuumEnv } from '../src/sim/vessel/testing';
import { add, dot, length, scale, sub, v3, type Vec3 } from '../src/util/vec3';
import { qFromAxisAngle, qMul, qRotate } from '../src/util/quat';

const env = vacuumEnv();
const DT = 1 / 50;

/** Two Tenders nose to nose along +Y: A at the origin, B facing it with its port face `gap` metres away. */
function pair(gap: number, approachSpeed: number, tiltDeg = 0): [VesselState, VesselState] {
  const craft = buildTender();
  const A = buildVessel(craft, PART_CATALOG, { id: 'A', resourceDefs: RESOURCES });
  const qB = qMul(qFromAxisAngle(v3(0, 0, 1), (tiltDeg * Math.PI) / 180), qFromAxisAngle(v3(1, 0, 0), Math.PI));
  const B = buildVessel(craft, PART_CATALOG, { id: 'B', resourceDefs: RESOURCES, orientation: qB });
  B.name = 'Tender B';
  const pa = freePorts(A)[0];
  const pb0 = freePorts(B)[0];
  // Place B so its face sits `gap` above A's face.
  B.position = add(B.position, sub(add(pa.pos, v3(0, gap, 0)), pb0.pos));
  B.velocity = v3(0, -approachSpeed, 0);
  return [A, B];
}

function momentum(vs: VesselState[]): Vec3 {
  return vs.reduce((s, v) => add(s, scale(v.velocity, v.mass)), v3());
}

function run(vs: VesselState[], seconds: number): VesselState[] {
  let list = [...vs];
  for (let i = 0, t = 0; i < seconds / DT; i++, t += DT) {
    for (const v of list) stepVessel(v, neutralInput(), env, t, DT);
    const ev = stepDocking(list, DT);
    for (const e of ev) list = list.filter((v) => v !== e.removed);
  }
  return list;
}

describe('docking', () => {
  it('two vessels approaching at 0.2 m/s on aligned ports merge, conserving momentum', () => {
    const [A, B] = pair(0.9, 0.2);
    const mass = A.mass + B.mass;
    const P0 = momentum([A, B]);
    const X0 = scale(add(scale(A.position, A.mass), scale(B.position, B.mass)), 1 / mass);
    const V0 = scale(P0, 1 / mass);
    const partCount = A.parts.length + B.parts.length;
    const mono = totalResource(A, 'monopropellant') + totalResource(B, 'monopropellant');
    const L0 = systemAngularMomentum([A, B], X0, V0);
    const out = run([A, B], 20);
    expect(out.length).toBe(1);
    const M = out[0];
    expect(M).toBe(A);
    expect(M.parts.length).toBe(partCount);
    expect(new Set(M.parts.map((p) => p.uid)).size).toBe(partCount);
    expect(M.mass).toBeCloseTo(mass, 6);
    expect(totalResource(M, 'monopropellant')).toBeCloseTo(mono, 6);
    // Linear momentum: exact (field and merge are internal); angular: tiny (aligned, no spin).
    expect(length(sub(momentum([M]), P0))).toBeLessThan(1e-6 * mass);
    expect(length(sub(angularMomentum(M), L0))).toBeLessThan(1e-3);
    // The two ports are now joined: one docked joint, no free ports.
    expect(dockedPorts(M).length).toBe(1);
    expect(freePorts(M).length).toBe(0);
    // Single tree: every part but the root has a parent in the vessel.
    expect(M.parts.filter((p) => p.parent === null).length).toBe(1);
    // Staging survives: both engines still staged.
    expect(M.parts.filter((p) => p.engine && p.stage !== undefined).length).toBe(2);
  });

  it('merges a vessel that arrives with a small spin and lateral drift, conserving momentum', () => {
    const [A, B] = pair(0.6, 0.15);
    B.velocity = add(B.velocity, v3(0.02, 0, -0.01));
    B.angularVelocity = v3(0.002, 0.01, 0);
    const mass = A.mass + B.mass;
    const P0 = momentum([A, B]);
    const out = run([A, B], 30);
    expect(out.length).toBe(1);
    expect(length(sub(momentum(out), P0))).toBeLessThan(1e-6 * mass);
  });

  it('misaligned ports (45 degrees) do not dock', () => {
    const [A, B] = pair(0.5, 0.2, 45);
    const out = run([A, B], 15);
    expect(out.length).toBe(2);
    expect(freePorts(A).length).toBe(1);
    expect(freePorts(B).length).toBe(1);
  });

  it('too fast an approach does not dock', () => {
    const [A, B] = pair(0.9, 1.5);
    expect(run([A, B], 3).length).toBe(2);
  });

  it('undock splits at the port with a separation impulse and does not immediately re-dock', () => {
    const [A, B] = pair(0.5, 0.2);
    const [M] = run([A, B], 20);
    const mass = M.mass;
    const P0 = momentum([M]);
    const port = dockedPorts(M)[0];
    const nv = undock(M, port.uid)!;
    expect(nv).toBeTruthy();
    expect(nv.id).toBe('B');
    expect(nv.name).toBe('Tender B');
    expect(M.mass + nv.mass).toBeCloseTo(mass, 6);
    expect(length(sub(momentum([M, nv]), P0))).toBeLessThan(1e-6 * mass);
    const axis = qRotate(M.orientation, v3(0, 1, 0)); // A's nose / port normal
    const sep = dot(sub(nv.velocity, M.velocity), axis);
    expect(sep).toBeGreaterThan(0.08);
    const out = run([M, nv], 25);
    expect(out.length).toBe(2);
    expect(dot(sub(nv.position, M.position), axis)).toBeGreaterThan(2);
    // Ports re-arm once clear.
    expect(freePorts(M).every((p) => !p.part.dockDisarmed)).toBe(true);
  });
});

describe('RCS translation', () => {
  it('translate forward produces the expected small delta-v along the nose', () => {
    const v = buildVessel(buildTender(), PART_CATALOG, { resourceDefs: RESOURCES });
    const m0 = v.mass;
    const forwardNozzles = v.parts.filter((p) => p.partId === 'rcs-nudge').length; // one -Y exhaust per quad
    const F = forwardNozzles * 500;
    const input = neutralInput({ rcs: true, translateY: 1 });
    for (let i = 0; i < 50; i++) stepVessel(v, input, env, i * DT, DT);
    const dv = qRotate({ x: -v.orientation.x, y: -v.orientation.y, z: -v.orientation.z, w: v.orientation.w }, v.velocity);
    const expected = (F / ((m0 + v.mass) / 2)) * 1.0;
    expect(dv.y).toBeGreaterThan(expected * 0.97);
    expect(dv.y).toBeLessThan(expected * 1.03);
    expect(Math.hypot(dv.x, dv.z)).toBeLessThan(0.05 * dv.y);
    expect(v.mass).toBeLessThan(m0); // monoprop consumed
  });

  it('translate right (+X) and up (+Z) move the vessel sideways', () => {
    for (const [key, axis] of [['translateX', 'x'], ['translateZ', 'z']] as const) {
      const v = buildVessel(buildTender(), PART_CATALOG, { resourceDefs: RESOURCES });
      const input = neutralInput({ rcs: true, [key]: 1 });
      for (let i = 0; i < 50; i++) stepVessel(v, input, env, i * DT, DT);
      expect(v.velocity[axis]).toBeGreaterThan(0.3);
    }
  });

  it('RCS off: translation input does nothing', () => {
    const v = buildVessel(buildTender(), PART_CATALOG, { resourceDefs: RESOURCES });
    for (let i = 0; i < 50; i++) stepVessel(v, neutralInput({ translateY: 1 }), env, i * DT, DT);
    expect(length(v.velocity)).toBeLessThan(1e-9);
  });
});
