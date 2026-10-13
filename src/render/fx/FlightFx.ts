import * as THREE from 'three';
import type { VesselEvent, VesselState } from '../../sim/vessel/runtime';
import type { Vec3 } from '../../util/vec3';
import type { QualityId } from '../core/quality';
import { rcsEnabled, rcsMask } from '../../sim/vessel/tweaks';
import { DebrisPool } from './DebrisPool';
import { FairingPanels } from './FairingPanels';
import { TRAIL_OPACITY, trailStyle, type TrailStyle } from './eventDesign';
import { ParticlePool } from './ParticlePool';

type BurstEvent = Extract<VesselEvent, { type: 'partDestroyed' | 'decouple' | 'structuralFailure' }>;
export function isBurstEvent(event: VesselEvent): event is BurstEvent {
  return event.type === 'partDestroyed' || event.type === 'decouple' || event.type === 'structuralFailure';
}

export const FX_BUDGET = { low: { count: 128, rate: 12 }, medium: { count: 512, rate: 40 }, high: { count: 1024, rate: 80 }, ultra: { count: 2048, rate: 120 } } as const;
const smoke = new THREE.Color(.38,.36,.32), steam = new THREE.Color(.8,.82,.85), fire = new THREE.Color(8,2,.15);
const eclipseFree = (sunIntensity: number) => Math.min(1, sunIntensity/3);
/** Column albedo: bright alumina-white solids, a warm grey for hydrocarbons, near-white vapour for clean fuels. */
const solidSmoke = new THREE.Color(.86,.85,.83), fuelSmoke = new THREE.Color(.62,.6,.57), vapour = new THREE.Color(.88,.9,.93), column = new THREE.Color();
const skyDay = new THREE.Color(.3,.38,.52), skySpace = new THREE.Color(.025,.028,.035);
const blue = new THREE.Color(.3,.45,1), warm = new THREE.Color(1,.36,.08);
const spark = new THREE.Color(10,4,.6), dust = new THREE.Color();
/** One bounded pool for the active flight. Simulation events remain authoritative. */
export class FlightFx {
  readonly root = new THREE.Group();
  pool: ParticlePool;
  readonly debris = new DebrisPool();
  readonly fairingPanels = new FairingPanels();
  /**
   * The vessel's single smoke column: a chain of segment particles in the air frame. `node` is the newest node,
   * drifted with the air; `head` is the particle stretched from it to the current nozzle every frame.
   */
  private readonly column = { active: false, head: -1, node: new THREE.Vector3(), time: 0, start: new THREE.Vector3() };
  private readonly columnNozzle = new THREE.Vector3();
  private readonly columnExhaust = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly seed3 = new THREE.Vector3();
  private readonly style: TrailStyle = { life: 0, size: 0, growth: 0, opacity: 0 };
  private readonly sunRadiance = new THREE.Color();
  private readonly sky = new THREE.Color();
  private readonly glow = new THREE.Color();
  private readonly dimGlow = new THREE.Color();
  /**
   * Burst flash. It stays visible at zero intensity between bursts: toggling visibility would change
   * the scene's light count, which is part of every shader key, and recompile all lit materials
   * (a multi-second stall on the first decouple on Windows/ANGLE).
   */
  private readonly light = new THREE.PointLight(0xffa040,0,80,2);
  private readonly point = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly ambientVelocity = new THREE.Vector3();
  private readonly nozzle = new THREE.Vector3();
  private readonly engineRotation = new THREE.Quaternion();
  private readonly tangent = new THREE.Vector3();
  private readonly bitangent = new THREE.Vector3();
  private readonly exhaust = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly flashVelocity = new THREE.Vector3();
  private readonly flashPosition = new THREE.Vector3();
  private readonly gravity = new THREE.Vector3();
  private readonly engineLightPosition = new THREE.Vector3();
  private readonly engineLightColor = new THREE.Color();
  private density = 0;
  private situation: VesselState['situation'] | undefined;
  private lastStep = 0;
  private readonly torque = new THREE.Vector3();
  private credit = 0;
  private flash = 0;
  private clock = 0;
  private lastUt: number | undefined;
  private readonly lastOrigin = new THREE.Vector3();
  private seed = 193;
  constructor(private quality: QualityId) {
    this.pool = new ParticlePool(FX_BUDGET[quality].count); this.root.add(this.pool.object, this.light, this.debris.root, this.fairingPanels.root);
  }
  private random() { this.seed = (Math.imul(this.seed,1664525)+1013904223)>>>0; return this.seed/4294967296; }
  setQuality(quality: QualityId) {
    if(quality===this.quality) return;
    this.pool.dispose(); this.quality=quality;
    this.pool=new ParticlePool(FX_BUDGET[quality].count); this.root.add(this.pool.object);
    this.column.active=false;
  }
  burst(position: Vec3, structural = false, inheritedVelocity?: Vec3, diameter = 9) {
    const count = Math.floor(FX_BUDGET[this.quality].rate * (structural ? .4 : 1));
    for(let i=0;i<count;i++) {
      this.velocity.set(this.random()-.5,this.random()-.5,this.random()-.5).multiplyScalar(structural ? 5 : i%3===2 ? 32 : i%3===1 ? 18 : 9);
      if(inheritedVelocity) this.velocity.add(inheritedVelocity);
      // Separation is a cold gas puff, not a small fuel explosion. No lingering smoke in vacuum.
      const cloud = structural || i%3===0;
      if(cloud && this.density<.01 && !structural) continue;
      this.pool.emit(position,this.velocity,this.clock,structural?.7:cloud?8:i%3===1?1.1:2,
        structural?2:cloud?diameter*.7:i%3===1?diameter:.18,structural?2:cloud?.25:0,structural?steam:cloud?smoke:i%3===1?fire:spark,
        cloud?undefined:this.gravity);
    }
    this.flashPosition.copy(position); this.flashVelocity.set(inheritedVelocity?.x ?? 0,inheritedVelocity?.y ?? 0,inheritedVelocity?.z ?? 0); this.flash = structural ? .15 : 1;
  }
  deployment(position: Vec3, inheritedVelocity: Vec3) {
    for(let i=0;i<Math.min(12,FX_BUDGET[this.quality].rate);i++) {
      this.velocity.copy(inheritedVelocity).addScaledVector(this.up,2)
        .addScaledVector(this.tangent,(this.random()-.5)*3).addScaledVector(this.bitangent,(this.random()-.5)*3);
      this.pool.emit(position,this.velocity,this.clock,.6,.6,1,steam);
    }
  }
  update(v: VesselState, origin: Vec3, bodyPosition: Vec3, bodyVelocity: Vec3, body: string, altitude: number, density: number, heat: number, airVelocity: Vec3, dt: number, pixelScale: number, simulationTime: number, palette: readonly [number, number, number][], gravity = body==='moon'?1.62:9.81) {
    const elapsed = this.lastUt === undefined ? Math.max(0,dt) : Math.max(0,simulationTime-this.lastUt);
    const teleported = this.lastUt !== undefined && this.lastOrigin.distanceToSquared(origin)>1e12;
    this.lastUt = simulationTime; this.lastOrigin.copy(origin);
    // Rails/teleports must not stretch old trails across interplanetary distances.
    if(elapsed>1 || teleported) { this.pool.clear(); this.debris.clear(); this.fairingPanels.clear(); this.column.active=false; this.flash=0; }
    const step = Math.min(1,elapsed); this.lastStep=step; this.clock += step;
    this.density = density;
    this.up.copy(v.position).sub(bodyPosition).normalize();
    this.gravity.copy(this.up).multiplyScalar(-gravity);
    this.rotation.set(v.orientation.x,v.orientation.y,v.orientation.z,v.orientation.w);
    this.ambientVelocity.copy(v.velocity).sub(airVelocity);
    // On a stationary surface this includes body rotation as well as orbital translation.
    if (!Number.isFinite(this.ambientVelocity.x)) this.ambientVelocity.copy(bodyVelocity);
    this.tangent.set(Math.abs(this.up.y)>.9 ? 1 : 0, Math.abs(this.up.y)>.9 ? 0 : 1,0).cross(this.up).normalize();
    this.bitangent.crossVectors(this.up,this.tangent);
    if(!teleported && elapsed<=1 && v.situation==='splashed' && this.situation==='flying') {
      for(let i=0;i<FX_BUDGET[this.quality].rate;i++) {
        const angle=this.random()*Math.PI*2;
        this.velocity.copy(v.velocity).addScaledVector(this.up,3+this.random()*7)
          .addScaledVector(this.tangent,Math.cos(angle)*8).addScaledVector(this.bitangent,Math.sin(angle)*8);
        this.pool.emit(v.position,this.velocity,this.clock,1.3,1,.6,steam,this.gravity);
      }
    }
    this.situation=v.situation;
    this.credit = Math.min(3,this.credit+step*FX_BUDGET[this.quality].rate);
    const count = Math.floor(this.credit); this.credit -= count;
    const color = palette[1] ?? palette[0];
    if(body==='earth' || !color) dust.setRGB(.23,.19,.13);
    else dust.setRGB(color[0],color[1],color[2]);
    let lightWeight = 0;
    this.engineLightPosition.set(0,0,0); this.engineLightColor.setRGB(0,0,0);
    let emitters = 0;
    let contact = false;
    let columnThrust = 0, columnSolid = 0, columnOpacity = 0, columnVapour = 0, columnThrottle = 0;
    this.columnNozzle.set(0,0,0); this.columnExhaust.set(0,0,0);
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
      this.engineRotation.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);
      this.exhaust.set(0,-1,0).applyQuaternion(this.engineRotation).applyQuaternion(this.rotation);
      const height = p.def.shape.kind==='box' ? p.def.shape.size.y : p.def.shape.height;
      this.nozzle.set(0,-height*.5,0).applyQuaternion(this.engineRotation);
      this.nozzle.x+=p.position.x-v.com.x; this.nozzle.y+=p.position.y-v.com.y; this.nozzle.z+=p.position.z-v.com.z;
      this.nozzle.applyQuaternion(this.rotation).add(v.position);
      const throttle = Math.min(1, Math.max(0,p.engine.throttle));
      const lightPower = (engine.plume==='ion'?2:engine.plume==='hydrolox'?45:180) * throttle * Math.min(4,Math.sqrt(p.engine.thrust/100000));
      this.point.copy(this.nozzle).sub(origin).addScaledVector(this.exhaust,1.5);
      this.engineLightPosition.addScaledVector(this.point,lightPower);
      const tint = engine.plume==='hydrolox'||engine.plume==='ion'?blue:warm;
      this.engineLightColor.r+=tint.r*lightPower; this.engineLightColor.g+=tint.g*lightPower; this.engineLightColor.b+=tint.b*lightPower;
      lightWeight+=lightPower;
      const downward = -this.exhaust.dot(this.up);
      const nozzleAltitude = altitude + this.point.copy(this.nozzle).sub(v.position).dot(this.up);
      const reachesGround = downward>.25 && nozzleAltitude<35*downward && nozzleAltitude>-2;
      const strength = throttle * Math.max(0,1-nozzleAltitude/35);
      if (!jet && engine.plume!=='ion' && throttle>0) {
        const weight = p.engine.thrust;
        columnThrust += weight; columnThrottle = Math.max(columnThrottle,throttle);
        if (solid) columnSolid += weight;
        columnOpacity += (TRAIL_OPACITY[engine.plume ?? 'kerolox'] ?? .45) * weight;
        if (engine.plume==='hydrolox') columnVapour += weight;
        // Offsets from the vessel keep the float64 sum precise at solar-system distances.
        this.columnNozzle.x += (this.nozzle.x-v.position.x)*weight; this.columnNozzle.y += (this.nozzle.y-v.position.y)*weight; this.columnNozzle.z += (this.nozzle.z-v.position.z)*weight;
        this.columnExhaust.addScaledVector(this.exhaust,weight);
      }
      for(let i=0;i<count;i++) {
        // Combustion smoke belongs to an atmosphere. Clean fuels condense into pale vapour.
        if(density>.01 && (contrail || altitude<80) && this.random()<throttle) {
          this.point.copy(this.nozzle).addScaledVector(this.exhaust,solid?8:4);
          this.velocity.copy(this.ambientVelocity).addScaledVector(this.exhaust,solid?9:5).addScaledVector(this.up,2);
          this.velocity.addScaledVector(this.tangent,(this.random()-.5)*3).addScaledVector(this.bitangent,(this.random()-.5)*3);
          this.pool.emit(this.point,this.velocity,this.clock,contrail?18:solid?12:6,solid?3:1.8,.7,solid||engine.plume==='hydrolox'||contrail?steam:smoke);
        }
        if(reachesGround && this.random()<strength) {
          const angle=this.random()*Math.PI*2, speed=(density>.01?9:22)*( .4+.6*strength);
          this.point.copy(this.nozzle).addScaledVector(this.exhaust,Math.max(0,nozzleAltitude)/downward).addScaledVector(this.up,.4);
          this.velocity.copy(this.ambientVelocity).addScaledVector(this.up,density>.01?2.5:1.3);
          this.velocity.addScaledVector(this.tangent,Math.cos(angle)*speed).addScaledVector(this.bitangent,Math.sin(angle)*speed);
          this.pool.emit(this.point,this.velocity,this.clock,density>.01?7:1.6,density>.01?3.5:1.2,density>.01?.85:.35,density>.1?steam:dust,density>.01?undefined:this.gravity);
        }
      }
    }
    this.updateColumn(v,columnThrust,columnSolid,columnOpacity,columnVapour,columnThrottle,density,teleported||elapsed>1);
    if(altitude<6 && contact) {
      for(let i=0;i<count;i++) {
        this.point.copy(v.position).addScaledVector(this.up,-Math.max(0,altitude-1));
        this.velocity.copy(this.ambientVelocity).addScaledVector(this.up,1);
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
    this.debris.update(origin,step,this.gravity,v.position,this.up,altitude,this.ambientVelocity);
    this.fairingPanels.update(origin,step,this.gravity,v.position,this.up,altitude,this.ambientVelocity,density);
    this.flash *= Math.exp(-step*8);
    this.flashPosition.addScaledVector(this.flashVelocity,step);
    const lit = this.flash>.001;
    if(lit) this.light.position.copy(this.flashPosition).sub(origin);
    if(lit) { this.light.color.copy(warm); this.light.intensity=this.flash*1500; }
    else {
      if(lightWeight>0) {
        this.light.position.copy(this.engineLightPosition).divideScalar(lightWeight);
        this.light.color.copy(this.engineLightColor).multiplyScalar(1/lightWeight);
      }
      this.light.intensity=Math.min(900,lightWeight);
    }
    // Young smoke beside the flame picks up its colour (most visible at dusk and night).
    if(lightWeight>0) this.glow.copy(this.engineLightColor).multiplyScalar(Math.min(.5,lightWeight/600)/lightWeight);
    else this.glow.setRGB(0,0,0);
    this.pool.update(origin,this.clock,pixelScale);
    this.pool.ground(v.position,this.up,altitude);
  }
  /**
   * Extend the ascent smoke column. Nodes are deposited at a fixed time cadence sized to the trail region, and the
   * head segment is stretched to the nozzle every frame, so the column stays attached and gap-free at any speed.
   */
  private updateColumn(v: VesselState, thrust: number, solid: number, opacity: number, clean: number, throttle: number, density: number, reset: boolean) {
    const c = this.column;
    if (reset) c.active = false;
    if (thrust<=0 || density<=.004) { c.active = false; return; }
    const style = trailStyle(thrust,density,solid/thrust,this.style);
    const alpha = style.opacity*throttle*opacity/thrust;
    if (alpha<=.002) { c.active = false; return; }
    this.columnExhaust.normalize();
    this.point.copy(this.columnNozzle).divideScalar(thrust).add(v.position).addScaledVector(this.columnExhaust,2+style.size*.5);
    // Deposit in the rotating air frame, not with the rocket's ascent velocity.
    this.velocity.copy(this.ambientVelocity).addScaledVector(this.up,.4);
    const interval = Math.max(.2, style.life/(Math.max(8,this.pool.trailCapacity)*.8));
    if (c.active) {
      c.node.addScaledVector(this.velocity,this.lastStep); c.start.addScaledVector(this.velocity,this.lastStep);
      this.offset.copy(this.point).sub(c.node);
      const age = this.clock-c.time, length = this.offset.length();
      this.pool.setSegment(c.head,this.offset,age,alpha);
      if (!((age>=interval && length>=style.size*.5) || age>=style.life*.4 || length>600)) return;
    } else c.start.copy(this.point);
    column.copy(solid/thrust>.3 ? solidSmoke : clean/thrust>.5 ? vapour : fuelSmoke);
    c.head = this.pool.emit(this.point,this.velocity,this.clock,style.life,style.size,style.growth,column,undefined,alpha,true);
    this.pool.setSegment(c.head,this.offset.set(0,0,0),0,alpha,this.seed3.copy(this.point).sub(c.start));
    c.node.copy(this.point); c.time = this.clock; c.active = true;
  }
  /** Sun and sky light for smoke shading; `sun` is the direction towards the sun in scene space. */
  lighting(sun: THREE.Vector3, camera: THREE.Camera, sunColor: THREE.Color, sunIntensity: number, air: number) {
    const elevation = sun.dot(this.up);
    this.sunRadiance.copy(sunColor).multiplyScalar(sunIntensity/Math.PI);
    const day = Math.min(1,Math.max(0,(elevation+.08)/.3));
    // Skylight tracks daylight and air; a low sun reddens it slightly.
    this.sky.copy(skyDay).lerp(sunColor,.25*(1-day)).multiplyScalar(day*Math.min(1,air*1.5)).add(skySpace);
    // Flame light on young smoke only shows against a dim sky.
    this.dimGlow.copy(this.glow).multiplyScalar(1-.75*day*eclipseFree(sunIntensity));
    this.pool.light(sun,camera,this.sunRadiance,this.sky,this.dimGlow);
  }
  /** Render-only nozzle selection mirrors the sim mixer; never consumes propellant. */
  rcs(v: VesselState, enabled: boolean, translation: {tx:number;ty:number;tz:number}) {
    if(!enabled || this.lastStep<=0 || !v.parts.some(p=>(p.resources.monopropellant ?? 0)>0)) return;
    let emitted=0;
    const control=v.telemetry.control;
    for(const p of v.parts) {
      if(!rcsEnabled(p)) continue;
      for(const mod of p.def.modules) {
        if(mod.type!=='rcs') continue;
        const mask=rcsMask(p);
        this.engineRotation.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);
        for(const nz of mod.nozzles) {
          this.nozzle.copy(nz.position).applyQuaternion(this.engineRotation);
          this.nozzle.x+=p.position.x-v.com.x; this.nozzle.y+=p.position.y-v.com.y; this.nozzle.z+=p.position.z-v.com.z;
          this.exhaust.copy(nz.direction).applyQuaternion(this.engineRotation).normalize();
          this.torque.crossVectors(this.nozzle,this.exhaust).negate().normalize();
          const rotation=Math.max(0,this.torque.x*control.pitch*mask.rot[0]+this.torque.y*control.yaw*mask.rot[1]+this.torque.z*control.roll*mask.rot[2]);
          const translate=Math.max(0,-this.exhaust.x*translation.tx*mask.tr[0]-this.exhaust.y*translation.ty*mask.tr[1]-this.exhaust.z*translation.tz*mask.tr[2]);
          const act=Math.min(1,rotation+translate);
          if(this.random()>=this.lastStep*24*act || emitted>=16) continue;
          emitted++;
          this.nozzle.applyQuaternion(this.rotation).add(v.position);
          this.exhaust.applyQuaternion(this.rotation);
          this.velocity.copy(v.velocity).addScaledVector(this.exhaust,5);
          this.pool.emit(this.nozzle,this.velocity,this.clock,.18,.22,3,steam);
        }
      }
    }
  }
  dispose() { this.debris.dispose(); this.fairingPanels.dispose(); this.pool.dispose(); this.light.dispose(); this.root.removeFromParent(); }
}
