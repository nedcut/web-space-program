import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  FINE_TUNE_SCALE, HANDLE_DEAD_ZONE, HANDLE_FULL_PULL, HANDLE_MAX_RATE, WHEEL_STEP,
  applyHandle, applyWheel, closestOnPolyline, handlePull, handleRate, handleScreenDirection, handleStretch, screenPolyline, slideWindow,
  wheelZoomFactor,
} from '../src/render/map/maneuverGizmo';
import { firstPlannedPatch, markerCaption, markerDetail, orbitMarkers, patchDrawnClosed } from '../src/render/map/orbitMarkers';
import { focusCycle, mapContextActions, nextFocus } from '../src/ui/map/mapActions';
import { createUniverse } from '../src/sim/bodies';
import { createEphemeris } from '../src/sim/orbit/ephemeris';
import { elementsToState, period, type Orbit, type TrajectoryPatch } from '../src/sim/orbit';
import { MapView } from '../src/render/map/MapView';

const MU = 3.986e14;
const leo: Orbit = { body: 'earth', mu: MU, a: 7e6, e: 0.1, i: 0, lan: 0, argPe: 0, m0: 0, epoch: 0 };

describe('maneuver gizmo handles', () => {
  it('ignores the dead zone and grows non-linearly up to a saturated rate', () => {
    expect(handleRate(0)).toBe(0);
    expect(handleRate(HANDLE_DEAD_ZONE)).toBe(0);
    const small = handleRate(20), medium = handleRate(40), large = handleRate(80);
    expect(small).toBeGreaterThan(0);
    // Doubling the pull more than doubles the rate (power law), so short pulls stay precise.
    expect(medium / small).toBeGreaterThan(3);
    expect(large / medium).toBeGreaterThan(3);
    expect(handleRate(HANDLE_FULL_PULL)).toBeCloseTo(HANDLE_MAX_RATE);
    expect(handleRate(HANDLE_FULL_PULL * 3)).toBeCloseTo(HANDLE_MAX_RATE);
    expect(handleRate(-40)).toBeCloseTo(-medium);
    expect(handleRate(40, true)).toBeCloseTo(medium * FINE_TUNE_SCALE);
    expect(handleRate(NaN)).toBe(0);
  });

  it('maps a drag along the handle direction to Δv in the handle frame', () => {
    const dir = handleScreenDirection(30, -40); // handle drawn up-right of the node
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1);
    expect(handlePull(30, -40, dir.x, dir.y)).toBeCloseTo(50);
    expect(handlePull(-30, 40, dir.x, dir.y)).toBeCloseTo(-50);
    expect(handlePull(40, 30, dir.x, dir.y)).toBeCloseTo(0); // perpendicular drag does nothing
    // Handles pointing at the camera fall back to "drag up adds".
    expect(handleScreenDirection(1, 1)).toEqual({ x: 0, y: -1 });

    const node = { prograde: 0, normal: 0, radial: 0 };
    const added = applyHandle(node, { axis: 'prograde', sign: -1 }, 50, 0.5);
    expect(added).toBeCloseTo(-handleRate(50) * 0.5);
    expect(node.prograde).toBeCloseTo(added); // retrograde handle reduces prograde
    applyHandle(node, { axis: 'normal', sign: 1 }, 50, 1);
    expect(node.normal).toBeCloseTo(handleRate(50));
    expect(applyHandle(node, { axis: 'radial', sign: 1 }, 2, 1)).toBe(0); // click without pull
  });

  it('steps Δv with the wheel, finer in fine-tune mode', () => {
    const node = { prograde: 0, normal: 0, radial: 0 };
    applyWheel(node, { axis: 'radial', sign: 1 }, -100);
    applyWheel(node, { axis: 'radial', sign: 1 }, -100);
    expect(node.radial).toBeCloseTo(2 * WHEEL_STEP);
    applyWheel(node, { axis: 'radial', sign: -1 }, -100, true);
    expect(node.radial).toBeCloseTo(2 * WHEEL_STEP - WHEEL_STEP / 10);
    applyWheel(node, { axis: 'radial', sign: 1 }, 120);
    expect(node.radial).toBeCloseTo(WHEEL_STEP - WHEEL_STEP / 10);
    expect(applyWheel(node, { axis: 'radial', sign: 1 }, 0)).toBe(0);
  });
});

