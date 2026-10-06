import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gravityOffTrace } from './helpers/nbodyTrace';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { PART_CATALOG } from '../src/data/parts';
import { vesselDeltas, applyDeltas, replaceWorld } from '../src/net/snapshots';
import { buildOrbiter } from '../src/editor/stockCrafts';
import type { Body } from '../src/sim/bodies/types';
import { createEphemeris } from '../src/sim/orbit/ephemeris';
import { createGravityModel, integrateState } from '../src/sim/orbit/nbody';
import { integrateAdaptive } from '../src/sim/orbit/adaptive';
import { lagrangePoints, LAGRANGE_PAIRS } from '../src/sim/orbit/lagrange';
import { NumericalPrediction, patchState } from '../src/sim/orbit/numericalPrediction';
import { add, addScaled, cross, dot, length, scale, sub, v3 } from '../src/util/vec3';
import { neutralInput } from '../src/sim/vessel';
import type { StateVector } from '../src/sim/orbit/api';

function circularPair() {
  const u = new Universe('standard'), earth = {...u.body('earth'), parent:undefined,orbit:undefined,children:['moon']};
  const moon = {...u.body('moon'),orbit:{...u.body('moon').orbit!,e:0,i:0,lan:0,argPe:0,meanAnomalyAtEpoch:0,epoch:0}};
  const bodies = new Map<string, Body>([['earth',earth],['moon',moon]]), ephem=createEphemeris(bodies), model=createGravityModel(bodies,ephem);
  const radius=moon.orbit.a,n=Math.sqrt((earth.gm+moon.gm)/radius**3), period=2*Math.PI/n;
  const points=(t:number)=>lagrangePoints(earth.gm,moon.gm,ephem.getBodyState('earth',t),ephem.getBodyState('moon',t));
  function jacobi(s:StateVector,t:number) {
    const m=ephem.getBodyState('moon',t), mu=moon.gm/(earth.gm+moon.gm);
    const bary=sub(s.position,scale(m.position,mu)), rotating=sub(s.velocity,cross(v3(0,0,n),s.position));
    return (n*n*(bary.x*bary.x+bary.y*bary.y)+2*earth.gm/length(s.position)+2*moon.gm/length(sub(s.position,m.position))-dot(rotating,rotating))/(n*radius)**2;
  }
  return {earth,moon,bodies,ephem,model,radius,n,period,points,jacobi};
}
function worldOrbit(radius=4e6) {
  const u=new Universe('standard'),world=new World(u,PART_CATALOG,0),v=world.launch(buildOrbiter()),b=u.ephem.getBodyState('earth',0);
  v.mode='physics';v.fixed=undefined;v.state.situation='flying';
  v.state.position=add(b.position,v3(radius,0,0));v.state.velocity=add(b.velocity,v3(0,Math.sqrt(u.body('earth').gm/radius),0));
  return {world,v,u};
}
describe('precise gravity',()=>{
  it('keeps the OFF physics/rails/unpack trace bit for bit',()=>{
    // Golden trace of the patched-conic (OFF) mode. Originally generated before precise gravity existed;
    // regenerated once when physics moved to the dominant body's translating frame (DECISIONS, op/moonxfer).
    expect(createHash('sha256').update(JSON.stringify(gravityOffTrace())).digest('hex')).toBe('81ba66e65bba9ecf631aa04074efeacddb6f6c035d402694dd7ab70f4a5ea855');
  });
  it('keeps each save isolated, defaults old saves off, and preserves numerical rails state',()=>{
    const {world,v}=worldOrbit();world.setPreciseGravity(true);world.showLagrangePoints=true;
    world.advanceRailsTo(100);
    const saved=serializeWorld(world),loaded=deserializeWorld(saved,PART_CATALOG);
    expect(loaded.preciseGravity).toBe(true);expect(loaded.showLagrangePoints).toBe(true);
    expect(loaded.active!.state.position).toEqual(v.state.position);
    const old={...saved};delete old.preciseGravity;delete old.showLagrangePoints;
    expect(deserializeWorld(old,PART_CATALOG).preciseGravity).toBe(false);
    loaded.setPreciseGravity(false);expect(world.preciseGravity).toBe(true);
    expect(serializeWorld(loaded).preciseGravity).toBeUndefined();
  });
  it('replicates numerical rails states instead of reconstructing them from conics',()=>{
    const {world,v}=worldOrbit();world.setPreciseGravity(true);world.advanceRailsTo(30);
    const copy=deserializeWorld(serializeWorld(world),PART_CATALOG);
    world.advanceRailsTo(world.ut+100);
    applyDeltas(copy,world.ut,JSON.parse(JSON.stringify(vesselDeltas(world))));
    expect(copy.active!.state.position).toEqual(v.state.position);
    expect(copy.active!.state.velocity).toEqual(v.state.velocity);
    const old=worldOrbit().world;replaceWorld(old,serializeWorld(world));expect(old.preciseGravity).toBe(true);
  });
  it('agrees between fixed-step physics and adaptive numerical coasting',()=>{
    const {world,v,u}=worldOrbit();world.setPreciseGravity(true);
    const state=world.relativeState(v),end=1;
    const expected=integrateAdaptive(state,0,end,(p,t)=>u.gravityModel.acceleration('earth',p,t));
    for(let i=0;i<50;i++) world.tick(.02,neutralInput());
    expect(length(sub(world.relativeState(v).position,expected.state.position))).toBeLessThan(.05);
    expect(length(sub(world.relativeState(v).velocity,expected.state.velocity))).toBeLessThan(.01);
  });
  it('retains a completed map path while its replacement computes',()=>{
    const {world}=worldOrbit();world.setPreciseGravity(true);
    let path=world.mapTrajectory();
    for(let i=0;i<1000 && !world.numericalPrediction?.complete;i++) path=world.mapTrajectory();
    expect(world.numericalPrediction?.complete).toBe(true);
    world.advanceRailsTo(world.ut+3);
    const replacement=world.mapTrajectory();
    if (!world.numericalPrediction?.complete) expect(replacement).toBe(path);
    for(let i=0;i<1000 && !world.numericalPrediction?.complete;i++) {
      world.ut+=.1; // Slow frames must not repeatedly reset an unfinished coast prediction.
      world.mapTrajectory();
    }
    expect(world.numericalPrediction?.complete).toBe(true);
  });
  it('applies merged radiation hazards during accepted numerical rails steps',()=>{
    const {world,v}=worldOrbit(637100*1.6);world.setPreciseGravity(true);
    world.advanceRailsTo(30);
    expect(world.ut).toBeGreaterThan(0);
    expect(v.state.parts.some(p=>(p.radiationDose ?? 0)>0)).toBe(true);
    expect(world.crew.some(c=>(c.radiationDose ?? 0)>0)).toBe(true);
  });
  it('uses sibling as well as parent gravity, with indirect acceleration in the integration frame',()=>{
    const {model,earth,moon,ephem}=circularPair(),p=v3(2e7,4e6,0),m=ephem.getBodyState('moon',0).position;
    const expected=add(scale(p,-earth.gm/length(p)**3),sub(scale(sub(m,p),moon.gm/length(sub(m,p))**3),scale(m,moon.gm/length(m)**3)));
    expect(length(sub(model.acceleration('earth',p,0),expected))).toBeLessThan(1e-16);
    const u=new Universe('standard'),b=u.ephem.getBodyState('earth',0),absolute=add(b.position,p);
    const a=u.createEnvironment(()=> 'earth',true);
    expect(a.integrateRelative).toBe(true);
    expect(a.gravity(absolute,0)).toEqual(u.gravityModel.acceleration('earth',sub(absolute,b.position),0));
  });
  it.each([4,5])('keeps Earth–Moon L%d nearby for 50 periods and conserves the CR3BP Jacobi constant',pointNumber=>{
    const index=pointNumber-1;
    const c=circularPair(),point=c.points(0)[index];
    let state={position:add(point.position,v3(c.radius*1e-5,0,c.radius*1e-5)),velocity:point.velocity};
    const initial=c.jacobi(state,0);let t=0,maxDistance=0,maxJacobi=0;
    for(let i=0;i<200;i++) {
      const end=(i+1)*c.period/4;
      const r=integrateAdaptive(state,t,end,(p,t)=>c.model.acceleration('earth',p,t),{stepLimit:(s,t)=>c.model.stepLimit('earth',s,t)});
      expect(r.complete).toBe(true);state=r.state;t=r.time;
      maxDistance=Math.max(maxDistance,length(sub(state.position,c.points(t)[index].position))/c.radius);
      maxJacobi=Math.max(maxJacobi,Math.abs(c.jacobi(state,t)-initial));
    }
    expect(maxDistance).toBeLessThan(.003);expect(maxJacobi).toBeLessThan(2e-8);
  });
  it('lets an L1 halo-ish out-of-plane placement drift without station keeping',()=>{
    const c=circularPair(),point=c.points(0)[0],state={position:add(point.position,v3(100,0,c.radius*.001)),velocity:point.velocity};
    let current=state,t=0,maxDistance=0;
    for(let i=0;i<40;i++) {
      const r=integrateAdaptive(current,t,(i+1)*c.period/20,(p,t)=>c.model.acceleration('earth',p,t),{stepLimit:(s,t)=>c.model.stepLimit('earth',s,t)});
      expect(r.complete).toBe(true);current=r.state;t=r.time;
      maxDistance=Math.max(maxDistance,length(sub(current.position,c.points(t)[0].position))/c.radius);
    }
    expect(maxDistance).toBeGreaterThan(.05);
  });
  it('conserves two-body energy with adaptive RK45 over 100 periods',()=>{
    const mu=3.986004418e12,r=1e6,v=Math.sqrt(mu/r),period=2*Math.PI*r/v,s={position:v3(r,0,0),velocity:v3(0,v,0)};
    const result=integrateAdaptive(s,0,100*period,p=>scale(p,-mu/length(p)**3));
    const energy=(s:StateVector)=>dot(s.velocity,s.velocity)/2-mu/length(s.position);
    expect(result.complete).toBe(true);expect(Math.abs((energy(result.state)-energy(s))/energy(s))).toBeLessThan(1e-7);
  });
  it('matches an independent fixed-step RK4 Moon-perturbed high-Earth reference',()=>{
    const c=circularPair(),s={position:v3(c.radius*.7,0,0),velocity:v3(0,Math.sqrt(c.earth.gm/(c.radius*.7)),0)};
    // Independent analytic circular Moon coordinates and explicit direct/indirect force sum.
    const force=(p:ReturnType<typeof v3>,t:number)=>{
      const moon=v3(c.radius*Math.cos(c.n*t),c.radius*Math.sin(c.n*t),0),d=sub(moon,p);
      return add(scale(p,-c.earth.gm/length(p)**3),add(scale(d,c.moon.gm/length(d)**3),scale(moon,-c.moon.gm/c.radius**3)));
    };
    let reference=s;
    const duration=c.period*.1,dt=duration/10000;
    for(let i=0;i<10000;i++) reference=integrateState(reference,i*dt,dt,force);
    const result=integrateAdaptive(s,0,duration,(p,t)=>c.model.acceleration('earth',p,t));
    expect(result.complete).toBe(true);expect(length(sub(result.state.position,reference.position))).toBeLessThan(.05);
    expect(length(sub(result.state.velocity,reference.velocity))).toBeLessThan(1e-6);
  });
  it.each([4,5])('keeps the full-catalog standard-scale L%d placement near the moving marker for ten lunar periods',pointNumber=>{
    const index=pointNumber-1;
    const u=new Universe('standard'),m=u.gravityModel,r=u.body('moon').orbit!.a;
    const period=2*Math.PI*Math.sqrt(r**3/(u.body('earth').gm+u.body('moon').gm));
    const point=(t:number)=>lagrangePoints(u.body('earth').gm,u.body('moon').gm,u.ephem.getBodyState('earth',t),u.ephem.getBodyState('moon',t))[index];
    const initial=point(0),earth=u.ephem.getBodyState('earth',0);
    let state={position:sub(initial.position,earth.position),velocity:sub(initial.velocity,earth.velocity)},time=0,maxDistance=0;
    for(let i=0;i<40;i++) {
      const result=integrateAdaptive(state,time,(i+1)*period/4,(p,t)=>m.acceleration('earth',p,t),{stepLimit:(s,t)=>m.stepLimit('earth',s,t)});
      expect(result.complete).toBe(true);state=result.state;time=result.time;
      const reference=sub(point(time).position,u.ephem.getBodyState('earth',time).position);
      maxDistance=Math.max(maxDistance,length(sub(state.position,reference))/r);
    }
    // Solar tides and lunar eccentricity cause libration; the marker is not an exact equilibrium.
    expect(maxDistance).toBeLessThan(.3);
  });
  it('computes all five finite moving markers for every requested pair',()=>{
    const u=new Universe('standard');
    for(const [a,b] of LAGRANGE_PAIRS) {
      const primary=u.ephem.getBodyState(a,100),secondary=u.ephem.getBodyState(b,100);
      const points=lagrangePoints(u.body(a).gm,u.body(b).gm,primary,secondary),r=length(sub(primary.position,secondary.position));
      expect(points).toHaveLength(5);
      expect(length(sub(points[3].position,primary.position))/r).toBeCloseTo(1,9);
      expect(length(sub(points[4].position,secondary.position))/r).toBeCloseTo(1,9);
      expect(points.every(p=>Number.isFinite(length(p.velocity)))).toBe(true);
    }
  });
  it('applies map nodes impulsively and detects a distance minimum',()=>{
    const c=circularPair(),m=c.ephem.getBodyState('moon',0);
    const s={position:add(m.position,v3(-c.moon.soi*2,c.moon.soi*1.5,0)),velocity:add(m.velocity,v3(500,0,0))};
    const node={id:1,time:100,prograde:12,normal:3,radial:0};
    const prediction=new NumericalPrediction(c.bodies,c.ephem,'earth',s,0,100000,[node]);
    prediction.advance(12000);
    expect(prediction.complete).toBe(true);
    const before=prediction.patches.find(p=>p.endReason==='maneuver')!,after=prediction.patches[prediction.patches.indexOf(before)+1];
    expect(before.endTime).toBe(100);
    expect(length(sub(patchState(after,100).velocity,patchState(before,100).velocity))).toBeCloseTo(Math.hypot(12,3),7);
    expect(prediction.encounters.some(e=>e.body==='moon' && e.time>0 && e.time<100000)).toBe(true);
  });
  it('runs 1e6× requests with bounded work, coherent fleet clocks, and finite states',()=>{
    const {world,v}=worldOrbit();world.setPreciseGravity(true);
    const other=world.spawnVessel(buildOrbiter(),{position:add(v.state.position,v3(500,0,0)),velocity:v.state.velocity,orientation:v.state.orientation});
    const started=performance.now();
    for(let i=0;i<20;i++) {world.warp={mode:'rails',index:8};world.tick(1/60,neutralInput());}
    expect(performance.now()-started).toBeLessThan(2000);
    expect(world.ut).toBeGreaterThan(1000);expect(world.ut).toBeLessThanOrEqual(20e6/60);
    expect(v.precise!.time).toBe(world.ut);expect(other.precise!.time).toBe(world.ut);
    expect(Number.isFinite(length(v.state.position))).toBe(true);
    const saved=serializeWorld(world);const copy=deserializeWorld(saved,PART_CATALOG);
    copy.advanceRailsTo(copy.ut+1);expect(Number.isFinite(length(copy.active!.state.position))).toBe(true);
  });
  it('stops numerical warp before terrain during a fast lunar encounter',()=>{
    const {world,v,u}=worldOrbit(),moon=u.ephem.getBodyState('moon',0),r=u.body('moon').radius+u.terrain('moon').maxHeight+3000;
    v.body='moon';v.state.position=add(moon.position,v3(r,0,0));v.state.velocity=addScaled(moon.velocity,v3(-1,0,0),400);
    world.setPreciseGravity(true);
    for(let i=0;i<100 && (world.warp.index!==0 || i===0);i++) {world.warp={mode:'rails',index:8};world.tick(.25,neutralInput());}
    expect(world.warp.index).toBe(0);
    expect(length(world.relativeState(v).position)-u.body('moon').radius).toBeGreaterThan(u.terrain('moon').maxHeight);
  });
});
