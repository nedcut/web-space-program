import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World, type WorldVessel } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { neutralInput } from '../src/sim/vessel';
import { add, length, normalize, scale, sub } from '../src/util/vec3';
import { DEFAULT_START_UT } from '../src/game/store';

/** Spawn a coasting vessel at a heliocentric state (bypasses the launch pad). */
function spawnCoasting(world: World, body: string, relPos: { x: number; y: number; z: number }, relVel: { x: number; y: number; z: number }): WorldVessel {
  const wv = world.launch(buildOrbiter());
  const bs = world.universe.ephem.getBodyState(body, world.ut);
  wv.mode = 'physics';
  wv.fixed = undefined;
  wv.body = body;
  wv.state.situation = 'flying';
  wv.state.angularVelocity = { x: 0, y: 0, z: 0 };
  wv.state.position = add(bs.position, relPos);
  wv.state.velocity = add(bs.velocity, relVel);
  return wv;
}

describe('rails time warp', () => {
  it('stops above the highest terrain when an SOI change and an impact fall in the same warp frame', () => {
    const u = new Universe('standard');
    const world = new World(u, PART_CATALOG, DEFAULT_START_UT);
    const moon = u.body('moon');
    // Just outside the Moon's SOI (Earth side), falling straight at the Moon at 300 m/s.
    const m = u.ephem.getRelativeState('moon', world.ut);
    const dir = normalize(scale(m.position, -1));
    const wv = spawnCoasting(world, 'earth', add(m.position, scale(dir, moon.soi + 20_000)), add(m.velocity, scale(dir, -300)));
    let minAlt = Infinity;
    for (let i = 0; i < 400; i++) {
      world.warp = { mode: 'rails', index: 8 };
      world.tick(0.25, neutralInput());
      if (wv.body === 'moon') minAlt = Math.min(minAlt, length(world.relativeState(wv).position) - moon.radius);
    }
    expect(wv.body).toBe('moon');
    expect(minAlt).toBeGreaterThan(0);
    // Warp was halted just before impact: still close to the surface and descending (not tunnelled through).
    const rs = world.relativeState(wv);
    const maxH = u.terrain('moon').maxHeight;
    expect(length(rs.position) - moon.radius).toBeGreaterThan(maxH);
    expect(length(rs.position) - moon.radius).toBeLessThan(maxH + 5000);
    expect(rs.position.x * rs.velocity.x + rs.position.y * rs.velocity.y + rs.position.z * rs.velocity.z).toBeLessThan(0);
    expect(world.warp.index).toBe(0);
  });

  it('finds SOI encounters that happen more than one prediction horizon after packing', () => {
    const u = new Universe('standard');
    const world = new World(u, PART_CATALOG, DEFAULT_START_UT);
    const earth = u.body('earth');
    const moon = u.body('moon');
    // Circular orbit in the Moon's plane, half an SOI inside its orbit, starting on the far side: the slow
    // phase drift brings the Moon around only after ~4 revolutions.
    const m = u.ephem.getRelativeState('moon', world.ut);
    const r = length(m.position) - moon.soi * 0.5;
    const vCirc = Math.sqrt(earth.gm / r);
    const wv = spawnCoasting(world, 'earth', scale(normalize(m.position), -r), scale(normalize(m.velocity), -vCirc));
    let visited = false;
    for (let i = 0; i < 60 && !visited; i++) {
      world.warp = { mode: 'rails', index: 8 };
      world.tick(0.25, neutralInput());
      visited = wv.body === 'moon';
    }
    expect(visited).toBe(true);
  });

  it('non-active vessels on rails keep up-to-date positions during physics ticks', () => {
    const u = new Universe('standard');
    const world = new World(u, PART_CATALOG, DEFAULT_START_UT);
    const earth = u.body('earth');
    const r = earth.radius + 200_000;
    const v = Math.sqrt(earth.gm / r);
    // Debris in orbit, then the active vessel elsewhere.
    const debris = spawnCoasting(world, 'earth', { x: r, y: 0, z: 0 }, { x: 0, y: v, z: 0 });
    const act = spawnCoasting(world, 'earth', { x: -r, y: 0, z: 0 }, { x: 0, y: -v, z: 0 });
    expect(world.active).toBe(act);
    world.vessels.set(debris.state.id, debris);
    // Warp a while (both packed), then fly a few physics ticks.
    for (let i = 0; i < 20; i++) {
      world.warp = { mode: 'rails', index: 5 };
      world.tick(0.25, neutralInput());
    }
    world.warp = { mode: 'rails', index: 0 };
    const t0 = world.ut;
    for (let i = 0; i < 100; i++) world.tick(0.02, neutralInput());
    expect(world.ut - t0).toBeGreaterThan(1.9);
    const rel = sub(debris.state.position, u.ephem.getBodyState('earth', world.ut).position);
    // Heliocentric position must track the orbit (Earth moves ~30 km/s, so a stale position is km off).
    expect(Math.abs(length(rel) - r)).toBeLessThan(50);
  });
});
