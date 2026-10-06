import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { detachRenderer } from '../src/render/releaseRenderer';

const count = (o: THREE.EventDispatcher<{ dispose: object }>, f: (e: unknown) => void) => ((o as unknown as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? []).filter((x) => x === f).length;

describe('releaseRenderer', () => {
  it('detaches only the scene renderer listener from shared materials, geometries and textures', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const own = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const geo = new THREE.BoxGeometry();
    for (const m of [shared, ...own]) scene.add(new THREE.Mesh(geo, m));
    const mine = () => {};
    const other = () => {};
    for (const m of [shared, ...own]) m.addEventListener('dispose', mine);
    shared.addEventListener('dispose', other); // a live renderer also drew the shared material
    geo.addEventListener('dispose', mine);
    shared.map!.addEventListener('dispose', mine);
    detachRenderer(scene);
    expect(count(shared, mine)).toBe(0);
    expect(count(shared, other)).toBe(1);
    for (const m of own) expect(count(m, mine)).toBe(0);
    expect(count(geo, mine)).toBe(0);
    expect(count(shared.map!, mine)).toBe(0);
  });

  it('leaves listeners alone when two renderers drew exactly the same objects', () => {
    const scene = new THREE.Scene();
    const m = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
    const a = () => {}, b = () => {};
    m.addEventListener('dispose', a); m.addEventListener('dispose', b);
    detachRenderer(scene);
    expect(count(m, a) + count(m, b)).toBe(2);
  });
});
