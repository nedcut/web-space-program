import { describe, it, expect } from 'vitest';
import { EVA_PART } from '../src/data/eva';
import { PART_CATALOG } from '../src/data/parts';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { buildVessel, neutralInput } from '../src/sim/vessel';
import { collideEvaWithHull, EVA_HEIGHT, EVA_HULL_RADIUS } from '../src/sim/vessel/eva';
import { NOSE_UP } from '../src/sim/vessel/testing';
import type { VesselState } from '../src/sim/vessel/runtime';
import { qIdentity, qFromAxisAngle, qRotate } from '../src/util/quat';
import { v3, add, sub, scale, length, normalize, dot, cross } from '../src/util/vec3';
import type { LandingLegModule, WheelModule } from '../src/sim/vessel/types';

/** Camera attitude looking along `forward` (−Z) with `up` as screen up. */
function look(forward: ReturnType<typeof v3>, up: ReturnType<typeof v3>) {
  const z = scale(forward, -1), x = normalize(cross(up, z)), y = cross(z, x);
  const m = [[x.x, y.x, z.x], [x.y, y.y, z.y], [x.z, y.z, z.z]];
  const t = m[0][0] + m[1][1] + m[2][2];
  if (t > 0) { const k = Math.sqrt(t + 1) * 2; return { w: k / 4, x: (m[2][1] - m[1][2]) / k, y: (m[0][2] - m[2][0]) / k, z: (m[1][0] - m[0][1]) / k }; }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const k = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; return { w: (m[2][1] - m[1][2]) / k, x: k / 4, y: (m[0][1] + m[1][0]) / k, z: (m[0][2] + m[2][0]) / k }; }
  if (m[1][1] > m[2][2]) { const k = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; return { w: (m[0][2] - m[2][0]) / k, x: (m[0][1] + m[1][0]) / k, y: k / 4, z: (m[1][2] + m[2][1]) / k }; }
  const k = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; return { w: (m[1][0] - m[0][1]) / k, x: (m[0][2] + m[2][0]) / k, y: (m[1][2] + m[2][1]) / k, z: k / 4 };
}
function astronaut(x: number, y: number, z: number, landed = true): VesselState {
  const v = buildVessel({ name: 'EVA', version: 1, type: 'VAB', parts: [{ uid: 1, partId: EVA_PART.id, position: v3(), rotation: qIdentity() }] }, new Map([[EVA_PART.id, EVA_PART]]));
  v.eva = { astronautId: 'test', walkPhase: 0, walking: false, jetting: false };
  v.position = v3(x, y, z);
  v.orientation = NOSE_UP; // suit up = +Z (flat world)
  v.situation = landed ? 'landed' : 'flying';
  return v;
}
/** One upright part (axis +Z) with its centre at `centre`. */
function hull(partId: string, centre = v3(0, 0, 0)): VesselState {
  const v = buildVessel({ name: 'Hull', version: 1, type: 'VAB', parts: [{ uid: 1, partId, position: v3(), rotation: qIdentity() }] }, PART_CATALOG);
  v.position = centre;
  v.orientation = NOSE_UP;
  return v;
}

