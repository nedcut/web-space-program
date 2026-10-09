import { describe, expect, it } from 'vitest';
import { BODY_DEFS } from '../src/data/bodies';
import { scaleBodyDef, SCALE_PRESETS } from '../src/sim/bodies/scale';
import { createTerrain, LAUNCH_SITE, latLonToUnit } from '../src/sim/terrain';
import { direction, nearbyCells, randomFor, surfaceClass } from '../src/render/planet/scatter/grid';
import { SurfaceScatter } from '../src/render/planet/scatter/SurfaceScatter';
import { createPlanetUniforms } from '../src/render/planet/uniforms';
import { QUALITY_PRESETS } from '../src/render/core/quality';
import * as THREE from 'three';

const body = (id: string) => scaleBodyDef(BODY_DEFS.find(b => b.id === id)!, SCALE_PRESETS.standard);
describe('surface scatter', () => {
  it('keeps stable seeded cells across motion, cube seams and poles', () => {
    const moon = body('moon');
    for (const d of [direction(0, 0.9999, 0), direction(4, 0, 0), direction(0, 1, 1)]) {
      const camera = d.map(v => v * (moon.radius + 3)) as [number, number, number];
      const a = nearbyCells(moon.radius, camera, 1024);
      expect(a.length).toBeGreaterThan(300);
      expect(a.length).toBeLessThan(2048);
      expect(new Set(a.map(c => c.key)).size).toBe(a.length);
      const shifted = nearbyCells(moon.radius, [camera[0] + 1, camera[1], camera[2]], 1024);
      const common = shifted.find(c => c.key === a[0].key)!;
      const r1 = randomFor(42, a[0]), r2 = randomFor(42, common);
      expect(Array.from({ length: 20 }, () => r1())).toEqual(Array.from({ length: 20 }, () => r2()));
    }
  });
  it('excludes the entire launch plateau, water, snow and desert; selects vegetation and mountain rock', () => {
    const earth = body('earth'), terrain = createTerrain(earth);
    const site = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
    expect(surfaceClass(earth, terrain, [site.x, site.y, site.z], 10, 0)).toBe('none');
    const mock = { ...terrain, colorAt: (_x: number, _y: number, _z: number, _h: number, out: [number, number, number]) => { out[0] = 0.05; out[1] = 0.1; out[2] = 0.03; return out; } };
    expect(surfaceClass(earth, mock, [1, 0, 0], -1, 0)).toBe('none');
    expect(surfaceClass(earth, mock, [1, 0, 0], 100, 0)).toBe('green');
    expect(surfaceClass(earth, mock, [1, 0, 0], 100, 0.4)).toBe('rock');
    expect(surfaceClass(earth, mock, [0, 0, 1], 100, 0)).toBe('none');
    mock.colorAt = (_x, _y, _z, _h, out) => { out[0] = 0.5; out[1] = 0.35; out[2] = 0.19; return out; };
    expect(surfaceClass(earth, mock, [1, 0, 0], 100, 0)).toBe('none');
  });
  it('places bases on shared terrain and preserves centimetres after a rotated floating-origin change', () => {
    const moon = body('moon'), terrain = createTerrain(moon);
    const scatter = new SurfaceScatter(moon, terrain, QUALITY_PRESETS.medium, createPlanetUniforms(moon.radius, null, null));
    const camera: [number, number, number] = [moon.radius + terrain.heightAt(1, 0, 0) + 3, 0, 0];
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
    const offset = new THREE.Vector3(...camera).applyQuaternion(rotation).negate();
    for (let frame = 0; frame < 10; frame++) scatter.update(camera, offset, rotation);
    expect(scatter.stats.cells).toBeGreaterThan(0);
    const mesh = scatter.group.children[0] as THREE.InstancedMesh;
    const centers = (mesh.material as THREE.ShaderMaterial).uniforms.uCenters.value as THREE.DataTexture;
    const data = centers.image.data as Float32Array;
    const cellId = mesh.geometry.getAttribute('aCell');
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
    let checked = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(p, q, s);
      if (m.determinant() === 0) continue;
      const j = cellId.getX(i) * 4;
      const base = p.clone().add(new THREE.Vector3(data[j], data[j + 1], data[j + 2])).applyQuaternion(rotation).sub(offset).applyQuaternion(rotation.clone().invert());
      const radius = base.length(), d = base.clone().normalize();
      expect(Math.abs(radius - moon.radius - terrain.heightAt(d.x, d.y, d.z))).toBeLessThan(0.02);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    scatter.update(camera, offset.clone().addScalar(100), rotation);
    expect(scatter.stats.cells).toBeLessThan(50);
    scatter.dispose();
  });
  it('budgets resident cells, suspends above 3 km, and evicts cells after a camera relocation', () => {
    const moon = body('moon'), terrain = createTerrain(moon);
    const quality = { ...QUALITY_PRESETS.medium, scatter: { ...QUALITY_PRESETS.medium.scatter, cellsPerFrame: 1, budgetMs: 100 } };
    const scatter = new SurfaceScatter(moon, terrain, quality, createPlanetUniforms(moon.radius, null, null));
    const rotation = new THREE.Quaternion();
    const camera: [number, number, number] = [moon.radius + terrain.heightAt(1, 0, 0) + 3, 0, 0];
    scatter.update(camera, new THREE.Vector3(...camera).negate(), rotation);
    expect(scatter.stats.cells).toBe(1);
    const resident = scatter.group.children[0] as THREE.InstancedMesh;
    const first = new THREE.Matrix4(); resident.getMatrixAt(0, first);
    scatter.update([camera[0] + 3100, 0, 0], new THREE.Vector3(), rotation);
    expect(scatter.group.visible).toBe(false);
    expect(scatter.stats.cells).toBe(1);
    const relocated: [number, number, number] = [0, moon.radius + terrain.heightAt(0, 1, 0) + 3, 0];
    scatter.update(relocated, new THREE.Vector3(...relocated).negate(), rotation);
    expect(scatter.group.visible).toBe(true);
    expect(scatter.stats.cells).toBe(1);
    const second = new THREE.Matrix4(); resident.getMatrixAt(0, second);
    expect(second.elements).not.toEqual(first.elements);
    expect(scatter.group.children).toHaveLength(6); // Medium: rocks and their ground shadows only.
    expect(QUALITY_PRESETS.low.scatter.radius).toBe(0);
    scatter.dispose();
  });

});
