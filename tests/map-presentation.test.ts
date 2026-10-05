import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createUniverse } from '../src/sim/bodies';
import { createEphemeris } from '../src/sim/orbit/ephemeris';
import { MapView } from '../src/render/map/MapView';
import { bodyBreadcrumbs, familyColor, placeLabel } from '../src/render/map/presentation';
import { acquireSurfaceBake } from '../src/render/planet/sharedBake';
import { TerrainWorkerPool } from '../src/render/planet/workerPool';
import { createTerrain } from '../src/sim/terrain';

function host() {
  return { style: {}, dataset: {}, textContent: '', appendChild: vi.fn(), remove: vi.fn(), getContext: () => ({
    beginPath() {}, arc() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {}, fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  }) };
}
afterEach(() => vi.unstubAllGlobals());

describe('map presentation', () => {
  it('rejects overlapping labels and retains separated labels', () => {
    const accepted = [{ x: 20, y: 20, width: 80, height: 18 }];
    expect(placeLabel({ x: 80, y: 24, width: 50, height: 18 }, accepted, 1)).toBe(false);
    expect(placeLabel({ x: 110, y: 20, width: 50, height: 18 }, accepted, 1)).toBe(true);
  });
  it('builds ancestry and assigns the same orbit colour to a planet and its moons', () => {
    const bodies = createUniverse('standard');
    expect(bodyBreadcrumbs(bodies.get('titan')!, bodies).map(b => b.name)).toEqual(['Sun', 'Saturn', 'Titan']);
    expect(familyColor(bodies.get('titan')!, bodies)).toBe(familyColor(bodies.get('saturn')!, bodies));
    expect(familyColor(bodies.get('earth')!, bodies)).not.toBe(familyColor(bodies.get('saturn')!, bodies));
  });
  it('shares pending bakes and texture ownership until the final renderer releases', async () => {
    const pool = new TerrainWorkerPool(0);
    const body = createUniverse('standard').get('moon')!;
    pool.register('moon', body, createTerrain(body), 6);
    const bake = vi.spyOn(pool, 'bake');
    const a = acquireSurfaceBake(pool, 'moon', 16), b = acquireSurfaceBake(pool, 'moon', 16);
    expect(bake).toHaveBeenCalledTimes(1);
    const first = await a.promise, second = await b.promise;
    expect(first.texture).toBe(second.texture);
    const dispose = vi.spyOn(first.texture, 'dispose');
    a.release(); a.release(); expect(dispose).not.toHaveBeenCalled();
    b.release(); await Promise.resolve(); expect(dispose).toHaveBeenCalledOnce();
    pool.dispose();
  });
  it('retains conics, picks instanced body icons, and supports overlays and target changes', () => {
    vi.stubGlobal('document', { createElement: host });
    const bodies = createUniverse('standard'), ephem = createEphemeris(bodies);
    const map = new MapView(bodies, ephem, host() as unknown as HTMLElement);
    map.distance = 6e11;
    const input = { t: 0, focusId: 'sun', focus: ephem.getBodyState('sun', 0).position, viewport: { width: 1280, height: 800 } };
    map.setExtraOrbits([{ id: 'probe', position: ephem.getBodyState('saturn',0).position }]);
    map.update(input);
    const geometry = map.scene.children.filter(o => o.type === 'Line2').map(o => (o as THREE.Mesh).geometry);
    map.setTarget({ kind: 'body', id: 'saturn' }); map.update(input);
    expect(map.scene.children.filter(o => o.type === 'Line2').map(o => (o as THREE.Mesh).geometry)).toEqual(geometry);
    const point = new THREE.Vector3(...Object.values(ephem.getBodyState('saturn',0).position)).project(map.camera);
    expect(map.pick(point.x, point.y)).toEqual({ kind: 'body', id: 'saturn' });
    expect(map.scene.children.filter(o => o.type === 'Sprite')).toHaveLength(5); // Sun, active, approach pair, fleet.
    map.setResourceOverlay(['moon']); map.setResourceOverlay([], false);
    map.setApproach({ body: 'earth', positionA: { x: 1e6, y: 0, z: 0 }, positionB: { x: 2e6, y: 0, z: 0 }, label: 'Approach' });
    map.update(input); map.dispose();
  });
});
