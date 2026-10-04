import { describe, it, expect } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { EVA_PART } from '../src/data/eva';
import { buildTender } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { buildVessel, neutralInput, recomputeMassProperties, freePorts, mergeVessels, undock, dockedPorts } from '../src/sim/vessel';
import { stepEva, EVA_HEIGHT, EVA_EXHAUST_SPEED } from '../src/sim/vessel/eva';
import { vacuumEnv } from '../src/sim/vessel/testing';
import { generateAstronaut, crewIds } from '../src/sim/crew/crew';
import type { CraftDef } from '../src/sim/vessel/types';
import { qIdentity, qFromTo } from '../src/util/quat';
import { v3, add, sub, scale, length, normalize, dot } from '../src/util/vec3';

const pod: CraftDef = { name: 'Crew test', version: 1, type: 'VAB', parts: [{ uid: 1, partId: 'pod-lantern-1', position: v3(), rotation: qIdentity(), stage: 0 }] };
function orbit() {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const ship = w.launch(pod);
  placeInCircularOrbit(w, ship, 'moon', 15000);
  return { w, ship };
}
function lunarSurface() {
  const { w, ship } = orbit();
  const eva = w.goEva()!;
  // Pack the mothership on a safe orbit to leave the walking test independent of ship contact.
  w.switchTo(ship.state.id);
  w.advanceRailsTo(w.ut + 1);
  w.switchTo(eva.state.id);
  const u = w.universe, body = u.body('moon');
  const fixed = normalize(v3(1, 0.2, 0.1));
  const h = u.terrain('moon').heightAt(fixed.x,fixed.y,fixed.z);
  const rel = u.ephem.fromBodyFixed('moon', scale(fixed, body.radius + h + EVA_HEIGHT), w.ut);
  const bs = u.ephem.getBodyState('moon',w.ut);
  eva.state.position = add(bs.position,rel);
  const env = u.createEnvironment(() => 'moon');
  const g = env.ground(eva.state.position,w.ut)!;
  eva.state.position = add(g.surfacePoint,scale(g.normal,EVA_HEIGHT));
  eva.state.velocity = { ...g.surfaceVelocity };
  eva.state.orientation = qFromTo(v3(0,1,0),normalize(rel));
  eva.state.situation = 'landed';
  return { w, ship, eva, env };
}

