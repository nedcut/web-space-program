import { advancePackedHazards } from './hazards';
import { patchState } from '../../sim/orbit/numericalPrediction';
import { adaptiveStep, integrateAdaptive } from '../../sim/orbit/adaptive';
import { stateToElements } from '../../sim/orbit';
import { advanceISRU, isruMachinery } from '../../sim/vessel/isru';
import { add, length, sub } from '../../util/vec3';
import { advanceTransmissions, evaluateProgression } from '../science';
import type { World, WorldVessel } from '../world';
import type { WorldInternals } from './internals';

export function preciseState(world: World, vessel: WorldVessel) {
  return vessel.precise ??= { state: world.relativeState(vessel), time: world.ut, frame: vessel.body };
}
function commit(world: World, vessel: WorldVessel) {
  const p = vessel.precise!, u = world.universe, reference = u.ephem.getBodyState(p.frame,p.time);
  vessel.state.position = add(reference.position,p.state.position);
  vessel.state.velocity = add(reference.velocity,p.state.velocity);
  const body = u.dominantBody(vessel.state.position,p.time);
  if (body !== vessel.body) { vessel.body=body; world.onEnteredSoi(vessel); }
  if (body !== p.frame) {
    const next = u.ephem.getBodyState(body,p.time);
    p.state = { position: sub(vessel.state.position,next.position), velocity: sub(vessel.state.velocity,next.velocity) };
    p.frame = body;
  }
  vessel.orbit = stateToElements(u.body(body).gm,body,p.state.position,p.state.velocity,p.time);
}

/** Short background propagation while the active craft runs fixed-step physics. */
export function syncPrecise(world: World, vessel: WorldVessel, target: number) {
  const p = preciseState(world,vessel), model = world.universe.gravityModel;
  if (target <= p.time) return;
  const result = integrateAdaptive(p.state,p.time,target,(pos,t) => model.acceleration(p.frame,pos,t), {
    stepLimit: (s,t) => model.stepLimit(p.frame,s,t), maxSteps: 512,
  });
  if (!result.complete) throw new Error('Background precise propagation exceeded its step budget');
  p.state=result.state; p.time=result.time; commit(world,vessel);
}

/** Fleet-wide accepted steps keep every craft at the same UT. Work is bounded, never skipped.
 * Wall time only yields between committed steps; it never affects force/error calculations.
 */
export function advancePrecise(world: World, internals: WorldInternals, target: number) {
  const start = world.ut, deadline = performance.now()+8, model = world.universe.gravityModel;
  let h = world.preciseStep, attempts = 0, stopped = false;
  while (world.ut < target && attempts++ < 96) {
    const flying = [...world.vessels.values()].filter(v => v.mode === 'rails');
    h = Math.min(h,target-world.ut);
    for (const v of flying) {
      const p = preciseState(world,v);
      h = Math.min(h,model.stepLimit(p.frame,p.state,world.ut));
      // Conservative entry guard around every nearby solid/atmospheric body, not only the current SOI.
      for (const body of world.universe.bodies.values()) {
        const bs = model.states(world.ut).get(body.id)!;
        const distance = length(sub(v.state.position,bs.position));
        if (distance > body.radius*3+(body.atmosphere?.height ?? 0)) continue;
        const surface = body.radius+Math.max(body.atmosphere?.height ?? 0,body.solidSurface ? world.universe.terrain(body.id).maxHeight : 0);
        const gap = distance-surface;
        if (gap < 100) {
          if (v === world.active) {
            world.warp = { mode: 'rails', index: 0 }; stopped = true;
            world.message('Time warp stopped: precise trajectory approaching atmosphere or surface','warn');
          } else { world.finishFlight(v,'lost'); world.vessels.delete(v.state.id); }
          break;
        }
        h = Math.min(h,.5*gap/Math.max(1,length(sub(v.state.velocity,bs.velocity))));
      }
    }
    if (stopped) break;
    const trials = flying.filter(v => world.vessels.has(v.state.id)).map(v => {
      const p = preciseState(world,v);
      return { v, result: adaptiveStep(p.state,world.ut,h,(pos,t) => model.acceleration(p.frame,pos,t)) };
    });
    const next = Math.min(...trials.map(x => x.result.nextStep),h*5);
    if (trials.every(x => x.result.accepted)) {
      world.ut += h;
      for (const {v,result} of trials) {
        const p=v.precise!, frame=p.frame;
        const segment={orbit:v.orbit!,startTime:p.time,endTime:world.ut,endReason:'horizon' as const,
          samples:[{...p.state,time:p.time},{...result.state,time:world.ut}]};
        advancePackedHazards(world,internals,v,p.time,world.ut,t=>{
          const local=patchState(segment,t),ref=world.universe.ephem.getBodyState(frame,t);
          return {position:add(ref.position,local.position),velocity:add(ref.velocity,local.velocity)};
        });
        if (!world.vessels.has(v.state.id)) continue;
        p.state=result.state; p.time=world.ut; commit(world,v);
      }
      // Hazard fragments join the next accepted fleet step instead of remaining at an old UT.
      for (const v of world.vessels.values()) if (v.mode==='physics') internals.pack(v);
    }
    h = next;
    if (performance.now() >= deadline) break;
  }
  world.preciseStep=h;
  if (!stopped && world.ut < target && world.warp.index > 1) {
    world.warp = { mode: 'rails', index: world.warp.index-1 };
    world.message('Precise gravity: reduced time warp to keep integration within the frame budget','info');
  }
  for (const v of world.vessels.values()) {
    if (v.mode === 'landedRails' || v.mode === 'prelaunch') {
      advanceISRU(v.state,isruMachinery(v.state).length ? world.localConcentration(v) : 0,world.ut-start);
      advancePackedHazards(world,internals,v,start,world.ut);
      if (world.vessels.has(v.state.id)) internals.syncFixed(v,world.ut);
    }
    world.recordFlight(v);
  }
  advanceTransmissions(world); evaluateProgression(world);
  world.onSimulationStep?.(world.ut-start,0);
}
