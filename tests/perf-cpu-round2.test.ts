import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShadowMapCache } from '../src/render/core/shadowCache';
import { createEphemeris } from '../src/sim/orbit';
import { buildUniverse } from '../src/sim/bodies';
import { BODY_DEFS } from '../src/data/bodies';
import { SCALE_PRESETS } from '../src/sim/bodies/scale';

function shadowScene() {
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  const cam = light.shadow.camera;
  cam.left = -10; cam.right = 10; cam.top = 10; cam.bottom = -10; cam.near = 0.1; cam.far = 200;
  light.position.set(0, 40, 0);
  scene.add(light, light.target);
  const caster = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  caster.castShadow = true;
  scene.add(caster);
  const frame = (cache: ShadowMapCache) => { scene.updateMatrixWorld(); return cache.update(scene, light, true); };
  return { scene, light, caster, frame };
}

describe('shadow map cache', () => {
  it('redraws only when a caster or the light moves by more than a fraction of a texel', () => {
    const { light, caster, frame } = shadowScene();
    const cache = new ShadowMapCache();
    expect(frame(cache)).toBe(true);
    expect(light.shadow.autoUpdate).toBe(false);
    expect(light.shadow.needsUpdate).toBe(true);
    // three allocates the map during the first shadow pass; emulate that so the cache sees a live map.
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    expect(frame(cache)).toBe(false);
    expect(light.shadow.needsUpdate).toBe(false);
    // A texel is 20 m / 1024 ≈ 2 cm: sub-millimetre drift is ignored, a centimetre is not.
    caster.position.x += 0.0005;
    expect(frame(cache)).toBe(false);
    caster.position.x += 0.01;
    expect(frame(cache)).toBe(true);
    expect(frame(cache)).toBe(false);
    caster.rotation.y += 0.01;
    expect(frame(cache)).toBe(true);
    light.position.set(5, 40, 0);
    expect(frame(cache)).toBe(true);
    cam(light).right = 12;
    expect(frame(cache)).toBe(true);
    expect(frame(cache)).toBe(false);
  });

  it('redraws when casters appear, disappear, change geometry, or the map is reallocated', () => {
    const { scene, light, caster, frame } = shadowScene();
    const cache = new ShadowMapCache();
    frame(cache);
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    expect(frame(cache)).toBe(false);
    caster.visible = false;
    expect(frame(cache)).toBe(true);
    caster.visible = true;
    expect(frame(cache)).toBe(true);
    const other = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial());
    other.castShadow = true;
    scene.add(other);
    expect(frame(cache)).toBe(true);
    other.geometry = new THREE.SphereGeometry(2);
    expect(frame(cache)).toBe(true);
    (other.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    expect(frame(cache)).toBe(true);
    expect(frame(cache)).toBe(false);
    light.shadow.map = null;
    expect(frame(cache)).toBe(true);
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    expect(cache.update(scene, light, false)).toBe(false);
    expect(frame(cache)).toBe(true);
    cache.invalidate();
    expect(frame(cache)).toBe(true);
  });

  it('ignores casters moving entirely outside the light volume (a distant launch site under the orbit)', () => {
    const { scene, light, frame } = shadowScene();
    const far = new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50), new THREE.MeshStandardMaterial());
    far.castShadow = true;
    far.position.set(100_000, 0, 0);
    scene.add(far);
    const cache = new ShadowMapCache();
    frame(cache);
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    far.position.x += 500;
    expect(frame(cache)).toBe(false);
    // Entering the volume is a change.
    far.position.set(30, 0, 0);
    expect(frame(cache)).toBe(true);
  });
});

function cam(light: THREE.DirectionalLight) { return light.shadow.camera; }

describe('ephemeris time slots', () => {
  it('returns identical states when queries interleave a few times, as one frame does', () => {
    const bodies = buildUniverse(BODY_DEFS, SCALE_PRESETS.standard);
    const cached = createEphemeris(bodies);
    const times = [1000, 1000.02, 999.98, 1000.04];
    const first = times.map(t => cached.getBodyState('moon', t));
    // Interleaved queries reuse their slot's objects; a fresh ephemeris gives the same values.
    for (let k = 0; k < 3; k++) times.forEach((t, i) => expect(cached.getBodyState('moon', t)).toBe(first[i]));
    times.forEach((t, i) => expect(createEphemeris(bodies).getBodyState('moon', t)).toEqual(first[i]));
    times.forEach(t => expect(cached.bodyRotation('earth', t)).toBe(cached.bodyRotation('earth', t)));
    // A fifth time recycles the least recently used slot without changing any value.
    const fresh = cached.getBodyState('moon', 2000);
    expect(fresh).toEqual(createEphemeris(bodies).getBodyState('moon', 2000));
    expect(cached.getBodyState('moon', 1000)).toEqual(first[0]);
  });
});