describe('astronaut vs hull collision', () => {
  it('pushes a walking astronaut out of a tank sideways only, and stops motion into it', () => {
    const tank = hull('tank-2-mid', v3(0, 0, 1.5)); // r 1.25, 3 m tall, standing on z = 0
    const a = astronaut(1.0, 0, EVA_HEIGHT);
    a.velocity = v3(-1.4, 0.5, 0);
    expect(collideEvaWithHull(a, tank)).toBe(true);
    expect(a.position.x).toBeCloseTo(1.25 + EVA_HULL_RADIUS, 6);
    expect(a.position.z).toBeCloseTo(EVA_HEIGHT, 9);
    expect(a.velocity.x).toBeCloseTo(0, 9);
    expect(a.velocity.y).toBeCloseTo(0.5, 9); // sliding along the hull is kept
    // Clear of the hull: no contact, nothing changes.
    expect(collideEvaWithHull(a, tank)).toBe(false);
    const far = astronaut(30, 0, EVA_HEIGHT);
    expect(collideEvaWithHull(far, tank)).toBe(false);
  });

  it('resolves boxes and end caps, relative to a moving hull, in any attitude', () => {
    const girder = hull('girder', v3(0, 0, 1)); // 0.36 × 2 × 0.36, upright
    const a = astronaut(0.3, 0.02, 1, false);
    collideEvaWithHull(a, girder);
    expect(a.position.x).toBeCloseTo(0.18 + EVA_HULL_RADIUS, 6);
    // In space: drifting onto the top of a tank lying on its side, the hull itself moving at 7 km/s.
    const tank = hull('tank-1-long', v3(0, 0, 0)); // r 0.625, 3 m long
    tank.orientation = qFromAxisAngle(v3(0, 0, 1), Math.PI / 2); // axis +Y → −X
    tank.velocity = v3(7000, 0, 0);
    const b = astronaut(0.5, 0, 0.6 + 0.5 + 0.3, false); // shins 0.3 m into the tank's side from above
    b.velocity = v3(7000.2, 0, -0.8);
    collideEvaWithHull(b, tank);
    expect(b.position.z - 0.5).toBeCloseTo(0.625 + EVA_HULL_RADIUS, 6);
    expect(b.velocity.z).toBeCloseTo(0, 9);
    expect(b.velocity.x).toBeCloseTo(7000.2, 9);
    // Past the tank's end along its axis (x < −1.5): pushed out through the end cap.
    const c = astronaut(-1.6, 0, 0, false);
    collideEvaWithHull(c, tank);
    expect(c.position.x).toBeCloseTo(-1.5 - EVA_HULL_RADIUS, 6);
  });

  it('does not lift a grounded astronaut onto or under a hull overhead', () => {
    const tank = hull('tank-2-mid', v3(0, 0, 1.8 + 1.5 - 0.2)); // bottom 0.2 m into the helmet probe
    const a = astronaut(0, 0, EVA_HEIGHT);
    collideEvaWithHull(a, tank);
    expect(a.position).toEqual(v3(0, 0, EVA_HEIGHT));
  });

  it('stops an astronaut walking into a rocket on the pad (it used to walk straight through)', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const ship = w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build());
    for (let i = 0; i < 10; i++) w.tick(0.02, neutralInput());
    const eva = w.goEva()!;
    const up = normalize(sub(eva.state.position, w.universe.ephem.getBodyState(eva.body, w.ut).position));
    const flat = (x: ReturnType<typeof v3>) => sub(x, scale(up, dot(x, up)));
    const start = flat(sub(eva.state.position, ship.state.position));
    // Camera looking at the rocket's axis; walk for 6 s (8 m at walking pace, ~4 m to the axis).
    const heading = look(normalize(scale(start, -1)), up);
    let closest = Infinity;
    for (let i = 0; i < 300; i++) {
      w.tick(0.02, neutralInput({ translateZ: -1, evaHeading: heading }));
      closest = Math.min(closest, length(flat(sub(eva.state.position, ship.state.position))));
    }
    // Stopped at the hull (at walking height the Meridian is its engine bell, ~0.6 m in radius), still on the near
    // side, on its feet, and not inside any part.
    expect(closest).toBeGreaterThan(0.8);
    const probe = structuredClone(eva.state);
    collideEvaWithHull(probe, ship.state);
    expect(length(sub(probe.position, eva.state.position))).toBeLessThan(0.03);
    expect(dot(flat(sub(eva.state.position, ship.state.position)), start)).toBeGreaterThan(0);
    expect(eva.state.situation).toBe('landed');
    expect(ship.mode).toBe('prelaunch');
  });

  it('leaves the hatch exit in orbit and boarding untouched', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const ship = w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build());
    placeInCircularOrbit(w, ship, 'earth', 200000);
    const eva = w.goEva()!;
    const pod = ship.state.parts.find(p => p.crew)!;
    // The hatch (0.6 m out) is clear of the hull: no push at the exit.
    expect(collideEvaWithHull(structuredClone(eva.state), ship.state)).toBe(false);
    for (let i = 0; i < 50; i++) w.tick(0.02, neutralInput());
    expect(length(sub(eva.state.velocity, ship.state.velocity))).toBeLessThan(1e-3);
    expect(length(sub(w.hatchPosition(ship.state, pod), eva.state.position))).toBeLessThan(0.01);
    expect(w.boardEva()).toBe(true);
  });

  /** World position of a point given in the frame of the hull's only part. */
  function partPoint(v: VesselState, local: ReturnType<typeof v3>) {
    const p = v.parts[0];
    return add(v.position, qRotate(v.orientation, sub(add(p.position, qRotate(p.rotation, local)), v.com)));
  }

  it('deployed landing legs collide with their strut and foot pad, stowed legs only with the stowed shape', () => {
    const leg = hull('leg-stilt', v3(0, 0, 0));
    const m = leg.parts[0].def.modules[leg.parts[0].leg!.moduleIndex] as LandingLegModule;
    const foot = partPoint(leg, m.footPosition);
    const out = normalize(sub(foot, partPoint(leg, v3(m.footPosition.x, m.footPosition.y, 0))));
    // Astronaut drifting (not grounded) with the waist 0.3 m from the pad centre, outward from the leg.
    const at = add(foot, scale(out, 0.3));
    const stowed = astronaut(at.x, at.y, at.z, false);
    expect(collideEvaWithHull(stowed, leg)).toBe(false);
    leg.parts[0].leg!.deployed = true;
    const a = astronaut(at.x, at.y, at.z, false);
    a.velocity = scale(out, -0.5);
    expect(collideEvaWithHull(a, leg)).toBe(true);
    expect(length(sub(a.position, foot))).toBeGreaterThanOrEqual(m.footRadius! + EVA_HULL_RADIUS - 1e-9);
    expect(dot(a.velocity, out)).toBeGreaterThanOrEqual(-1e-12);
    // Halfway along the strut, too.
    const mid = scale(add(partPoint(leg, m.strutTop!), foot), 0.5);
    const b = astronaut(mid.x + out.x * 0.2, mid.y + out.y * 0.2, mid.z + out.z * 0.2, false);
    expect(collideEvaWithHull(b, leg)).toBe(true);
  });

  it('lowered wheels collide with the tyre; gear still swinging down keeps the stowed shape', () => {
    const gear = hull('gear-bogie', v3(0, 0, 0));
    const w = gear.parts[0].wheel!;
    const m = gear.parts[0].def.modules[w.moduleIndex] as WheelModule;
    const centre = partPoint(gear, m.wheelCenter);
    const out = normalize(sub(centre, partPoint(gear, v3(m.wheelCenter.x, m.wheelCenter.y, 0))));
    const at = add(centre, scale(out, m.radius));
    w.deployed = true; w.deploy = 0.5;
    expect(collideEvaWithHull(astronaut(at.x, at.y, at.z, false), gear)).toBe(false);
    w.deploy = 1;
    const a = astronaut(at.x, at.y, at.z, false);
    expect(collideEvaWithHull(a, gear)).toBe(true);
    expect(length(sub(a.position, centre))).toBeGreaterThanOrEqual(m.radius + EVA_HULL_RADIUS - 1e-9);
  });
});
