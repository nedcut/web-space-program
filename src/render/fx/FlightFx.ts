import * as THREE from 'three';
import type { VesselEvent, VesselState } from '../../sim/vessel/runtime';
import type { Vec3 } from '../../util/vec3';
import type { QualityId } from '../core/quality';
import { ParticlePool } from './ParticlePool';

type BurstEvent = Extract<VesselEvent, { type: 'partDestroyed' | 'decouple' | 'structuralFailure' }>;
export function isBurstEvent(event: VesselEvent): event is BurstEvent {
  return event.type === 'partDestroyed' || event.type === 'decouple' || event.type === 'structuralFailure';
}

export const FX_BUDGET = { low: { count: 128, rate: 12 }, medium: { count: 512, rate: 40 }, high: { count: 1024, rate: 80 } } as const;
const smoke = new THREE.Color(.38,.36,.32), steam = new THREE.Color(.8,.82,.85), fire = new THREE.Color(8,2,.15);
const spark = new THREE.Color(10,4,.6), dust = new THREE.Color();
/** One bounded pool for the active flight. Simulation events remain authoritative. */
export class FlightFx {
  readonly root = new THREE.Group();
  pool: ParticlePool;
  private readonly light = new THREE.PointLight(0xffa040,0,80,2);
  /** The burst flash light. Its visibility changes the scene's light count (and so every shader key). */
  get flashLight(): THREE.PointLight { return this.light; }
  private readonly point = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly surfaceVelocity = new THREE.Vector3();
  private readonly nozzle = new THREE.Vector3();
  private readonly engineRotation = new THREE.Quaternion();
  private readonly tangent = new THREE.Vector3();
  private readonly bitangent = new THREE.Vector3();
  private readonly exhaust = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly flashVelocity = new THREE.Vector3();
  private readonly flashPosition = new THREE.Vector3();
  private credit = 0;
  private flash = 0;
  private clock = 0;
  private lastUt: number | undefined;
  private readonly lastOrigin = new THREE.Vector3();
  private seed = 193;
  constructor(private quality: QualityId) {
    this.pool = new ParticlePool(FX_BUDGET[quality].count); this.root.add(this.pool.object, this.light);
  }
  private random() { this.seed = (Math.imul(this.seed,1664525)+1013904223)>>>0; return this.seed/4294967296; }
  setQuality(quality: QualityId) {
    if(quality===this.quality) return;
    this.pool.dispose(); this.quality=quality;
    this.pool=new ParticlePool(FX_BUDGET[quality].count); this.root.add(this.pool.object);
  }
  burst(position: Vec3, structural = false, inheritedVelocity?: Vec3) {
    const count = Math.floor(FX_BUDGET[this.quality].rate * (structural ? .3 : 1));
    for(let i=0;i<count;i++) {
      this.velocity.set(this.random()-.5,this.random()-.5,this.random()-.5).multiplyScalar(structural ? 9 : 28);
      if(inheritedVelocity) this.velocity.add(inheritedVelocity);
      this.pool.emit(position,this.velocity,this.clock,i%3===0 ? 5 : 1.6,i%3===0 ? 3 : i%3===1 ? 5 : .3,i%3===0 ? 1.8 : 0,i%3===0 ? smoke : i%3===1 ? fire : spark);
    }
    this.flashPosition.copy(position); this.flashVelocity.set(inheritedVelocity?.x ?? 0,inheritedVelocity?.y ?? 0,inheritedVelocity?.z ?? 0); this.flash = structural ? .15 : 1;
  }
  update(v: VesselState, origin: Vec3, bodyPosition: Vec3, bodyVelocity: Vec3, body: string, altitude: number, density: number, heat: number, airVelocity: Vec3, dt: number, pixelScale: number, simulationTime: number, palette: readonly [number, number, number][]) {
    const elapsed = this.lastUt === undefined ? Math.max(0,dt) : Math.max(0,simulationTime-this.lastUt);
    const teleported = this.lastUt !== undefined && this.lastOrigin.distanceToSquared(origin)>1e12;
    this.lastUt = simulationTime; this.lastOrigin.copy(origin);
    // Rails/teleports must not stretch old trails across interplanetary distances.
    if(elapsed>1 || teleported) { this.pool.clear(); this.flash=0; }
    const step = Math.min(1,elapsed); this.clock += step;
    this.up.copy(v.position).sub(bodyPosition).normalize();
    this.rotation.set(v.orientation.x,v.orientation.y,v.orientation.z,v.orientation.w);
    this.surfaceVelocity.copy(v.velocity).sub(airVelocity);
    // On a stationary surface this includes body rotation as well as orbital translation.
    if (!Number.isFinite(this.surfaceVelocity.x)) this.surfaceVelocity.copy(bodyVelocity);
    this.tangent.set(Math.abs(this.up.y)>.9 ? 1 : 0, Math.abs(this.up.y)>.9 ? 0 : 1,0).cross(this.up).normalize();
    this.bitangent.crossVectors(this.up,this.tangent);
    this.credit = Math.min(3,this.credit+step*FX_BUDGET[this.quality].rate);
    const count = Math.floor(this.credit); this.credit -= count;
    const color = palette[1] ?? palette[0];
    if(body==='earth' || !color) dust.setRGB(.23,.19,.13);
    else dust.setRGB(color[0],color[1],color[2]);
    let emitters = 0;
    let contact = false;
    for (const p of v.parts) {
      if(p.leg?.deployed || (p.wheel && p.wheel.compression>0)) contact = true;
      if(emitters>=8) continue;
      if (!p.engine || p.engine.thrust <= 0) continue;
      let engine;
      for(const module of p.def.modules) if(module.type==='engine') { engine=module; break; }
      if (!engine || engine.type!=='engine') continue;
      emitters++;
      const jet = !!engine.airBreathing, solid = engine.plume==='solid';
      const contrail = jet && altitude>7000 && density>.015;
      if (density<.01 && altitude>40) continue;
      if (!solid && !contrail && altitude>6000) continue;
      this.engineRotation.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);
      this.exhaust.set(0,-1,0).applyQuaternion(this.engineRotation).applyQuaternion(this.rotation);
      const height = p.def.shape.kind==='box' ? p.def.shape.size.y : p.def.shape.height;
      this.nozzle.set(0,-height*.5,0).applyQuaternion(this.engineRotation);
      this.nozzle.x+=p.position.x-v.com.x; this.nozzle.y+=p.position.y-v.com.y; this.nozzle.z+=p.position.z-v.com.z;
      this.nozzle.applyQuaternion(this.rotation).add(v.position);
      for(let i=0;i<count;i++) {
        this.point.copy(this.nozzle);
        this.velocity.copy(this.surfaceVelocity).addScaledVector(this.exhaust,12).addScaledVector(this.up,2);
        this.velocity.x+=(this.random()-.5)*6; this.velocity.z+=(this.random()-.5)*6;
        this.pool.emit(this.point,this.velocity,this.clock,contrail?18:solid?14:8,solid?2:1.3,.65,contrail?steam:smoke);
        if(altitude<40) {
          this.point.copy(v.position).addScaledVector(this.up,-Math.max(1,altitude-1));
          this.velocity.copy(this.surfaceVelocity).addScaledVector(this.up,2);
          this.velocity.addScaledVector(this.tangent,(this.random()-.5)*18).addScaledVector(this.bitangent,(this.random()-.5)*18);
          this.pool.emit(this.point,this.velocity,this.clock,6,4,.8,density>.1?steam:dust);
        }
      }
    }
    if(altitude<6 && contact) {
      for(let i=0;i<count;i++) {
        this.point.copy(v.position).addScaledVector(this.up,-Math.max(0,altitude-1));
        this.velocity.copy(this.surfaceVelocity).addScaledVector(this.up,1);
        this.velocity.addScaledVector(this.tangent,(this.random()-.5)*8).addScaledVector(this.bitangent,(this.random()-.5)*8);
        // Only moving contact produces dust; parked vessels remain quiet.
        if(Math.hypot(airVelocity.x,airVelocity.y,airVelocity.z)>1) this.pool.emit(this.point,this.velocity,this.clock,3,2,.8,dust);
      }
    }
    if(heat>.08) for(let i=0;i<count;i++) {
      this.point.copy(v.position); this.point.x+=(this.random()-.5)*v.cache.boundingRadius; this.point.z+=(this.random()-.5)*v.cache.boundingRadius;
      this.velocity.copy(v.velocity).addScaledVector(airVelocity,-.22);
      this.pool.emit(this.point,this.velocity,this.clock,.25+this.random()*.5,.15+this.random()*.4,0,body==='titan'?fire:spark);
    }
    this.flash *= Math.exp(-step*8);
    this.flashPosition.addScaledVector(this.flashVelocity,step);
    this.light.visible = this.flash>.001;
    if(this.light.visible) this.light.position.copy(this.flashPosition).sub(origin);
    this.light.intensity=this.flash*1500;
    this.pool.update(origin,this.clock,pixelScale);
    this.pool.ground(v.position,this.up,altitude);
  }
  shake(camera: THREE.Camera, reduceMotion: boolean) {
    if(reduceMotion || this.flash<.01) return;
    camera.position.x+=Math.sin(this.clock*91)*this.flash*.15;
    camera.position.y+=Math.sin(this.clock*73)*this.flash*.12;
  }
  dispose() { this.pool.dispose(); this.light.dispose(); this.root.removeFromParent(); }
}