describe('node time from the cursor', () => {
  it('projects onto the closest polyline segment and interpolates time', () => {
    const line = screenPolyline(8);
    const pts = [[0, 0, 0], [100, 0, 10], [100, 100, 20], [NaN, NaN, 30], [0, 100, 40]];
    pts.forEach(([x, y, t], i) => { line.x[i] = x; line.y[i] = y; line.t[i] = t; });
    line.n = pts.length;
    const a = closestOnPolyline(line, 25, 5)!;
    expect(a.time).toBeCloseTo(2.5);
    expect(a.distance).toBeCloseTo(5);
    const b = closestOnPolyline(line, 110, 50)!;
    expect(b.time).toBeCloseTo(15);
    expect(b.distance).toBeCloseTo(10);
    // Segments touching a vertex behind the camera are skipped.
    const c = closestOnPolyline(line, 50, 100)!;
    expect(c.time).toBeCloseTo(20);
    // A closed loop: both ends sit on the same pixel; the preferred time decides the revolution.
    const loop = screenPolyline(4);
    [[0, 0, 0], [100, 0, 50], [0, 0, 100]].forEach(([x, y, t], i) => { loop.x[i] = x; loop.y[i] = y; loop.t[i] = t; });
    loop.n = 3;
    expect(closestOnPolyline(loop, 1, 0, { time: 90, weight: 0.06 })!.time).toBeGreaterThan(95);
    expect(closestOnPolyline(loop, 1, 0, { time: 10, weight: 0.06 })!.time).toBeLessThan(5);
    line.n = 0;
    expect(closestOnPolyline(line, 0, 0)).toBeNull();
  });

  it('keeps the slide window continuous around the node and inside the allowed span', () => {
    expect(slideWindow(5000, 4000, 0, Infinity)).toEqual([3000, 7000]);
    expect(slideWindow(1500, 4000, 1000, Infinity)).toEqual([1000, 5000]);
    expect(slideWindow(5000, 4000, 0, 6000)).toEqual([3000, 6000]);
    const [lo, hi] = slideWindow(100, Infinity, 50, Infinity);
    expect(lo).toBe(50); expect(hi).toBeGreaterThan(100);
  });
});

describe('orbit markers', () => {
  const radius = { radius: (id: string) => (id === 'earth' ? 6.371e6 : 1.737e6) };
  it('places apsides on the current and planned orbits', () => {
    const T = period(leo);
    const patches: TrajectoryPatch[] = [
      { orbit: leo, startTime: 0, endTime: 600, endReason: 'maneuver' },
      { orbit: { ...leo, a: 8e6, e: 0.2, epoch: 600, m0: 0.5 }, startTime: 600, endTime: 600 + 2 * T, endReason: 'horizon' },
    ];
    expect(firstPlannedPatch(patches)).toBe(1);
    expect(patchDrawnClosed(patches[0])).toBe(true);
    const marks = orbitMarkers(patches, 10, radius);
    const pe0 = marks.find(m => m.key === 'pe:0')!, ap1 = marks.find(m => m.key === 'ap:1')!;
    expect(pe0.planned).toBe(false);
    expect(ap1.planned).toBe(true);
    expect(pe0.altitude).toBeCloseTo(7e6 * 0.9 - 6.371e6, -1);
    expect(ap1.altitude).toBeCloseTo(8e6 * 1.2 - 6.371e6, -1);
    expect(Math.hypot(ap1.position.x, ap1.position.y, ap1.position.z)).toBeCloseTo(9.6e6, -1);
    expect(markerCaption(pe0, id => id)).toBe('Pe');
    expect(markerDetail(ap1, 10, id => id)).toMatch(/Apoapsis \(planned\) 3229\.0 km\nT−/);
  });

  it('reports SOI encounters with the periapsis inside the encountered body', () => {
    const moonOrbit: Orbit = { body: 'moon', mu: 4.9e12, a: -5e6, e: 1.5, i: 0, lan: 0, argPe: 0, m0: -1, epoch: 5000 };
    const patches: TrajectoryPatch[] = [
      { orbit: { ...leo, a: 2e8, e: 0.96 }, startTime: 0, endTime: 5000, endReason: 'soiEnter', nextBody: 'moon' },
      { orbit: moonOrbit, startTime: 5000, endTime: 9000, endReason: 'impact' },
    ];
    const marks = orbitMarkers(patches, 0, radius);
    const enc = marks.find(m => m.kind === 'encounter')!;
    expect(enc.other).toBe('moon');
    expect(enc.altitude).toBeCloseTo(5e6 * 0.5 - 1.737e6, -1);
    expect(markerDetail(enc, 0, id => id.toUpperCase())).toContain('MOON encounter');
    expect(markerCaption(enc, id => id.toUpperCase())).toBe('MOON encounter · Pe 763.0 km');
    expect(markerCaption({ ...enc, altitude: -5 }, id => id)).toBe('moon encounter · impact');
    expect(marks.some(m => m.kind === 'impact' && m.body === 'moon')).toBe(true);
  });
});

