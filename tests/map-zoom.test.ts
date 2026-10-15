import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { MapView } from '../src/render/map/MapView';
import { aimAt, pickSphere } from '../src/render/map/framing';
import { FlightMap } from '../src/flight/map/FlightMap';
import type { FlightController } from '../src/flight/controller';
import { requireIntactFlight } from './helpers/structural';

const W = 1280, H = 800;

function host() {
  return { style: {}, dataset: {}, textContent: '', appendChild: vi.fn(), remove: vi.fn(), getContext: () => ({
    beginPath() {}, arc() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {}, fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  }) };
}

/** A map canvas stand-in that records the listeners MapView attaches, so tests can send it wheel events. */
function canvas() {
  const on: Record<string, (e: unknown) => void> = {};
  const el = {
    nodeType: 1, style: {}, clientWidth: W, clientHeight: H,
    addEventListener: (k: string, f: (e: unknown) => void) => { on[k] = f; }, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    contains: (n: unknown) => n === el,
  };
  const wheel = (x: number, y: number, deltaY: number) =>
    on.wheel({ clientX: x, clientY: y, deltaY, deltaMode: 0, ctrlKey: false, altKey: false, target: el, preventDefault() {} });
  return { el: el as unknown as HTMLElement, wheel };
}

/** `?scenario=orbit` with the stock Selene, plus a FlightMap and MapView wired like the flight scene. */
function orbitMap() {
  vi.stubGlobal('document', { createElement: host });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  placeInCircularOrbit(world, wv, 'earth', Math.max(90000, world.universe.body('earth').atmosphere!.height + 80000));
  const map = new MapView(world.universe.bodies, world.universe.ephem, host() as unknown as HTMLElement);
  const c = { world, map, mapMode: true, paused: false, network: null } as unknown as FlightController;
  const ui = new FlightMap(c);
  const { el, wheel } = canvas();
  map.attachControls(el, () => ui.minDistance());
  const R = world.universe.body('earth').radius;
  /** One rendered frame (16 ms), as the flight scene draws it. */
  const frame = () => {
    now += 16;
    const patches = world.mapTrajectory();
    const f = ui.focusFrame(wv, wv.state.position, patches);
    map.update({ t: world.ut, focus: f.position, focusId: f.focusId, referenceBody: f.referenceBody, viewport: { width: W, height: H } });
    map.camera.updateMatrixWorld();
  };
  const earth = () => world.universe.ephem.getBodyState('earth', world.ut).position;
  const renderFocus = () => (map as unknown as { renderFocus: { x: number; y: number; z: number } }).renderFocus;
  /** Screen position of a scene-frame point given relative to Earth's centre. */
  const project = (p: THREE.Vector3) => {
    const e = earth(), f = renderFocus();
    const v = new THREE.Vector3(p.x + e.x - f.x, p.y + e.y - f.y, p.z + e.z - f.z).project(map.camera);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
  };
  /** Point of Earth's surface under a screen pixel (relative to Earth's centre), or null. */
  const pick = (x: number, y: number) => {
    const e = earth(), f = renderFocus();
    const o = map.camera.position.clone().add(new THREE.Vector3(f.x - e.x, f.y - e.y, f.z - e.z));
    const ray = new THREE.Ray(o, new THREE.Vector3(x / W * 2 - 1, 1 - y / H * 2, 0.5).unproject(map.camera).sub(map.camera.position).normalize());
    return ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), R), new THREE.Vector3());
  };
  return { world, map, ui, wheel, frame, project, pick, R, dispose: () => { ui.dispose(); map.dispose(); } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('map zoom', () => {
  it('picks the ground under a view-plane point and re-aims the camera at it from closer', () => {
    const ground = { x: 0, y: 0, z: 0 };
    // Straight down the view axis from (yaw 0, pitch 0) at 3 R: the near pole of the sphere on +X.
    expect(pickSphere(0, 0, 3, 1, 0, 0, ground)).toBe(true);
    expect(ground.x).toBeCloseTo(1, 12);
    // Off the limb: no ground.
    expect(pickSphere(0, 0, 3, 1, 0.5, 0, ground)).toBe(false);
    // A point right of and above the centre stays there as the camera closes in (it turns towards it).
    expect(pickSphere(0.3, 0.2, 3, 1, 0.12, 0.08, ground)).toBe(true);
    const view = { yaw: 0.3, pitch: 0.2 };
    expect(aimAt(view, 1.5, ground, 0.12, 0.08)).toBe(true);
    const again = { x: 0, y: 0, z: 0 };
    expect(pickSphere(view.yaw, view.pitch, 1.5, 1, 0.12, 0.08, again)).toBe(true);
    expect(Math.hypot(again.x - ground.x, again.y - ground.y, again.z - ground.z)).toBeLessThan(1e-6);
    expect(view.yaw).toBeGreaterThan(0.3);
    expect(view.pitch).toBeGreaterThan(0.2);
  });

  it('zooming on Earth from low orbit never flips the view and keeps the point under the cursor', () => {
    const m = orbitMap();
    try {
      for (let i = 0; i < 300; i++) m.frame();
      // Opened the map: the vessel's orbit is framed round Earth's centre.
      const cursor = { x: W * 0.62, y: H * 0.4 };
      expect(m.map.viewDistance).toBeGreaterThan(2 * m.R);
      const ground = m.pick(cursor.x, cursor.y)!;
      expect(ground).not.toBeNull();
      let prev = m.map.camera.getWorldDirection(new THREE.Vector3());
      let maxTurn = 0, maxDrift = 0;
      for (let step = 0; step < 60; step++) {
        m.wheel(cursor.x, cursor.y, -120);
        for (let i = 0; i < 6; i++) {
          m.frame();
          const dir = m.map.camera.getWorldDirection(new THREE.Vector3());
          maxTurn = Math.max(maxTurn, dir.angleTo(prev) * 180 / Math.PI);
          prev = dir;
          const s = m.project(ground);
          maxDrift = Math.max(maxDrift, Math.hypot(s.x - cursor.x, s.y - cursor.y));
        }
      }
      for (let i = 0; i < 120; i++) m.frame();
      // Reached the closest regional view (0.1 R above the ground), turning gently towards the cursor all the way.
      expect(maxTurn).toBeLessThan(1.5);
      expect(maxDrift).toBeLessThan(2);
      expect(m.map.viewDistance / m.R).toBeCloseTo(1.1, 3);
      const s = m.project(ground);
      expect(Math.hypot(s.x - cursor.x, s.y - cursor.y)).toBeLessThan(2);
    } finally { m.dispose(); }
  }, 60_000);

  it('a zoom with the cursor off the globe is a straight zoom (no turn)', () => {
    const m = orbitMap();
    try {
      for (let i = 0; i < 300; i++) m.frame();
      const { yaw, pitch } = m.map;
      expect(m.pick(4, 4)).toBeNull();
      for (let step = 0; step < 4; step++) { m.wheel(4, 4, -120); for (let i = 0; i < 6; i++) m.frame(); }
      expect(m.pick(4, 4)).toBeNull();
      expect(m.map.yaw).toBe(yaw);
      expect(m.map.pitch).toBe(pitch);
    } finally { m.dispose(); }
  }, 60_000);

  it('a focus the player picks survives closing and reopening the map, with its view', () => {
    const m = orbitMap();
    try {
      m.ui.reset();
      m.ui.setFocus({ kind: 'body', id: 'moon' });
      m.map.distance *= 0.7; m.map.yaw = 1.1; m.map.pitch = -0.2;
      const view = { distance: m.map.distance, yaw: m.map.yaw, pitch: m.map.pitch };
      m.ui.reset(); // closed
      m.ui.reset(); // reopened
      expect(m.ui.focus).toEqual({ kind: 'body', id: 'moon' });
      expect({ distance: m.map.distance, yaw: m.map.yaw, pitch: m.map.pitch }).toEqual(view);
      // Home (follow the vessel) still frames its orbit again on reopening.
      m.ui.setFocus(null);
      m.map.distance = 1e9;
      m.ui.reset();
      expect(m.ui.focus).toBeNull();
      expect(m.map.distance).toBeLessThan(1e8);
    } finally { m.dispose(); }
  }, 60_000);
});
