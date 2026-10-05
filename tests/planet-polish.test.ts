import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ringCell, ringCellSeed, ringProfileAt, RingParticles } from '../src/render/planet/RingParticles';
import { reflectedIrradiance } from '../src/render/planet/planetshine';
import { createPlanetUniforms } from '../src/render/planet/uniforms';
import { getQuality } from '../src/render/core/quality';

describe('camera-local ring population', () => {
  it('revisiting a cell reproduces chunks, including at negative and large coordinates', () => {
    for (const [x, y] of [[-123, 82], [300000, -400000], [0, 0]]) {
      const first = ringCell(x, y, 160, 32, () => 1);
      ringCell(x + 1, y, 160, 32, () => 1);
      expect(ringCell(x, y, 160, 32, () => 1)).toEqual(first);
      expect(ringCellSeed(x, y)).not.toBe(ringCellSeed(x + 1, y));
      for (const chunk of first) {
        expect(chunk.x - x * 160).toBeGreaterThanOrEqual(0);
        expect(chunk.x - x * 160).toBeLessThan(160);
        expect(Math.abs(chunk.z)).toBeLessThanOrEqual(22.5);
      }
    }
  });

  it('samples profile opacity with linear filtering and leaves gaps empty', () => {
    const profile = new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]);
    expect(ringProfileAt(profile, 100, 200, 150)).toBeCloseTo(0.5);
    expect(ringProfileAt(profile, 100, 200, 99)).toBe(0);
    expect(ringProfileAt(profile, 100, 200, 201)).toBe(0);
    expect(ringCell(4, 5, 160, 32, () => 0)).toEqual([]);
    expect(ringCell(4, 5, 160, 32, () => 1)).toHaveLength(32);
  });

  it('uploads bounded local translations and preserves world placement through origin shifts', () => {
    const uniforms = createPlanetUniforms(6e6, null, null);
    const rings = new RingParticles(uniforms, getQuality('medium'), new Uint8Array([220, 210, 180, 255]), 6e6, 14e6);
    const camera = new THREE.Vector3(10e6 + 12.25, 57.5, 3);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const center = camera.clone().applyQuaternion(rotation).negate();
    rings.update(camera, center, rotation);
    const matrices = rings.group.children.map((child) => Array.from((child as THREE.InstancedMesh).instanceMatrix.array));
    const position = rings.group.position.clone();
    for (const child of rings.group.children) {
      const mesh = child as THREE.InstancedMesh;
      for (let i = 0; i < mesh.count; i++) {
        expect(Math.abs(mesh.instanceMatrix.array[i * 16 + 12])).toBeLessThan(1000);
        expect(Math.abs(mesh.instanceMatrix.array[i * 16 + 13])).toBeLessThan(1000);
      }
    }
    const shift = new THREE.Vector3(13.25, -72.5, 4);
    rings.update(camera, center.clone().add(shift), rotation);
    expect(rings.group.position.distanceTo(position.add(shift))).toBeLessThan(1e-8);
    rings.group.children.forEach((child, i) => expect(Array.from((child as THREE.InstancedMesh).instanceMatrix.array)).toEqual(matrices[i]));
    rings.update(new THREE.Vector3(10e6, 0, 1e5), center, rotation);
    expect(rings.group.visible).toBe(false);
    rings.dispose();
  });
});

describe('reflected planet irradiance', () => {
  it('respects the illuminated phase and inverse-square solid angle', () => {
    const full = reflectedIrradiance(1, 10, 1);
    expect(reflectedIrradiance(1, 10, -1)).toBeCloseTo(0, 12);
    expect(reflectedIrradiance(1, 10, 0)).toBeCloseTo(full / Math.PI);
    expect(reflectedIrradiance(1, 20, 1)).toBeCloseTo(full / 4);
    expect(reflectedIrradiance(1, 1.01, 1)).toBeLessThanOrEqual(0.15);
    expect(reflectedIrradiance(1, 0, 1)).toBe(0);
  });
});
