import type { Body } from '../bodies/types';
import type { Ephemeris } from './ephemeris';
import type { ManeuverNode, StateVector, TrajectoryPatch } from './api';
import { adaptiveStep } from './adaptive';
import { createGravityModel } from './nbody';
import { maneuverToInertialDv, validAnchor } from './maneuver';
import { propagate, stateToElements } from './kepler';
import { findDominantBody } from './soi';
import { add, dot, length, scale, sub } from '../../util/vec3';

export interface TrajectorySample extends StateVector { time: number }
/** Cubic Hermite interpolation between accepted integration samples, never a conic approximation. */
export function patchState(patch: TrajectoryPatch, time: number): StateVector {
  const samples = patch.samples;
  if (!samples?.length) return propagate(patch.orbit,time);
  let lo = 0, hi = samples.length-1;
  if (time <= samples[lo].time) return samples[lo];
  if (time >= samples[hi].time) return samples[hi];
  while (hi-lo>1) { const mid = (lo+hi)>>1; if (samples[mid].time<time) lo=mid; else hi=mid; }
  const a = samples[lo], b = samples[hi], h = b.time-a.time, x = (time-a.time)/h;
  const position = add(add(scale(a.position,2*x**3-3*x*x+1),scale(b.position,-2*x**3+3*x*x)),
    add(scale(a.velocity,h*(x**3-2*x*x+x)),scale(b.velocity,h*(x**3-x*x))));
  const velocity = add(add(scale(a.position,(6*x*x-6*x)/h),scale(b.position,(-6*x*x+6*x)/h)),
    add(scale(a.velocity,3*x*x-4*x+1),scale(b.velocity,3*x*x-2*x)));
  return {position,velocity};
}
export interface NumericalEncounter { body: string; frame: string; time: number; distance: number; position: StateVector['position'] }

/** Incremental map prediction: callers budget work; unfinished/truncated paths stay explicitly partial. */
export class NumericalPrediction {
  readonly patches: TrajectoryPatch[] = [];
  readonly encounters: NumericalEncounter[] = [];
  complete = false;
  truncated = false;
  attempts = 0;
  private h = 30;
  private nodeIndex = 0;
  private readonly nodes: ManeuverNode[];
  private readonly model: ReturnType<typeof createGravityModel>;
  constructor(private readonly bodies: Map<string,Body>, private readonly ephem: Ephemeris,
    private frame: string, private state: StateVector, public time: number, readonly target: number, nodes: ManeuverNode[] = [],
    private readonly surfaceAltitude: (body: Body) => number = b => b.atmosphere?.height ?? 0) {
    this.nodes = nodes.filter(n=>(n.time>=time || validAnchor(n, frame)) && n.time<=target).sort((a,b)=>a.time-b.time || a.id-b.id);
    this.model = createGravityModel(bodies,ephem);
    this.newPatch();
  }
  private newPatch() {
    this.patches.push({orbit: stateToElements(this.bodies.get(this.frame)!.gm,this.frame,this.state.position,this.state.velocity,this.time),
      startTime: this.time,endTime: this.time,endReason: 'horizon',samples: [{...this.state,time:this.time}]});
  }
  advance(maxAttempts = 128, shouldYield: () => boolean = () => false) {
    for (let i=0; i<maxAttempts && !this.complete && !this.truncated; i++) {
      if (++this.attempts>12000 || this.patches.length>64) { this.truncated=true; break; }
      let patch = this.patches[this.patches.length-1];
      while (this.nodes[this.nodeIndex]?.time<=this.time) {
        const node = this.nodes[this.nodeIndex];
        patch.endReason='maneuver';
        const anchor = validAnchor(node, this.frame);
        if (anchor) {
          if (node.time < this.time) delete patch.samples; // live conic alongside the frozen numerical plan
          this.state = { position: anchor.position, velocity: anchor.velocity };
          this.time = node.time;
        } else this.state={position:this.state.position,velocity:add(this.state.velocity,maneuverToInertialDv(this.state,node))};
        this.nodeIndex++; this.newPatch(); patch=this.patches[this.patches.length-1];
      }
      if (this.time>=this.target) { this.complete=true; break; }
      const nextNode = this.nodes[this.nodeIndex];
      let h = Math.min(this.h,this.target-this.time,(nextNode?.time ?? Infinity)-this.time,this.model.stepLimit(this.frame,this.state,this.time));
      const body = this.bodies.get(this.frame)!, gap = length(this.state.position)-body.radius-this.surfaceAltitude(body);
      if (gap < 100) { patch.endReason=body.atmosphere ? 'atmosphere' : 'impact'; this.complete=true; break; }
      h = Math.min(h,.5*gap/Math.max(length(this.state.velocity),1));
      const before = {...this.state,time:this.time};
      const result = adaptiveStep(this.state,this.time,h,(p,t)=>this.model.acceleration(this.frame,p,t));
      this.h=result.nextStep;
      if (!result.accepted) continue;
      this.state=result.state; this.time+=h;
      patch.samples!.push({...this.state,time:this.time}); patch.endTime=this.time;
      this.detectMinima(patch,before);
      const absolute = add(this.ephem.getBodyState(this.frame,this.time).position,this.state.position);
      const next = findDominantBody(this.ephem,this.bodies,absolute,this.time);
      if (next !== this.frame) {
        const old = this.ephem.getBodyState(this.frame,this.time), ref=this.ephem.getBodyState(next,this.time);
        this.state={position:sub(absolute,ref.position),velocity:sub(add(old.velocity,this.state.velocity),ref.velocity)};
        patch.endReason=this.bodies.get(this.frame)!.parent===next ? 'soiExit':'soiEnter'; patch.nextBody=next;
        this.frame=next; this.newPatch();
      }
      if (shouldYield()) break;
    }
    if (this.time>=this.target) this.complete=true;
    return this.patches;
  }
  private detectMinima(patch: TrajectoryPatch, before: TrajectorySample) {
    const relative = (id: string, s: StateVector, t: number) => {
      const states=this.model.states(t), ref=states.get(this.frame)!, b=states.get(id)!;
      return {position:sub(add(ref.position,s.position),b.position),velocity:sub(add(ref.velocity,s.velocity),b.velocity)};
    };
    for (const b of this.bodies.values()) {
      const last=relative(b.id,before,before.time), now=relative(b.id,this.state,this.time);
      if (Math.min(length(last.position),length(now.position))>3*b.soi || dot(last.position,last.velocity)>=0 || dot(now.position,now.velocity)<0) continue;
      let lo=before.time,hi=this.time;
      for (let i=0;i<24;i++) { const mid=(lo+hi)/2,s=relative(b.id,patchState(patch,mid),mid); if (dot(s.position,s.velocity)>0) hi=mid; else lo=mid; }
      const time=(lo+hi)/2,s=patchState(patch,time);
      this.encounters.push({body:b.id,frame:this.frame,time,distance:length(relative(b.id,s,time).position),position:s.position});
    }
  }
}
