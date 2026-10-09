import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ringCell, ringCellSeed, ringProfileAt, RingParticles } from '../src/render/planet/RingParticles';
import { adaptedPlanetshine, discAlbedo, reflectedIrradiance } from '../src/render/planet/planetshine';
import { createPlanetUniforms } from '../src/render/planet/uniforms';
import { createTerrainMaterial } from '../src/render/planet/materials';
import { PlanetRenderer } from '../src/render/planet/PlanetRenderer';
import { BODY_DEFS } from '../src/data/bodies';
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

  it('shows earthshine on the Moon night side at a visible level, with Earth reflecting as a whole disc', () => {
    const earth = BODY_DEFS.find((b) => b.id === 'earth')!;
    const full = adaptedPlanetshine(reflectedIrradiance(earth.radius, 384_400_000, 1));
    expect(full).toBeGreaterThan(0.08);
    expect(full).toBeLessThan(0.15);
    expect(adaptedPlanetshine(reflectedIrradiance(earth.radius, 384_400_000, 0))).toBeLessThan(full);
    expect(adaptedPlanetshine(0)).toBe(0);
    const a = discAlbedo('earth', earth.surface?.colors);
    expect(Math.min(...a)).toBeGreaterThan(0.25);
    expect(a[2]).toBeGreaterThan(a[1]);
  });
});

describe('crater micro-relief by quality tier', () => {
  it('runs no crater scales on Low/Medium and all three on High/Ultra', () => {
    for (const [id, scales] of [['low', 0], ['medium', 0], ['high', 3], ['ultra', 3]] as const) {
      const q = getQuality(id);
      expect(q.terrain.craterScales).toBe(scales);
      const m = createTerrainMaterial(createPlanetUniforms(1.7374e6, null, null), q, { rockColor: [0.13, 0.125, 0.12], rockBlend: 0.35, airless: 1, detail: true, detailStrength: 1, craters: true });
      expect(m.defines.CRATER_DETAIL ? m.defines.CRATER_SCALES : 0).toBe(scales);
      m.dispose();
    }
  });
});

describe('planet detail integration', () => {
  const body = (id: string) => ({ ...BODY_DEFS.find((b) => b.id === id)!, atmosphere: undefined });

  it('disables resolved rings and volume effects on Low while retaining Earth night lights', () => {
    for (const id of ['saturn', 'earth', 'enceladus', 'io', 'titan', 'sun']) {
      const planet = new PlanetRenderer(body(id), null, { quality: getQuality('low') });
      try {
        planet.root.traverse((object) => {
          expect(object).not.toBeInstanceOf(THREE.InstancedMesh);
          expect(object.userData.extent).toBeUndefined();
          if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial) {
            if (id === 'earth') expect(object.material.defines.EARTH_DETAILS).toBe(1);
            else expect(object.material.defines.EARTH_DETAILS).toBeUndefined();
          }
        });
      } finally { planet.dispose(); }
    }
  });

  it('night lights off removes city-emission shader work on every Earth material', () => {
    const quality = getQuality('high');
    const planet = new PlanetRenderer(body('earth'), null, { quality: { ...quality, earth: { ...quality.earth, nightLights: false } } });
    try {
      planet.root.traverse(object => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial)
          expect(object.material.defines.EARTH_DETAILS).toBeUndefined();
      });
    } finally { planet.dispose(); }
  });

  it('lights a moon from its parent only in the same scene and respects quality and disposal', () => {
    const parent = new PlanetRenderer({ ...body('saturn'), rings: undefined }, null, { quality: getQuality('medium') });
    const moon = new PlanetRenderer(body('enceladus'), null, { quality: getQuality('medium') });
    const lowMoon = new PlanetRenderer(body('enceladus'), null, { quality: getQuality('low') });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const params = { camera, origin: { x: 1.4e12, y: 0, z: 0 }, bodyRotation: { x: 0, y: 0, z: 0, w: 1 },
      sunPosition: { x: 0, y: 0, z: 0 }, dt: 0 };
    const parentPosition = { x: 1.4e12, y: 0, z: 0 };
    const moonPosition = { x: 1.4e12 - parent.body.radius * 5, y: 0, z: 0 };
    const updateMoon = () => moon.update({ ...params, bodyPosition: moonPosition });
    try {
      parent.update({ ...params, bodyPosition: parentPosition });
      updateMoon();
      expect(moon.uniforms.uPlanetshineColor.value.length()).toBe(0);
      scene.add(parent.root, moon.root, lowMoon.root);
      updateMoon();
      const light = moon.uniforms.uPlanetshineColor.value.clone();
      expect(light.x).toBeGreaterThan(0);
      expect(moon.uniforms.uPlanetshineDir.value.x).toBeCloseTo(1);
      lowMoon.update({ ...params, bodyPosition: moonPosition });
      expect(lowMoon.uniforms.uPlanetshineColor.value.length()).toBe(0);
      new THREE.Scene().add(moon.root);
      updateMoon();
      expect(moon.uniforms.uPlanetshineColor.value.length()).toBe(0);
      scene.add(moon.root);
      updateMoon();
      expect(moon.uniforms.uPlanetshineColor.value).toEqual(light);
      parent.dispose();
      updateMoon();
      expect(moon.uniforms.uPlanetshineColor.value.length()).toBe(0);
    } finally { parent.dispose(); moon.dispose(); lowMoon.dispose(); }
  });
});