describe('map focus and context actions', () => {
  it('cycles active vessel, its body, the trajectory, the target and moons', () => {
    const list = focusCycle({ activeVessel: 'ship', activeBody: 'earth', trajectoryBodies: ['earth', 'moon'], target: { kind: 'vessel', id: 'station' }, children: ['moon'] });
    expect(list.map(o => o.id)).toEqual(['ship', 'earth', 'moon', 'station']);
    expect(nextFocus(list, list[0], 1)).toEqual({ kind: 'body', id: 'earth' });
    expect(nextFocus(list, list[0], -1)).toEqual({ kind: 'vessel', id: 'station' });
    expect(nextFocus(list, list[3], 1)).toEqual(list[0]);
    expect(nextFocus(list, null, 1)).toEqual(list[1]);
    expect(nextFocus([], null, 1)).toBeNull();
  });

  it('offers target, warp and switch actions only where they apply', () => {
    const base = { activeId: 'ship', activeBody: 'earth', canTarget: true, canSwitch: true, canWarp: true, now: 0 };
    const ids = (o: Parameters<typeof mapContextActions>[0], c = {}) => mapContextActions(o, { ...base, ...c }).map(a => a.id);
    expect(ids({ kind: 'vessel', id: 'ship' })).toEqual(['focus', 'info']);
    expect(ids({ kind: 'body', id: 'earth' })).toEqual(['focus', 'info']);
    expect(ids({ kind: 'vessel', id: 'station' })).toEqual(['focus', 'target', 'switch', 'info']);
    expect(ids({ kind: 'vessel', id: 'station' }, { targetId: 'station', approach: { id: 'station', time: 100 } }))
      .toEqual(['focus', 'untarget', 'warpApproach', 'switch', 'info']);
    expect(ids({ kind: 'body', id: 'moon' }, { soiChanges: [{ body: 'moon', time: 3 }] })).toEqual(['focus', 'target', 'info']);
    expect(ids({ kind: 'body', id: 'moon' }, { soiChanges: [{ body: 'moon', time: 300 }] })).toEqual(['focus', 'target', 'warpSoi', 'info']);
    expect(ids({ kind: 'vessel', id: 'station' }, { canSwitch: false, canTarget: false })).toEqual(['focus', 'info']);
  });
});

function host() {
  const el = {
    style: {} as Record<string, string>, dataset: {}, textContent: '', appendChild: vi.fn(), remove: vi.fn(),
    getContext: () => ({ beginPath() {}, arc() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }) }),
  };
  return el;
}
afterEach(() => vi.unstubAllGlobals());

