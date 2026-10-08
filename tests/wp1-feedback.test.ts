import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { flightEndReady, LOSS_REPLAY_MS, scheduleFlightEnd } from '../src/flight/lossPresentation';
import { explosionDiameter, impactPunch, separationPunch, trailCells } from '../src/render/fx/eventDesign';
import { DebrisPool } from '../src/render/fx/DebrisPool';
import { FlightCamera } from '../src/flight/camera';
import { thrustGain } from '../src/audio/design';
import { engineLoudness } from '../src/audio';

describe('weight and payoff', () => {
  it('does not reveal the end bar or allow a report in the first 3.5 seconds; cleanup cancels it', () => {
    vi.useFakeTimers();
    try {
      const reveal = vi.fn(), cancel = scheduleFlightEnd(reveal);
      vi.advanceTimersByTime(3000); expect(reveal).not.toHaveBeenCalled();
      expect(flightEndReady(100,3099)).toBe(false);
      vi.advanceTimersByTime(LOSS_REPLAY_MS-3000); expect(reveal).toHaveBeenCalledOnce();
      expect(flightEndReady(100,3600)).toBe(true);
      cancel(); const cancelAgain=scheduleFlightEnd(reveal); cancelAgain();
      vi.advanceTimersByTime(LOSS_REPLAY_MS); expect(reveal).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('gives a rated separation more than one degree of punch and translation, then settles', () => {
    const a = new FlightCamera(), b = new FlightCamera();
    const frame = { up: new THREE.Vector3(0,1,0), vesselQuat: new THREE.Quaternion(), vesselId: 'test', radius: 5 };
    a.update(frame,0); b.update(frame,0);
    b.addKick(separationPunch(2000)); b.update(frame,1/120); a.update(frame,1/120);
    expect(a.camera.quaternion.angleTo(b.camera.quaternion)*180/Math.PI).toBeGreaterThan(1);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeGreaterThan(.2);
    for (let i=0;i<600;i++) { a.update(frame,1/120); b.update(frame,1/120); }
    expect(a.camera.quaternion.angleTo(b.camera.quaternion)).toBeLessThan(.0001);
    expect(impactPunch(10000,500)).toBeGreaterThan(impactPunch(100,3));
  });
  it('scales fireballs with diameter, mass and propellant within a bounded footprint', () => {
    expect(explosionDiameter(100,0,2.5)).toBeGreaterThanOrEqual(7.5);
    expect(explosionDiameter(1000,800,2.5)).toBeGreaterThan(explosionDiameter(100,0,2.5));
    expect(explosionDiameter(1e9,1e9,5)).toBeLessThanOrEqual(70);
  });
  it('limits a lone 9 kN engine amplitude to less than 35% of a 3.3 MN booster', () => {
    const loud=(n:number)=>engineLoudness(thrustGain(n)**2,101325);
    expect(loud(9000)/loud(3300000)).toBeLessThan(.35);
    expect(thrustGain(9000)).toBeGreaterThan(0);
  });
  it('fills distance cells rather than frame-count cells, with a missed-frame cap', () => {
    expect(trailCells(300,20,24)).toBe(15);
    expect(trailCells(1e6,20,24)).toBe(24);
    expect(trailCells(0,20,24)).toBe(0);
  });
  it('spawns at least five template fragments, rebases in float64, retires and reuses them', () => {
    const pool = new DebrisPool(), source = new THREE.CylinderGeometry(1,1,2);
    const disposed = vi.fn(); source.addEventListener('dispose',disposed);
    const position=new THREE.Vector3(1.5e11,2e11,-3e10), velocity=new THREE.Vector3(), up=new THREE.Vector3(0,1,0);
    pool.emit(source,position,velocity,10); expect(pool.activeCount).toBeGreaterThanOrEqual(5);
    const origin=position.clone().add(new THREE.Vector3(20000,0,0));
    pool.update(origin,0,velocity,position,up,100);
    expect(pool.root.children[0].position.x).toBe(-20000);
    for (let i=0;i<100;i++) pool.emit(source,position,velocity,10);
    expect(pool.activeCount).toBe(32);
    pool.update(origin,5,velocity,position,up,100); expect(pool.activeCount).toBe(0);
    expect(pool.root.children.every(o=>!o.visible)).toBe(true);
    pool.dispose(); expect(disposed).not.toHaveBeenCalled(); source.dispose();
  });
});

it('stops a live kick immediately when Reduce Motion or zero camera shake is selected', () => {
  const a=new FlightCamera(), b=new FlightCamera();
  const frame={up:new THREE.Vector3(0,1,0),vesselQuat:new THREE.Quaternion(),vesselId:'test',radius:5,motionEnabled:false};
  a.update(frame,0); b.addKick(1); b.update(frame,0);
  expect(a.camera.position.distanceTo(b.camera.position)).toBe(0);
  expect(a.camera.quaternion.angleTo(b.camera.quaternion)).toBe(0);
});
