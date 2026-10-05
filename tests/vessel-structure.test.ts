import { gatherContacts } from '../src/sim/vessel/contact';
import { describe, expect, it } from 'vitest';
import { bodyToWorld, buildVessel, cloneVessel } from '../src/sim/vessel/assembly';
import { angularMomentum, stepVessel } from '../src/sim/vessel/integrator';
import { breakJoints, crashShocks, evaluateJointLoads, jointStrength, overloadedJoints } from '../src/sim/vessel/structure';
import { neutralInput, type StepResult, type VesselState } from '../src/sim/vessel/runtime';
import type { PartLoad } from '../src/sim/vessel/loads';
import { TEST_CATALOG, flatEarthEnv, NOSE_UP, stackCraft, vacuumEnv } from '../src/sim/vessel/testing';
import { add, cross, length, scale, sub, v3 } from '../src/util/vec3';
import { qFromAxisAngle, qIdentity } from '../src/util/quat';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';

const emptyResult = (): StepResult => ({ newVessels: [], events: [] });
const momentum = (vs: VesselState[]) => vs.reduce((sum, v) => add(sum, scale(v.velocity, v.mass)), v3());
const totalL = (vs: VesselState[]) => vs.reduce((sum, v) => add(sum, add(angularMomentum(v), cross(v.position, scale(v.velocity, v.mass)))), v3());

function winged() {
  const craft = stackCraft(['fuselage']);
  for (const side of [-1, 1]) craft.parts.push({ uid: side + 4, partId: 'wing', parent: 1, attachNode: 'srf', parentNode: 'srf',
    position: { x: side * 2.125, y: 0, z: 0 }, rotation: qFromAxisAngle({ x: 0, y: 1, z: 0 }, side * Math.PI / 2) });
  return craft;
}

