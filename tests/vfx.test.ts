import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { thermalTexture } from '../src/render/fx/thermalSurface';
import { blackbody, PartHeat } from '../src/render/fx/PartHeat';
import { ParticlePool } from '../src/render/fx/ParticlePool';
import { FlightFx, FX_BUDGET } from '../src/render/fx/FlightFx';
import { FairingPanels } from '../src/render/fx/FairingPanels';
import { buildPartMesh } from '../src/render/parts';
import { buildVessel } from '../src/sim/vessel';
import { buildMoonLander, buildTender } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import type { PartState } from '../src/sim/vessel/runtime';

function radiance(mesh: THREE.Mesh): number {
  const slot = mesh.geometry.getAttribute('wspHeatSlot').getX(0);
  return thermalTexture.image.data![slot * 4];
}

describe('flight visual effects', () => {
  it('isolates hottest-face emission from shared template materials and other parts', () => {
    const original = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(),original), b = a.clone();
    const heat = new PartHeat(a);
    heat.update({ skinTemperature: [290,290,290,1600,290,290] } as PartState,.1);
    expect(radiance(a)).toBeGreaterThan(1);
    expect(b.material.emissive.r).toBe(0);
    expect(original.emissive.r).toBe(0);
    heat.update({ skinTemperature: [290,290,290,290,290,290] } as PartState,.1);
    expect(radiance(a)).toBe(0);
    heat.dispose(); original.dispose(); a.geometry.dispose();
  });
  it('retains nozzle heat after shutdown and cools over time', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()); mesh.name='bellOuter';
    const original=mesh.material, heat=new PartHeat(mesh);
    const part = {skinTemperature:[290],engine:{thrust:100}} as PartState;
    heat.update(part,10); const peak=radiance(mesh);
    part.engine!.thrust=0; heat.update(part,.1);
    expect(radiance(mesh)).toBeGreaterThan(0);
    expect(radiance(mesh)).toBeLessThan(peak);
    heat.update(part,120); expect(radiance(mesh)).toBe(0);
    heat.dispose(); original.dispose(); mesh.geometry.dispose();
  });
  it('becomes progressively less red with blackbody temperature', () => {
    const red=blackbody(1000,new THREE.Color()), white=blackbody(6500,new THREE.Color());
    expect(red.b).toBe(0); expect(white.b).toBeGreaterThan(.9);
    expect(white.g).toBeGreaterThan(red.g);
  });
  it('rebases solar-system positions before float32 upload and preserves the trail', () => {
    const pool=new ParticlePool(4), initial=new THREE.Vector3(1.5e11,2e11,-3e10);
    pool.emit(initial,new THREE.Vector3(),0,10,1,1,new THREE.Color());
    const origin=initial.clone().add(new THREE.Vector3(20000,50,0));
    pool.update(origin,1,500);
    const positions=pool.object.geometry.attributes.spawnPosition;
    expect(positions.getX(0)+pool.object.position.x).toBe(-20000);
    expect(positions.getY(0)+pool.object.position.y).toBe(-50);
    for(let i=0;i<20;i++) pool.emit(origin,new THREE.Vector3(),1,10,1,1,new THREE.Color());
    expect(positions.count).toBe(4); pool.dispose();
  });
  it('freezes particles with simulation time, clears rails jumps', () => {
    const fx=new FlightFx('low'), v=buildVessel(buildMoonLander(),PART_CATALOG);
    const zero=new THREE.Vector3(), center=new THREE.Vector3(0,-1000,0);
    const update=(ut: number) => fx.update(v,v.position,center,zero,'moon',100,0,0,zero,.1,500,ut,[[.3,.3,.3]]);
    update(0); fx.burst(v.position); update(.1);
    const time=fx.pool.object.material.uniforms.time.value;
    update(.1); expect(fx.pool.object.material.uniforms.time.value).toBe(time);
    update(100); expect(fx.pool.object.visible).toBe(false);
    fx.dispose();
  });
  it('peels fairing panels outward about their base, then frees them', () => {
    const fx = new FairingPanels(), zero = { x: 0, y: 0, z: 0 }, up = new THREE.Vector3(0, 1, 0);
    const mesh = buildPartMesh(PART_CATALOG.get('fairing-2')!);
    const panels = mesh.getObjectByName('fairingShell')!.children;
    expect(panels).toHaveLength(2);
    const at = new THREE.Vector3(0, 1000, 0), q = new THREE.Quaternion();
    for (const panel of panels) fx.emit(panel, at, q, zero, 2);
    expect(fx.activeCount).toBe(2);
    const holders = fx.root.children;
    const start = holders.map(h => h.position.clone());
    fx.update(zero, 0.5, new THREE.Vector3(0, -9.81, 0), zero, up, 1000, zero, 0);
    holders.slice(0, 2).forEach((h, i) => {
      const azimuth = (panels[i].userData.fairingPanel as { azimuth: number }).azimuth;
      const out = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
      // Moves outward and tips its top outward (local +Y leans toward `out`).
      expect(h.position.clone().sub(start[i]).dot(out)).toBeGreaterThan(0.5);
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(h.quaternion).dot(out)).toBeGreaterThan(0.2);
    });
    for (let i = 0; i < 20; i++) fx.update(zero, 0.5, new THREE.Vector3(0, -9.81, 0), zero, up, 1000, zero, 0);
    expect(fx.activeCount).toBe(0);
    expect(fx.root.visible).toBe(false);
    for (const h of holders) expect(h.children).toHaveLength(0);
    fx.dispose();
  });
  it('changes quality with a bounded pool', () => {
    const fx=new FlightFx('high'); fx.setQuality('low');
    expect(fx.pool.capacity).toBe(FX_BUDGET.low.count); expect(fx.root.children.length).toBe(4); fx.dispose();
  });
});

