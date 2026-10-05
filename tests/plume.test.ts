import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPlume } from '../src/render/parts/plume';
import type { EngineModule } from '../src/sim/vessel/types';

const TYPES: EngineModule['plume'][] = ['kerolox', 'hydrolox', 'methalox', 'solid', 'ion', 'monoprop', 'jet', 'afterburner'];

const uniforms = (g: THREE.Group) => ((g.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;

describe('engine plume', () => {
  it('builds every propellant type with at most 3 meshes sharing geometry', () => {
    const a = createPlume({ type: 'kerolox', exitRadius: 0.5, seed: 1 });
    const b = createPlume({ type: 'hydrolox', exitRadius: 1.2, seed: 2 });
    expect(a.object.children.length).toBeLessThanOrEqual(3);
    expect((a.object.children[0] as THREE.Mesh).geometry).toBe((b.object.children[0] as THREE.Mesh).geometry);
    for (const type of TYPES) {
      const p = createPlume({ type, exitRadius: 0.4, seed: 3 });
      p.update({ throttle: 1, ambientPressure: 101325, time: 1.5 });
      for (const v of Object.values(uniforms(p.object))) {
        if (typeof v.value === 'number') expect(Number.isFinite(v.value)).toBe(true);
      }
      p.dispose();
    }
    a.dispose();
    b.dispose();
  });

  it('hides at zero throttle and lengthens/widens in vacuum without diamonds', () => {
    const p = createPlume({ type: 'kerolox', exitRadius: 1, seed: 4 });
    p.update({ throttle: 0, ambientPressure: 101325, time: 0 });
    expect(p.object.visible).toBe(false);
    p.update({ throttle: 1, ambientPressure: 101325, time: 0 });
    const u = uniforms(p.object);
    expect(p.object.visible).toBe(true);
    const sl = { L: u.uL.value as number, rb: u.uRB.value as number, dia: u.uDiaAmp.value as number };
    expect(sl.dia).toBeGreaterThan(0);
    p.update({ throttle: 1, ambientPressure: 0, time: 0 });
    expect(u.uL.value).toBeGreaterThan(sl.L);
    expect(u.uRB.value).toBeGreaterThan(sl.rb * 1.5);
    expect(u.uDiaAmp.value).toBe(0);
    p.update({ throttle: 0.3, ambientPressure: 101325, time: 0 });
    expect(u.uL.value).toBeLessThan(sl.L);
    p.dispose();
  });

  it('keeps the cone hull radius non-decreasing so the ray/cone intersection stays single-nappe', () => {
    for (const type of TYPES) {
      const p = createPlume({ type, exitRadius: 0.7, seed: 5 });
      for (const atm of [0, 0.05, 0.3, 0.6, 1]) {
        for (const thr of [0.05, 0.5, 1]) {
          p.update({ throttle: thr, ambientPressure: atm * 101325, time: 2 });
          const u = uniforms(p.object);
          expect(u.uRB.value).toBeGreaterThanOrEqual(u.uRT.value);
          expect(u.uRT.value).toBeGreaterThan(0.7);
        }
      }
      p.dispose();
    }
  });
});
