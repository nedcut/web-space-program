import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PART_DEFS } from '../src/data/parts';
import { buildPartMesh } from '../src/render/parts';
import { createPartMesh } from '../src/editor/scene/partMesh';

function materials(root: THREE.Object3D) {
  const result = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof THREE.MeshStandardMaterial) result.set(m.name, m);
    }
  });
  return result;
}

describe('editor studio material isolation', () => {
  it('changes colour values without mutating flight templates or introducing shader features', () => {
    let changed = 0;
    for (const id of ['tank-1-long', 'eng-chinook', 'eng-zephyr']) {
      const def = PART_DEFS.find(d => d.id === id)!;
      const flight = materials(buildPartMesh(def));
      const originalColors = new Map([...flight].map(([name, m]) => [name, m.color.getHex()]));
      const editorMesh = createPartMesh(def);
      const editor = materials(editorMesh);
      editorMesh.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.every(m => m.name === 'decal')) expect(o.castShadow).toBe(false);
      });
      const laterFlight = materials(buildPartMesh(def));
      for (const [name, m] of editor) {
        const source = flight.get(name)!;
        expect(laterFlight.get(name)!.color.getHex()).toBe(originalColors.get(name));
        expect(m.type).toBe(source.type);
        expect(m.customProgramCacheKey()).toBe(source.customProgramCacheKey());
        expect(m.defines).toEqual(source.defines);
        expect(m.map).toBe(source.map);
        expect(m.normalMap).toBe(source.normalMap);
        expect(m.vertexColors).toBe(source.vertexColors);
        if (m.color.getHex() !== source.color.getHex()) {
          changed++;
          expect(m).not.toBe(source);
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  });
});
