import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { colorBatchMaterial } from '../src/render/core/colorBatch';
import { M, ACCENTS } from '../src/render/parts/materials';
import { PartHeat } from '../src/render/fx/PartHeat';
import { isThermalVariant } from '../src/render/fx/thermalSurface';
import { buildStaticBatch, disposeStaticBatch } from '../src/render/vessel/staticBatch';

describe('colour-only vessel batches', () => {
  it('opts in only identical surfaces and keeps highlighting clones independent', () => {
    const accents = Object.keys(ACCENTS) as (keyof typeof ACCENTS)[];
    for (const family of [accents.map(M.accent), accents.map(M.anodised), [M.goldFoil(), M.silverFoil()]]) {
      const neutral = colorBatchMaterial(family[0]) as THREE.MeshStandardMaterial;
      expect(neutral.color.getHex()).toBe(0xffffff);
      for (const source of family) {
        expect(colorBatchMaterial(source)).toBe(neutral);
        // Full serialised material settings, excluding identity and the deliberately different albedo.
        const surface = (m: THREE.Material) => {
          const { uuid: _uuid, name: _name, color: _color, ...rest } = m.toJSON();
          return rest;
        };
        expect(surface(source)).toEqual(surface(neutral));
        const highlight = source.clone();
        highlight.color.setHex(0x44ff88);
        expect(colorBatchMaterial(highlight)).toBe(highlight);
      }
    }
    for (const m of [M.whitePanel(), M.charcoalPanel(), M.satinWhite(), M.blackPaint(), M.statusLed('green'), M.statusLed('red')]) {
      expect(colorBatchMaterial(m)).toBe(m);
    }
  });

  it('merges coloured faces with AO/soot, preserving heat/node slots and the individual fallback across rebuilds', () => {
    const sources = [M.accent('red'), M.accent('blue')];
    const geometry = new THREE.BoxGeometry();
    geometry.groups.forEach((g, i) => { g.materialIndex = i % 2; });
    const ao = new Float32Array(geometry.getAttribute('position').count * 3).fill(0.43);
    geometry.setAttribute('color', new THREE.BufferAttribute(ao, 3));
    const mesh = new THREE.Mesh(geometry, sources);
    const heat = new PartHeat(mesh);
    const originalMaterials = mesh.material;
    const originalColors = mesh.geometry.getAttribute('color').array.slice();
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      mesh.visible = true;
      const { group } = buildStaticBatch([mesh]);
      expect(group.children).toHaveLength(1);
      const merged = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      expect(isThermalVariant(merged.material)).toBe(true);
      expect(merged.material.color.getHex()).toBe(0xffffff);
      expect(merged.customDepthMaterial).toBeDefined();
      expect(merged.geometry.index!.count).toBe(geometry.index!.count);
      const colors = merged.geometry.getAttribute('color');
      const index = merged.geometry.index!;
      for (let face = 0; face < 6; face++) {
        const vertex = index.getX(face * 6);
        const tint = sources[face % 2].color;
        expect(colors.getX(vertex)).toBeCloseTo(ao[0] * tint.r, 7);
        expect(colors.getY(vertex)).toBeCloseTo(ao[1] * tint.g, 7);
        expect(colors.getZ(vertex)).toBeCloseTo(ao[2] * tint.b, 7);
        expect(merged.geometry.getAttribute('wspHeatSlot').getX(vertex)).toBe(mesh.geometry.getAttribute('wspHeatSlot').getX(0));
        expect(merged.geometry.getAttribute('wspNode').getX(vertex)).toBe(0);
      }
      expect(mesh.material).toBe(originalMaterials);
      expect(mesh.geometry.getAttribute('color').array).toEqual(originalColors);
      expect(geometry.getAttribute('color').array).toEqual(ao);
      disposeStaticBatch(group);
    }
    heat.dispose();
    geometry.dispose();
  });
});