describe('Newton–Euler attachment loads', () => {
  it('sums all descendants and cancels uniform gravity in free fall', () => {
    const v = buildVessel(stackCraft(['ballast', 'ballast', 'ballast']), TEST_CATALOG);
    const loads = evaluateJointLoads(v, [{ partUid: 1, point: v.parts[0].position, force: { x: 0, y: 300, z: 0 } }]);
    expect(loads.get(2)!.force.y).toBeCloseTo(200, 10);
    expect(loads.get(3)!.force.y).toBeCloseTo(100, 10);
    expect(length(loads.get(2)!.torque)).toBeLessThan(1e-10);
    stepVessel(v, neutralInput(), flatEarthEnv({ rho0: 0, surface: 'none' }), 0);
    for (const l of v.cache.jointLoads!.values()) expect(l.fraction).toBe(0);
  });

  it('includes centripetal force for a freely spinning rigid assembly', () => {
    const v = buildVessel(stackCraft(['ballast', 'ballast']), TEST_CATALOG, { angularVelocity: { x: 0, y: 0, z: 2 } });
    const l = evaluateJointLoads(v, []).get(2)!;
    expect(l.force.y).toBeCloseTo(100 * 4 * 0.5, 10);
    expect(length(l.torque)).toBeLessThan(1e-10);
  });

  it('balances each part inertia, gyroscopic terms, force lever arms and free couples', () => {
    const v = buildVessel(stackCraft(['ballast', 'ballast']), TEST_CATALOG);
    // A pure couple accelerates both parts. The joint carries half of the local spin torque;
    // the remainder is supplied by its force about each part centre.
    const t = { x: 1200, y: 0, z: 0 };
    const l = evaluateJointLoads(v, [{ partUid: 1, point: v.parts[0].position, force: v3(), torque: t }]).get(2)!;
    expect(l.torque.x).toBeCloseTo(600, 8);
    expect(Math.abs(l.force.z)).toBeGreaterThan(0);
    // Moving the same force at the attachment changes the transmitted moment.
    const centred = evaluateJointLoads(v, [{ partUid: 2, point: v.parts[1].position, force: { x: 100, y: 0, z: 0 } }]).get(2)!;
    const offset = evaluateJointLoads(v, [{ partUid: 2, point: { ...v.parts[1].position, y: -2 }, force: { x: 100, y: 0, z: 0 } }]).get(2)!;
    expect(offset.torque.z).not.toBeCloseTo(centred.torque.z, 5);
  });

  it('scales node ratings and defines radial, decoupler and docking strengths; overrides win', () => {
    const ratings = [0, 1, 2, 3, 4].map(size => {
      const def = TEST_CATALOG.get('ballast')!;
      const catalog = new Map(TEST_CATALOG).set('ballast', { ...def, attachNodes: def.attachNodes.map(n => ({ ...n, size })) });
      const v = buildVessel(stackCraft(['ballast', 'ballast']), catalog);
      return jointStrength(v, v.parts[1]);
    });
    for (let i = 1; i < ratings.length; i++) { expect(ratings[i].force).toBeGreaterThan(ratings[i-1].force); expect(ratings[i].torque).toBeGreaterThan(ratings[i-1].torque); }
    for (const id of ['dec-1', 'dock-1', 'dec-radial']) {
      const v = buildVessel(stackCraft(['tank-1-mid', id], PART_CATALOG), PART_CATALOG);
      expect(jointStrength(v, v.parts[1]).force).toBeGreaterThan(0);
      v.parts[1].def = { ...v.parts[1].def, breakingForce: 123, breakingTorque: 45 };
      expect(jointStrength(v, v.parts[1])).toEqual({ force: 123, torque: 45 });
      v.parts[0].def = { ...v.parts[0].def, breakingForce: 100 };
      expect(jointStrength(v, v.parts[1]).force).toBe(100);
    }
  });

  it('rejects one-frame overloads, recovers below hysteresis, and fails sustained load deterministically', () => {
    const v = buildVessel(stackCraft(['ballast', 'ballast']), TEST_CATALOG);
    v.parts[1].def = { ...v.parts[1].def, breakingForce: 100 };
    const loads: PartLoad[] = [{ partUid: 1, point: v.parts[0].position, force: { x: 0, y: 1000, z: 0 } }];
    expect(overloadedJoints(v, loads, .02)).toEqual([]);
    expect(overloadedJoints(v, [], .02)).toEqual([]);
    expect(v.parts[1].structuralFatigue).toBeUndefined();
    for (let i = 0; i < 3; i++) expect(overloadedJoints(v, loads, .02)).toEqual([]);
    const copy = cloneVessel(v);
    expect(overloadedJoints(v, loads, .02)).toEqual([2]);
    expect(overloadedJoints(copy, loads, .02)).toEqual([2]);
    expect(copy.parts[1].structuralFatigue).toBe(v.parts[1].structuralFatigue);
  });

  it('conserves linear and angular momentum for simultaneous nested breaks without moving parts', () => {
    const v = buildVessel(stackCraft(['ballast', 'ballast', 'ballast', 'ballast']), TEST_CATALOG,
      { position: { x: 13, y: 5, z: -7 }, velocity: { x: 2, y: -3, z: 8 }, angularVelocity: { x: 1, y: .2, z: -.4 }, orientation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, .7) });
    const beforeP = momentum([v]), beforeL = totalL([v]);
    const positions = new Map(v.parts.map(p => [p.uid, bodyToWorld(v, p.position)]));
    const result = emptyResult();
    breakJoints(v, [2, 3, 4], result);
    const pieces = [v, ...result.newVessels];
    expect(pieces).toHaveLength(4);
    for (const piece of pieces) for (const p of piece.parts) expect(length(sub(bodyToWorld(piece, p.position), positions.get(p.uid)!))).toBeLessThan(1e-12);
    expect(length(sub(momentum(pieces), beforeP))).toBeLessThan(1e-9);
    expect(length(sub(totalL(pieces), beforeL))).toBeLessThan(1e-8);
    expect(new Set(pieces.map(p => p.id)).size).toBe(4);
    expect(result.events.every(e => e.type === 'structuralFailure')).toBe(true);
  });
});