describe('map view maneuver picking', () => {
  it('turns a cursor on the active orbit into a node time and shows the gizmo for the selected node', () => {
    vi.stubGlobal('document', { createElement: host });
    const bodies = createUniverse('standard'), ephem = createEphemeris(bodies);
    const map = new MapView(bodies, ephem, host() as unknown as HTMLElement);
    // Heliocentric test orbit: no body is resolved at this range, so no planet renderer is built.
    const sun = bodies.get('sun')!;
    const orbit: Orbit = { body: 'sun', mu: sun.gm, a: 1.2e11, e: 0.05, i: 0.3, lan: 0, argPe: 0, m0: 0, epoch: 0 };
    const placed: number[] = [];
    map.handlers = { placeNode: t => placed.push(t), nodesChanged: () => {} };
    map.distance = 4e11;
    const position = { ...ephem.getBodyState('sun', 0).position };
    const vessel = { id: 'ship', position, nodes: [] as { id: number; time: number; prograde: number; normal: number; radial: number }[],
      patches: [{ orbit, startTime: 0, endTime: period(orbit) * 1.02, endReason: 'horizon' as const }] };
    const input = { t: 0, focusId: 'vessel:ship', focus: position, viewport: { width: 1280, height: 800 }, vessel };
    map.update(input); map.update(input);
    const time = period(orbit) * 0.3, p = elementsToState(orbit, time).position, e = ephem.getBodyState('sun', 0).position;
    const s = new THREE.Vector3(e.x + p.x - position.x, e.y + p.y - position.y, e.z + p.z - position.z).project(map.camera);
    const x = (s.x * .5 + .5) * 1280, y = (-s.y * .5 + .5) * 800;
    const hover = map['computeHover'](x + 3, y);
    expect(hover.kind).toBe('orbit');
    if (hover.kind === 'orbit') expect(Math.abs(hover.time - time)).toBeLessThan(period(orbit) / 200);
    // A node on that orbit gets the gizmo; its handles are pickable by screen position.
    vessel.nodes.push({ id: 7, time, prograde: 0, normal: 0, radial: 0 });
    map.update(input);
    const handles = map.scene.children.filter(o => o.type === 'Sprite' && o.renderOrder === 15 && o.visible);
    expect(handles).toHaveLength(6);
    const h = handles[0].position.clone().project(map.camera);
    expect(map.pickManeuver(h.x, h.y)).toMatchObject({ id: 7, axis: 'prograde', sign: 1 });
    expect(map.nodeScreenPosition(7)!.x).toBeCloseTo(x, 0);
    // The node centre is always grabbable, and every shown handle keeps a comfortable distance from it,
    // whatever the view angle (looking straight down the orbit normal hides the normal handles instead).
    for (const pitch of [0.5, 1.55, 0.02]) {
      map.pitch = pitch;
      map.update(input); map.update(input);
      const c = map.nodeScreenPosition(7)!;
      expect(map.pickManeuver(c.x / 640 - 1, 1 - c.y / 400)).toMatchObject({ id: 7, axis: undefined });
      expect(map.pickManeuver((c.x + 9) / 640 - 1, 1 - (c.y - 9) / 400)).toMatchObject({ id: 7, axis: undefined });
      const shown = map['gizmo'].filter(g => g.visible);
      expect(shown.length).toBeGreaterThanOrEqual(4);
      for (const g of shown) expect(Math.hypot(g.screen.x - c.x, g.screen.y - c.y)).toBeGreaterThanOrEqual(32);
    }
    map.dispose();
    expect(placed).toEqual([]);
  });
});

describe('map zoom and handle spacing', () => {
  it('zooms per wheel pixel, normalising line/page deltas and boosting trackpad pinch', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(100)).toBeGreaterThan(1.12);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1);
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48));
    expect(wheelZoomFactor(1, 2, false, 300)).toBeCloseTo(wheelZoomFactor(300));
    expect(wheelZoomFactor(5, 0, true)).toBeCloseTo(wheelZoomFactor(40));
    // A trackpad swipe (~60 events of 25 px) takes a LEO view (4 Earth radii) out past the Moon's orbit (Standard).
    let d = 4 * 637100;
    for (let i = 0; i < 2 * 60; i++) d *= wheelZoomFactor(25);
    expect(d).toBeGreaterThan(2.5 * 38440e3);
    // Momentum spikes are clamped.
    expect(wheelZoomFactor(1e5)).toBeCloseTo(wheelZoomFactor(400));
  });

  it('stretches foreshortened handle arms up to a limit', () => {
    expect(handleStretch(60, 60)).toBe(1);
    expect(handleStretch(90, 60)).toBe(1);
    expect(handleStretch(30, 60)).toBe(2);
    expect(handleStretch(1, 60)).toBe(5);
    expect(handleStretch(0, 60)).toBe(5);
  });
});

describe('path point actions', () => {
  it('adds nodes only on the orbit line and warps only to future points', async () => {
    const { pathPointActions } = await import('../src/ui/map/mapActions');
    const ids = (p: Parameters<typeof pathPointActions>[0], warp = true) => pathPointActions(p, { now: 100, canWarp: warp, canPlan: true }).map(a => a.id);
    expect(ids({ label: 'T−5m', time: 400, orbit: true })).toEqual(['addNode', 'warpPoint']);
    expect(ids({ label: 'Apoapsis', time: 400, key: 'ap:0' })).toEqual(['warpPoint', 'pin']);
    expect(ids({ label: 'Apoapsis', time: 102, key: 'ap:0', pinned: true })).toEqual(['unpin']);
    expect(ids({ label: 'AN', time: 400, key: 'AN' }, false)).toEqual(['pin']);
  });
});