it('does not generate combustion smoke in vacuum and only sprays dust toward terrain', () => {
  const fx=new FlightFx('low'), v=buildVessel(buildMoonLander(),PART_CATALOG);
  const zero=new THREE.Vector3(), center=new THREE.Vector3(0,-1000,0);
  for(const p of v.parts) if(p.engine) {p.engine.thrust=100000; p.engine.throttle=1;}
  const update=(alt:number,ut:number)=>fx.update(v,v.position,center,zero,'moon',alt,0,0,zero,.1,500,ut,[[.3,.3,.3]]);
  update(100,0); update(100,.2);
  expect(fx.pool.object.visible).toBe(false);
  // Upright lander: exhaust impinges on the terrain.
  for(let i=1;i<=20;i++) update(10,.2+i*.1);
  expect(fx.pool.object.visible).toBe(true);
  fx.pool.clear();
  v.orientation={x:1,y:0,z:0,w:0};
  for(let i=1;i<=20;i++) update(10,2.2+i*.1);
  expect(fx.pool.object.visible).toBe(false);
  const light=fx.root.children.find(o=>o instanceof THREE.PointLight) as THREE.PointLight;
  expect(light.visible).toBe(true); expect(light.intensity).toBeGreaterThan(0);
  fx.dispose();
});

it('retires expired instances and carries ballistic acceleration in local float32 attributes', () => {
  const pool=new ParticlePool(8), zero=new THREE.Vector3();
  pool.emit({x:1.5e11,y:0,z:0},zero,0,1,2,.2,new THREE.Color(),{x:0,y:-1.62,z:0});
  pool.update({x:1.5e11,y:0,z:0},.5,1000);
  expect(pool.object.geometry.instanceCount).toBe(8);
  expect(pool.object.geometry.attributes.acceleration.getY(0)).toBeCloseTo(-1.62);
  expect(pool.object.visible).toBe(true);
  pool.update({x:1.5e11,y:0,z:0},2,1000);
  expect(pool.object.visible).toBe(false);
  pool.dispose();
});


it('gates RCS puffs on enabled controls and available monopropellant', () => {
  const fx=new FlightFx('low'), v=buildVessel(buildTender(),PART_CATALOG);
  const zero=new THREE.Vector3(), center=new THREE.Vector3(0,-1000,0);
  const input={tx:1,ty:1,tz:1};
  fx.update(v,v.position,center,zero,'moon',100,0,0,zero,.1,500,0,[[.3,.3,.3]]);
  fx.rcs(v,false,input); expect(fx.pool.object.visible).toBe(false);
  for(let i=0;i<20;i++) fx.rcs(v,true,input);
  expect(fx.pool.object.visible).toBe(true);
  fx.pool.clear();
  for(const p of v.parts) p.resources.monopropellant=0;
  fx.rcs(v,true,input); expect(fx.pool.object.visible).toBe(false);
  fx.dispose();
});

it('deposits continuous long-lived trail cells by surface-relative travel, ignoring solar translation', () => {
  const fx=new FlightFx('medium'), v=buildVessel(buildMoonLander(),PART_CATALOG);
  const p=v.parts.find(p=>p.engine)!; p.engine!.thrust=100000; p.engine!.throttle=1;
  const wind=new THREE.Vector3(30000,0,0), surface=new THREE.Vector3(), center=new THREE.Vector3(0,-1000,0);
  v.velocity={x:30000,y:0,z:0};
  const update=(ut:number)=>fx.update(v,v.position,center,wind,'earth',1000,1,0,surface,.1,1000,ut,[[.3,.3,.3]]);
  update(0);
  for(let i=1;i<=20;i++){v.position.x+=3000; center.x+=3000; update(i*.1);}
  expect(fx.pool.object.visible).toBe(false);
  surface.set(0,120,0); v.velocity.y=120;
  v.position.x+=3000; center.x+=3000; v.position.y+=36; update(2.1);
  expect(fx.pool.object.visible).toBe(true);
  const params=fx.pool.object.geometry.attributes.params;
  expect(params.getY(128)).toBe(90);
  expect(fx.pool.object.geometry.attributes.velocity.getX(128)).toBe(30000);
  fx.dispose();
});

it('leaves an expired pool dormant until a new event establishes a fresh anchor', () => {
  const pool=new ParticlePool(4), zero=new THREE.Vector3(), first=new THREE.Vector3(1.5e11,0,0);
  pool.emit(first,zero,0,1,2,0,new THREE.Color());pool.update(first,2,1000);
  const attribute=pool.object.geometry.attributes.spawnPosition as THREE.BufferAttribute, version=attribute.version;
  pool.update(new THREE.Vector3(3e11,0,0),3,1000);
  expect(attribute.version).toBe(version);expect(pool.object.visible).toBe(false);
  const next=new THREE.Vector3(3e11,100,0);
  pool.emit(next,zero,3,1,2,0,new THREE.Color());pool.update(next,3.1,1000);
  expect(attribute.getX(1)).toBe(0);expect(pool.object.position.length()).toBe(0);expect(pool.object.visible).toBe(true);
  pool.dispose();
});

it('preserves long-lived column cells through a spark / pad-dust burst without adding a draw', () => {
  const pool=new ParticlePool(512), zero=new THREE.Vector3(), color=new THREE.Color();
  pool.emit(zero,zero,0,90,60,.015,color);
  const params=pool.object.geometry.attributes.params;
  for(let i=0;i<1000;i++)pool.emit(zero,zero,1,.5,1,0,color);
  expect(params.getY(128)).toBe(90);
  expect(pool.object.geometry.instanceCount).toBe(512);
  pool.dispose();
});
