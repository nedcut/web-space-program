import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blackbody, PartHeat } from '../src/render/fx/PartHeat';
import { ParticlePool } from '../src/render/fx/ParticlePool';
import { FlightFx, FX_BUDGET } from '../src/render/fx/FlightFx';
import type { PartState } from '../src/sim/vessel/runtime';

describe('flight visual effects', () => {
  it('isolates hottest-face emission from shared template materials and other parts', () => {
    const original = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(),original), b = a.clone();
    const heat = new PartHeat(a);
    heat.update({ skinTemperature: [290,290,290,1600,290,290] } as PartState,.1);
    expect(a.material.emissive.r).toBeGreaterThan(1);
    expect(b.material.emissive.r).toBe(0);
    expect(original.emissive.r).toBe(0);
    heat.update({ skinTemperature: [290,290,290,290,290,290] } as PartState,.1);
    expect(a.material.emissive.r).toBe(0);
    heat.dispose(); original.dispose(); a.geometry.dispose();
  });
  it('retains nozzle heat after shutdown and cools over time', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()); mesh.name='bellOuter';
    const original=mesh.material, heat=new PartHeat(mesh);
    const part = {skinTemperature:[290],engine:{thrust:100}} as PartState;
    heat.update(part,10); const peak=mesh.material.emissive.r;
    part.engine!.thrust=0; heat.update(part,.1);
    expect(mesh.material.emissive.r).toBeGreaterThan(0);
    expect(mesh.material.emissive.r).toBeLessThan(peak);
    heat.update(part,120); expect(mesh.material.emissive.r).toBe(0);
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
    const positions=pool.object.geometry.attributes.position;
    expect(positions.getX(0)+pool.object.position.x).toBe(-20000);
    expect(positions.getY(0)+pool.object.position.y).toBe(-50);
    for(let i=0;i<20;i++) pool.emit(origin,new THREE.Vector3(),1,10,1,1,new THREE.Color());
    expect(positions.count).toBe(4); pool.dispose();
  });
  it('changes quality with a bounded pool', () => {
    const fx=new FlightFx('high'); fx.setQuality('low');
    expect(fx.pool.capacity).toBe(FX_BUDGET.low.count); expect(fx.root.children.length).toBe(2); fx.dispose();
  });
});