describe('flight and crash breakup', () => {
  it('breaks a stock rocket broadside in dense transonic max-Q flow, while aligned flight survives', () => {
    const craft = STOCK_CRAFTS.find(c => c.id === 'stock-kestrel')!.build();
    const env = flatEarthEnv({ g: 0, surface: 'none', scaleHeight: Infinity });
    const run = (broadside: boolean) => {
      const v = buildVessel(craft, PART_CATALOG, { velocity: broadside ? { x: 400, y: 0, z: 0 } : { x: 0, y: 400, z: 0 } });
      const events = [];
      for (let i = 0; i < 50; i++) events.push(...stepVessel(v, neutralInput(), env, i * .02, .02, { disableHeating: true }).events);
      return events.filter(e => e.type === 'structuralFailure');
    };
    expect(run(true).length).toBeGreaterThan(0);
    expect(run(false)).toEqual([]);
    expect(run(true)).toEqual(run(true));
  });

  it('rips a wing off at excessive aerodynamic g, but retains it at ordinary flight loads', () => {
    const env = flatEarthEnv({ g: 0, surface: 'none', scaleHeight: Infinity });
    for (const [speed, fails] of [[90, false], [400, true]] as const) {
      const v = buildVessel(winged(), TEST_CATALOG, { velocity: { x: 0, y: speed, z: -speed * .25 } });
      let g = 0, broke = false;
      for (let i = 0; i < 20; i++) {
        const r = stepVessel(v, neutralInput(), env, i*.02, .02, { disableHeating: true });
        g = Math.max(g, v.telemetry.gForce);
        broke ||= r.events.some(e => e.type === 'structuralFailure' && e.partUid !== 1);
      }
      expect(broke).toBe(fails);
      if (fails) expect(g).toBeGreaterThan(10);
    }
  });

  it('a 30 m/s lander impact transmits impulse, destroys impact hardware and scatters surviving neighbours', () => {
    const craft = stackCraft(['capsule', 'lander-core', 'engine']);
    for (const side of [-1, 1]) craft.parts.push({ uid: side + 6, partId: 'ballast', parent: 2, attachNode: 'srf', parentNode: 'srf', position: { x: side * 1.5, y: -1, z: 0 }, rotation: qIdentity() });
    const run = () => {
      const v = buildVessel(craft, TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 3 }, velocity: { x: 0, y: 0, z: -30 } });
      const initialP = momentum([v]);
      for (let i = 0; i < 30; i++) {
        const r = stepVessel(v, neutralInput(), flatEarthEnv({ g: 0, rho0: 0 }), i*.02, .02, { disableHeating: true });
        if (r.events.some(e => e.type === 'partDestroyed')) {
          const pieces = [v, ...r.newVessels].filter(p => !p.destroyed);
          expect(pieces.length).toBeGreaterThanOrEqual(3);
          expect(r.events.some(e => e.type === 'structuralFailure')).toBe(true);
          expect(pieces.some(p => p.parts.some(part => part.partId === 'engine'))).toBe(false);
          expect(momentum(pieces).z).toBeGreaterThan(initialP.z);
          expect(new Set(pieces.map(p => JSON.stringify(p.velocity))).size).toBeGreaterThan(1);
          expect(pieces.every(p => length(p.velocity) > 1)).toBe(true);
          return { events: r.events, pieces: pieces.map(p => ({ id: p.id, position: p.position, velocity: p.velocity, spin: p.angularVelocity })) };
        }
      }
      throw new Error('No impact');
    };
    expect(run()).toEqual(run());
  });

  it('water-impact energy uses surface-relative speed, independent of heliocentric motion', () => {
    const shocks = (boost: number) => {
      const v = buildVessel(stackCraft(['ballast']), TEST_CATALOG, { orientation: NOSE_UP,
        position: { x: 0, y: 0, z: .49 }, velocity: { x: boost, y: 0, z: -30 } });
      const env = flatEarthEnv({ surface: 'water', g: 0, rho0: 0 });
      const ground = env.ground;
      env.ground = (p, t) => ({ ...ground(p,t)!, surfaceVelocity: { x: boost, y: 0, z: 0 } });
      return crashShocks(v, gatherContacts(v, env, 0, .02, 0));
    };
    expect(shocks(0)).toEqual([{ partUid: 1, energy: 45000 }]);
    expect(shocks(30000)).toEqual(shocks(0));
  });

  it('load instrumentation never perturbs a below-limit rigid-body trace', () => {
    const a = buildVessel(stackCraft(['ballast', 'ballast']), TEST_CATALOG, { angularVelocity: { x: .1, y: .2, z: .3 } });
    const b = cloneVessel(a);
    for (let i = 0; i < 200; i++) {
      // Independent observations between steps must not influence the next rigid-body solution.
      evaluateJointLoads(b, []);
      expect(stepVessel(a, neutralInput(), vacuumEnv(), i*.02)).toEqual(stepVessel(b, neutralInput(), vacuumEnv(), i*.02));
      expect(a.position).toEqual(b.position); expect(a.velocity).toEqual(b.velocity);
      expect(a.orientation).toEqual(b.orientation); expect(a.angularVelocity).toEqual(b.angularVelocity);
    }
  });
});