describe('rigid batching of animated parts', () => {
  it('draws only animated, transparent or multi-material meshes individually and keeps gimbals live', async () => {
    const { buildVessel } = await import('../src/sim/vessel');
    const { buildMoonLander, buildRoverLander } = await import('../src/editor/stockCrafts');
    const { PART_CATALOG } = await import('../src/data/parts');
    const { VesselView } = await import('../src/render/vessel/VesselView');
    const { isAnimatedNode } = await import('../src/render/vessel/staticBatch');
    let gimbalCount = 0;
    for (const craft of [buildMoonLander(), buildRoverLander()]) {
      const v = buildVessel(craft, PART_CATALOG), view = new VesselView(v);
      view.update({ x: 0, y: 0, z: 0 }, 0, 101325, 0.02);
      let batched = 0;
      view.root.traverseVisible(o => {
        if (!(o instanceof THREE.Mesh)) return;
        let inBatch = false, animated = false;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) {
          if (p.children.some(c => c instanceof THREE.InstancedMesh) && p.parent?.type === 'Group' && p !== o && p.children.every(c => c instanceof THREE.Mesh)) inBatch = true;
          if (isAnimatedNode(p)) animated = true;
        }
        if (inBatch) { batched++; return; }
        const material = o.material as THREE.Material | THREE.Material[];
        expect(animated || Array.isArray(material) || material.transparent || o.children.length > 0, o.name).toBe(true);
      });
      expect(batched).toBeGreaterThan(0);
      // Gimballed engines still move their own (unbatched) nozzles.
      const gimbals: THREE.Object3D[] = [];
      view.root.traverse(o => { if (o.name === 'gimbal') gimbals.push(o); });
      gimbalCount += gimbals.length;
      for (const p of v.parts) if (p.engine) p.engine.gimbal.a = 0.05;
      view.update({ x: 0, y: 0, z: 0 }, 0, 101325, 0.02);
      for (const gimbal of gimbals) {
        expect(gimbal.rotation.x).toBeCloseTo(0.05);
        let visibleChild = false;
        gimbal.traverseVisible(o => { if (o !== gimbal && o instanceof THREE.Mesh) visibleChild = true; });
        expect(visibleChild).toBe(true);
      }
      view.dispose();
    }
    expect(gimbalCount).toBeGreaterThan(0);
  });
});

describe('quadtree selection reuse', () => {
  it('reuses an unchanged view, reselects when the view or the built chunks change, and never evicts on reuse', async () => {
    const { Quadtree, VIEW_KEY } = await import('../src/render/planet/quadtree');
    const { buildChunk } = await import('../src/render/planet/chunkBuilder');
    const terrain = { heightAt: () => 0, maxHeight: 0, minHeight: 0, ocean: false } as unknown as Parameters<typeof buildChunk>[0];
    const pool = { available: false, buildChunkSync: (_k: string, p: Parameters<typeof buildChunk>[1]) => buildChunk(terrain, p) };
    const R = 600_000;
    const qt = new Quadtree({ terrainKey: 't', radius: R, minHeight: 0, maxHeight: 0, res: 8, maxLevel: 6, ocean: false,
      pool: pool as never, terrainMaterial: new THREE.MeshBasicMaterial(), maxInFlight: 4, buildBudgetMs: 1e9, cacheSize: 1 });
    let walks = 0;
    const ctx = (z: number) => ({ camBF: { x: 0, y: 0, z }, screenFactor: 1000, maxScreenError: 2, inFrustum: () => { walks++; return true; }, frame: 0 });
    const view = (z: number) => { const v = new Float64Array(VIEW_KEY); v[2] = z; v[6] = 1; v[7] = 1000; return v; };
    // Build until stable (each pump attaches chunks, which must invalidate reuse).
    for (let i = 0; i < 20; i++) { qt.select(ctx(R + 1000), view(R + 1000)); qt.pump(); }
    const stable = qt.select(ctx(R + 1000), view(R + 1000)).slice();
    expect(stable.length).toBeGreaterThan(6);
    walks = 0;
    const again = qt.select(ctx(R + 1000), view(R + 1000 + 0.001));
    expect(walks).toBe(0);
    expect(again).toEqual(stable);
    const built = qt.stats.builtTotal;
    qt.evict(10_000); // cacheSize 1: a real pass would evict, a reused one must not
    expect(qt.stats.builtTotal).toBe(built);
    expect(qt.select(ctx(R + 1000), view(R + 1000))).toEqual(stable);
    walks = 0;
    qt.select(ctx(R + 5000), view(R + 5000));
    expect(walks).toBeGreaterThan(0);
    qt.dispose();
  });
});