describe('human crew and EVA', () => {
  it('generates deterministic original human names and fills launch seats', () => {
    expect(generateAstronaut(42,3)).toEqual(generateAstronaut(42,3));
    expect(generateAstronaut(42,3)).not.toEqual(generateAstronaut(43,3));
    const { w, ship } = orbit();
    expect(w.crewFor(ship.state)).toHaveLength(1);
    expect(w.canControl()).toBe(true);
    expect(w.catalog.has(EVA_PART.id)).toBe(true);
    expect(PART_CATALOG.has(EVA_PART.id)).toBe(false);
  });

  it('spawns outside the hatch with zero relative velocity and conserved mass, COM and momentum', () => {
    const { w, ship } = orbit();
    const p = { ...ship.state.position }, vel = { ...ship.state.velocity }, mass = ship.state.mass;
    const hatch = w.hatchPosition(ship.state,ship.state.parts[0]);
    const eva = w.goEva()!;
    expect(length(sub(eva.state.position,hatch))).toBeLessThan(1e-6);
    expect(length(sub(eva.state.velocity,ship.state.velocity))).toBeLessThan(1e-8);
    expect(eva.state.mass + ship.state.mass).toBeCloseTo(mass,8);
    const centerOffset = scale(add(scale(sub(ship.state.position,p),ship.state.mass),scale(sub(eva.state.position,p),eva.state.mass)),1/mass);
    expect(length(centerOffset)).toBeLessThan(2e-5);
    const impulse = add(scale(sub(ship.state.velocity,vel),ship.state.mass),scale(sub(eva.state.velocity,vel),eva.state.mass));
    expect(length(impulse)).toBeLessThan(1e-6);
    expect(w.active).toBe(eva);
    expect(crewIds(ship.state)).toHaveLength(0);
    expect(w.canControl(ship.state)).toBe(false);
  });

  it('limits jetpack delta-v to the gas carried, including partial final burns', () => {
    const v = buildVessel({ ...pod, parts: [{ ...pod.parts[0], partId: EVA_PART.id }] },new Map([[EVA_PART.id,EVA_PART]]));
    v.eva = { astronautId: 'test', walkPhase: 0, walking: false, jetting: false };
    const startMass = v.mass;
    const env = vacuumEnv();
    for(let i=0;i<500;i++) stepEva(v,neutralInput({translateX:1}),env,i*0.25,0.25);
    expect(v.parts[0].resources.monopropellant).toBe(0);
    expect(length(v.velocity)).toBeCloseTo(EVA_EXHAUST_SPEED*Math.log(startMass/95),7);
    const before = {...v.velocity};
    stepEva(v,neutralInput({translateX:1}),env,126,1);
    expect(v.velocity).toEqual(before);
    expect(v.eva.jetting).toBe(false);
  });

  it('walks and runs on lunar terrain without penetration, then hops and lands', () => {
    const { w, eva, env } = lunarSurface();
    const startFixed = w.universe.ephem.toBodyFixed('moon',w.relativeState(eva).position,w.ut);
    for(let i=0;i<1000;i++) {
      w.tick(0.02,neutralInput({translateZ:-1,evaRun:true}));
      const g = env.ground(eva.state.position,w.ut)!;
      expect(dot(sub(eva.state.position,g.surfacePoint),g.normal)).toBeGreaterThan(EVA_HEIGHT-0.002);
      expect(eva.state.destroyed).toBe(false);
    }
    const endFixed = w.universe.ephem.toBodyFixed('moon',w.relativeState(eva).position,w.ut);
    expect(length(sub(endFixed,startFixed))).toBeGreaterThan(30);
    expect(eva.state.situation).toBe('landed');
    w.tick(0.02,neutralInput({evaJump:true}));
    expect(eva.state.situation).toBe('flying');
    for(let i=0;i<300;i++) w.tick(0.02,neutralInput());
    expect(eva.state.situation).toBe('landed');
  });

  it('boards a free seat, removes EVA, and refills the suit on the next sortie', () => {
    const { w, ship } = orbit();
    const id = w.crewFor()[0].id;
    const eva = w.goEva()!;
    eva.state.parts[0].resources.monopropellant = 1;
    recomputeMassProperties(eva.state,false);
    expect(w.boardEva()).toBe(true);
    expect(w.vessels.has(eva.state.id)).toBe(false);
    expect(w.active).toBe(ship);
    expect(crewIds(ship.state)).toEqual([id]);
    expect(w.canControl()).toBe(true);
    expect(w.goEva()!.state.parts[0].resources.monopropellant).toBe(5);
  });

  it('blocks staging and thrust from an empty pod', () => {
    const { w, ship } = orbit();
    w.goEva(); w.switchTo(ship.state.id);
    const stage = ship.state.nextStage;
    w.stageActive();
    w.tick(0.02,neutralInput({stage:true,throttle:1,pitch:1}));
    expect(ship.state.nextStage).toBe(stage);
    expect(ship.state.telemetry.thrust).toBe(0);
  });

  it('keeps pod assignments through docking UID remapping and undocking', () => {
    const { w } = orbit();
    const craft = buildTender();
    craft.parts[0].partId = 'pod-harbor-3';
    const a = buildVessel(craft, PART_CATALOG, { id: 'a' });
    const b = buildVessel(craft, PART_CATALOG, { id: 'b' });
    w.assignCrew(a); w.assignCrew(b);
    const idsA = crewIds(a), idsB = crewIds(b);
    expect(idsA).toHaveLength(3);
    mergeVessels(a, b, freePorts(a)[0].part.uid, freePorts(b)[0].part.uid);
    expect(crewIds(a).sort()).toEqual([...idsA,...idsB].sort());
    const split = undock(a, dockedPorts(a)[0].uid)!;
    expect(crewIds(a)).toEqual(idsA);
    expect(crewIds(split)).toEqual(idsB);
  });

  it('rejects boarding at high speed or out of hatch range', () => {
    const { w, ship } = orbit();
    const eva = w.goEva()!;
    eva.state.velocity = add(ship.state.velocity,v3(4,0,0));
    expect(w.boardEva()).toBe(false);
    eva.state.velocity = { ...ship.state.velocity };
    eva.state.position = add(eva.state.position,v3(10,0,0));
    expect(w.boardEva()).toBe(false);
    expect(w.vessels.has(eva.state.id)).toBe(true);
  });

  it('latches hops across render frames with no physics step', () => {
    const { w, eva } = lunarSurface();
    w.tick(0.005,neutralInput({evaJump:true}));
    w.tick(0.015,neutralInput());
    expect(eva.state.situation).toBe('flying');
  });

  it('round-trips roster, empty seats, EVA fuel, and body-fixed flags; supports legacy saves', () => {
    const { w, ship, eva } = lunarSurface();
    const flag = w.plantFlag()!;
    expect(flag.body).toBe('moon');
    expect(w.messages.some(m => m.text.includes('Humanity'))).toBe(true);
    eva.state.parts[0].resources.monopropellant = 2.5;
    recomputeMassProperties(eva.state,false);
    const data = serializeWorld(w);
    const restored = deserializeWorld(JSON.parse(JSON.stringify(data)), PART_CATALOG);
    expect(restored.crew).toEqual(w.crew);
    expect(restored.flags).toEqual(w.flags);
    expect(restored.active!.state.eva).toEqual(eva.state.eva);
    expect(restored.active!.state.parts[0].resources.monopropellant).toBe(2.5);
    expect(restored.vessels.get(ship.state.id)!.state.parts[0].crew).toEqual([]);
    restored.tick(0.02,neutralInput());
    expect(restored.active!.state.destroyed).toBe(false);
    const legacy = serializeWorld(orbit().w);
    delete legacy.crew; delete legacy.crewSeed; delete legacy.flags;
    for(const v of legacy.vessels) for(const p of v.state.parts) delete p.crew;
    expect(deserializeWorld(legacy,PART_CATALOG).crewFor()).toHaveLength(1);
  });
});
