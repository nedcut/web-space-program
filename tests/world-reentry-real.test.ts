import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { coastUntil, localFrame } from '../src/game/autopilot';
import { neutralInput, peakTemperature } from '../src/sim/vessel';
import { add, scale, normalize, length } from '../src/util/vec3';
import { propagate } from '../src/sim/orbit';

it.each(['shield', 'capsule', 'tank'] as const)('real LEO reentry: %s', payload => {
  const shielded = payload === 'shield';
  const world = new World(new Universe('real'), PART_CATALOG, DEFAULT_START_UT);
  const craft = buildOrbiter();
  craft.parts = craft.parts.filter(p => [1, 2, ...(shielded ? [3] : [])].includes(p.uid));
  if (payload === 'tank') {
    const tank = buildOrbiter().parts.find(p => p.partId === 'tank-1-long')!;
    tank.parent = 1;
    tank.position = { x: 0, y: -2.3, z: 0 };
    tank.resources = { liquidFuel: 0, oxidizer: 0 };
    craft.parts.push(tank);
  }
  craft.parts.forEach(p => p.stage = 0);
  world.launch(craft);
  const vessel = world.active!;
  placeInCircularOrbit(world, vessel, 'earth', 220000);

  // A retrograde impulse at 220 km lowers periapsis to 35 km; coast to the entry interface.
  const frame = localFrame(world, vessel), body = frame.body;
  const ra = body.radius + 220000, rp = body.radius + 35000;
  vessel.state.velocity = add(world.universe.ephem.getBodyState('earth', world.ut).velocity,
    scale(normalize(frame.rs.velocity), Math.sqrt(body.gm * (2 / ra - 2 / (ra + rp)))));
  const orbit = world.orbitOf(vessel);
  let entry = world.ut;
  while (length(propagate(orbit, entry).position) - body.radius > 145000) entry += 5;
  coastUntil(world, entry);

  let peak = 0, maxSpeed = 0, maxInertialSpeed = 0, deployed = false;
  const events: string[] = [];
  world.onEvent = e => {
    if (e.type === 'partDestroyed') events.push(`${e.partUid}:${e.reason}`);
    if (e.type === 'chute' && e.phase === 'full') deployed = true;
  };
  for (let i = 0; i < 50 * 2400 && world.active && vessel.state.situation === 'flying'; i++) {
    const f = localFrame(world, vessel);
    maxSpeed = Math.max(maxSpeed, length(f.surfVel));
    maxInertialSpeed = Math.max(maxInertialSpeed, length(f.rs.velocity));
    world.warp = { mode: 'rails', index: 0 };
    world.tick(0.02, neutralInput({ sas: 'maneuver', maneuverDirection: scale(normalize(f.surfVel), -1), stage: i === 0 }));
    for (const p of vessel.state.parts) peak = Math.max(peak, peakTemperature(p));
  }
  console.log({ payload, peak, maxSpeed, maxInertialSpeed, deployed, events, situation: vessel.state.situation,
    alive: !!world.active, ablator: vessel.state.parts.find(p => p.def.id === 'shield-1')?.resources.ablator });
  if (shielded) {
    expect(world.active).toBe(vessel);
    expect(vessel.state.situation).not.toBe('flying');
    expect(deployed).toBe(true);
    expect(peak).toBeGreaterThan(1000);
    expect(maxInertialSpeed).toBeGreaterThan(7800);
    expect(events).toEqual([]);
  } else {
    expect(events.some(e => e.endsWith('overheat'))).toBe(true);
    if (payload === 'tank') expect(events).toContain('5:overheat');
    expect(world.active).toBeNull();
  }
}, 180000);
