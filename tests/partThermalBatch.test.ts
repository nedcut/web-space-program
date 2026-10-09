import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PartHeat } from '../src/render/fx/PartHeat';
import { thermalTexture } from '../src/render/fx/thermalSurface';
import { batchStaticParts, disposeStaticBatch } from '../src/render/vessel/staticBatch';
import { VesselView } from '../src/render/vessel/VesselView';
import { buildVessel } from '../src/sim/vessel';
import { buildMoonLander } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import type { PartState } from '../src/sim/vessel/runtime';

const hot = { skinTemperature: [290, 290, 290, 1600, 290, 290] } as PartState;
const radiance = (slot: number) => thermalTexture.image.data![slot * 4];

describe('batched thermal surfaces', () => {
  it('merges repeated parts into one draw with independent radiance and a stable shader binding', () => {
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
    b.position.x = 3;
    const ah = new PartHeat(a), bh = new PartHeat(b);
    expect(a.material).toBe(b.material);
    const batch = batchStaticParts([a, b]);
    expect(batch.children).toHaveLength(1);
    const mesh = batch.children[0] as THREE.Mesh;
    expect((mesh as THREE.InstancedMesh).isInstancedMesh).toBeFalsy();
    const slots = mesh.geometry.getAttribute('wspHeatSlot');
    const n = geometry.getAttribute('position').count;
    expect(slots.getX(0)).not.toBe(slots.getX(n));
    ah.update(hot, 1);
    expect(radiance(slots.getX(0))).toBeGreaterThan(1);
    expect(radiance(slots.getX(n))).toBe(0);
    // Same material (and program) as the individual meshes: no instanced variant.
    expect(mesh.material).toBe(a.material);
    const version = (mesh.material as THREE.Material).version;
    ah.update(hot, 1);
    expect((mesh.material as THREE.Material).version).toBe(version);
    disposeStaticBatch(batch); ah.dispose(); bh.dispose();
    expect(radiance(slots.getX(0))).toBe(0);
    geometry.dispose(); material.dispose();
  });

  it('preserves thermal indices through a unique-geometry merge', () => {
    const m = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), m);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(), m);
    const ah = new PartHeat(a), bh = new PartHeat(b);
    const slotA = a.geometry.getAttribute('wspHeatSlot').getX(0);
    const slotB = b.geometry.getAttribute('wspHeatSlot').getX(0);
    const batch = batchStaticParts([a, b]);
    expect(batch.children).toHaveLength(1);
    const slots = (batch.children[0] as THREE.Mesh).geometry.getAttribute('wspHeatSlot');
    expect(new Set(slots.array)).toEqual(new Set([slotA, slotB]));
    bh.update(hot, 1);
    expect(radiance(slotA)).toBe(0); expect(radiance(slotB)).toBeGreaterThan(1);
    disposeStaticBatch(batch); ah.dispose(); bh.dispose(); m.dispose();
  });

  it('keeps live heat materials after vessel rebuilding and stress-overlay round trips', () => {
    const vessel = buildVessel(buildMoonLander(), PART_CATALOG), view = new VesselView(vessel);
    for (const p of vessel.parts) p.skinTemperature.fill(1600);
    for (const stress of [false, true, false]) {
      view.setStressOverlay(stress);
      view.update({ x: 0, y: 0, z: 0 }, 0, 0, 0.02);
      let hotMeshes = 0;
      view.root.traverseVisible(o => {
        if (!(o instanceof THREE.Mesh) || Array.isArray(o.material) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
        const slots = o.geometry.getAttribute('wspHeatSlot');
        if (!slots) return;
        expect(o.material.name).toContain('#thermal');
        expect(radiance(slots.getX(0))).toBeGreaterThan(1);
        hotMeshes++;
      });
      if (!stress) expect(hotMeshes).toBeGreaterThan(10);
    }
    view.dispose();
  });
});

describe('packed ORM in thermal variants', () => {
  it('binds the packed occlusion/roughness/metalness texture once and reads its channels from one fetch', async () => {
    const { thermalMaterial } = await import('../src/render/fx/thermalSurface');
    const orm = new THREE.Texture();
    const base = new THREE.MeshPhysicalMaterial({ roughnessMap: orm, metalnessMap: orm, aoMap: orm, aoMapIntensity: 0.7 });
    const v = thermalMaterial(base) as THREE.MeshPhysicalMaterial;
    expect(v.roughnessMap).toBe(orm);
    expect(v.metalnessMap).toBeNull();
    expect(v.aoMap).toBeNull();
    expect(v.customProgramCacheKey()).toContain(':orm-ao');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    v.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).not.toContain('#include <metalnessmap_fragment>');
    expect(shader.fragmentShader).not.toContain('#include <aomap_fragment>');
    expect(shader.fragmentShader).toContain('texelRoughness.b');
    expect((shader.uniforms as Record<string, { value: number }>).wspAoIntensity.value).toBe(0.7);
    // Restoring the maps returns three's own path (used to compare the two in a browser).
    v.metalnessMap = orm; v.aoMap = orm;
    expect(v.customProgramCacheKey()).not.toContain(':orm');
    // A material with separate maps keeps them.
    const other = thermalMaterial(new THREE.MeshStandardMaterial({ roughnessMap: orm, metalnessMap: new THREE.Texture() })) as THREE.MeshStandardMaterial;
    expect(other.metalnessMap).not.toBeNull();
    expect(other.customProgramCacheKey()).not.toContain(':orm');
  });
});
