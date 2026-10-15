import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createUniverse } from '../src/sim/bodies';
import { createEphemeris } from '../src/sim/orbit/ephemeris';
import { MapView } from '../src/render/map/MapView';
import { bodyBreadcrumbs, familyColor, placeLabel } from '../src/render/map/presentation';
import { acquireSurfaceBake } from '../src/render/planet/sharedBake';
import { PlanetRenderer } from '../src/render/planet/PlanetRenderer';
import { QUALITY_PRESETS } from '../src/render/core/quality';
import { livePlanetUniforms } from '../src/render/planet/uniforms';
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
  it('localizes numerical solar vertices before conversion to Float32',()=>{
    vi.stubGlobal('document', { createElement: host });
    const bodies=createUniverse('standard'),ephem=createEphemeris(bodies),map=new MapView(bodies,ephem,host() as unknown as HTMLElement);
    const position={x:1e12,y:2e11,z:0},velocity={x:1,y:0,z:0};
    map.update({t:0,focusId:'vessel:probe',referenceBody:'sun',focus:position,viewport:{width:1280,height:800},vessel:{position,nodes:[],patches:[{
      orbit:{body:'sun',mu:bodies.get('sun')!.gm,a:1e12,e:0,i:0,lan:0,argPe:0,m0:0,epoch:0},startTime:0,endTime:1,endReason:'horizon',
      samples:[{position,velocity,time:0},{position:{...position,x:position.x+.25},velocity,time:1}],
    }]}});
    const line=map.scene.children.find(o=>o.userData.numericAnchor) as THREE.Mesh;
    expect(line.geometry.getAttribute('instanceStart').getX(0)).toBe(0);
    expect(line.geometry.getAttribute('instanceEnd').getX(0)).toBe(.25);
    map.dispose();
  });
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
  it('shares flight/map surface textures without replacing flight lighting', async () => {
    const body = createUniverse('standard').get('moon')!, terrain = createTerrain(body), pool = new TerrainWorkerPool(0);
    const quality = { ...QUALITY_PRESETS.low, bakedTextureWidth: 16 };
    const flight = new PlanetRenderer(body, terrain, { farOnly: true, pool, quality });
    const map = new PlanetRenderer(body, terrain, { farOnly: true, pool, quality, registerUniforms: false });
    const bake = vi.spyOn(pool, 'bake');
    const camera = new THREE.PerspectiveCamera(); camera.position.set(3e6,0,0);
    const input = { camera, origin: { x: 0,y: 0,z: 0 }, bodyPosition: { x: 0,y: 0,z: 0 },
      bodyRotation: { x: 0,y: 0,z: 0,w: 1 }, sunPosition: { x: 1e10,y: 0,z: 0 }, dt: 0 };
    flight.update(input); map.update({ ...input, origin: { x: 1e5,y: 0,z: 0 } });
    const texture = (renderer: PlanetRenderer) => ((renderer.root.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uMap.value;
    await vi.waitFor(() => { expect(texture(flight)).toBeInstanceOf(THREE.DataTexture); expect(texture(map)).toBeInstanceOf(THREE.DataTexture); });
    expect(bake).toHaveBeenCalledOnce(); expect(texture(flight)).toBe(texture(map));
    expect(livePlanetUniforms('moon').uPlanetCenter.value).toBe(flight.uniforms.uPlanetCenter.value);
    expect(map.uniforms.uPlanetCenter.value.x).toBe(-1e5);
    const dispose = vi.spyOn(texture(flight), 'dispose');
    map.dispose(); await Promise.resolve(); expect(dispose).not.toHaveBeenCalled();
    flight.dispose(); await Promise.resolve(); expect(dispose).toHaveBeenCalledOnce();
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
    expect(map.scene.children.filter(o => o.type === 'Sprite')).toHaveLength(12); // Sun, active, ghost node, six gizmo handles, fleet, two encounter ghosts.
    map.setResourceOverlay(['moon']); map.setResourceOverlay([], false);
    map.setApproach({ body: 'earth', positionA: { x: 1e6, y: 0, z: 0 }, positionB: { x: 2e6, y: 0, z: 0 }, label: 'Approach' });
    map.update(input);
    map.update({ ...input, focusId: 'vessel:first', referenceBody: 'sun' });
    map.distance = 2e11;
    map.update({ ...input, focusId: 'vessel:second', referenceBody: 'sun', focus: { x: 1e11,y: 0,z: 0 } });
    const sun = map.scene.children.find(o => o.type === 'Mesh' && o.scale.x === bodies.get('sun')!.radius)!;
    expect(Math.abs(sun.position.x)).toBeLessThan(1e11);
    expect(map.camera.position.length()).toBeGreaterThan(2e11);
    expect(map.camera.position.length()).toBeLessThan(6e11);
    map.dispose();
  });

  it('never renders from inside the reference body: turning, easing or a focus change', () => {
    vi.stubGlobal('document', { createElement: host });
    const bodies = createUniverse('standard'), ephem = createEphemeris(bodies);
    const map = new MapView(bodies, ephem, host() as unknown as HTMLElement);
    const earth = ephem.getBodyState('earth', 0).position, R = bodies.get('earth')!.radius;
    const surface = { x: earth.x + R, y: earth.y, z: earth.z };
    const sphere = (map as unknown as { bodies: Map<string, { sphere: THREE.Object3D }> }).bodies.get('earth')!.sphere;
    const frame = (focusId: string, focus: typeof earth) => {
      map.update({ t: 0, focusId, referenceBody: 'earth', focus, viewport: { width: 1280, height: 800 } });
      return map.camera.position.distanceTo(sphere.position) / R;
    };
    // Close above a surface focus, looking down: allowed.
    map.yaw = 0; map.pitch = 0; map.distance = 0.15 * R; frame('ascent:earth', surface);
    // Looking straight down from 0.15 R: zooming never turns the camera, so it stays where it was put.
    const close = frame('ascent:earth', surface);
    expect(close).toBeGreaterThanOrEqual(1.01);
    expect(close).toBeLessThanOrEqual(1.15 + 1e-3);
    // Turned to look up from below the surface: the very next frame is outside, on the far side.
    map.yaw = Math.PI;
    expect(frame('ascent:earth', surface)).toBeGreaterThanOrEqual(1.01 - 1e-9);
    // Back above and close, then the focus swings to the centre (reaching orbit) while the zoom eases out.
    map.yaw = 0; map.distance = 0.15 * R;
    for (let i = 0; i < 5; i++) frame('ascent:earth', surface);
    map.distance = 3 * R;
    for (let i = 0; i < 30; i++) expect(frame('earth', earth)).toBeGreaterThanOrEqual(1.01 - 1e-9);
  }, 60_000);
});
