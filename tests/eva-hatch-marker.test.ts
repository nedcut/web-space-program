import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { neutralInput } from '../src/sim/vessel';
import { hatchMarkerLabel, hatchScenePosition, markerPlacement } from '../src/flight/hatchMarker';
import { add, length, sub, v3 } from '../src/util/vec3';

describe('EVA hatch marker', () => {
  it('marks the same point as the hatch the astronaut boards through, from any scene origin', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const ship = w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build());
    placeInCircularOrbit(w, ship, 'earth', 200000);
    w.goEva();
    const near = w.nearestHatch()!;
    expect(near.vessel).toBe(ship);
    expect(near.free).toBe(true);
    expect(near.distance).toBeLessThan(0.01);
    const origin = add(ship.state.position, v3(3, -2, 5));
    const out = new THREE.Vector3();
    const hatch = w.hatchPosition(ship.state, near.pod);
    // Camera on the hatch side: facing; on the far side of the hull: behind.
    const outward = sub(hatch, ship.state.position);
    const front = new THREE.Vector3(hatch.x - origin.x + outward.x * 10, hatch.y - origin.y + outward.y * 10, hatch.z - origin.z + outward.z * 10);
    const back = new THREE.Vector3(ship.state.position.x - origin.x - outward.x * 10, ship.state.position.y - origin.y - outward.y * 10, ship.state.position.z - origin.z - outward.z * 10);
    expect(hatchScenePosition(ship.state, near.pod, origin, front, out)).toBe(false);
    expect(length(sub(v3(out.x, out.y, out.z), sub(hatch, origin)))).toBeLessThan(1e-6);
    expect(hatchScenePosition(ship.state, near.pod, origin, back, out)).toBe(true);
  });

  it('follows the astronaut away from the hatch and ignores full pods', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const ship = w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build());
    placeInCircularOrbit(w, ship, 'earth', 200000);
    const eva = w.goEva()!;
    eva.state.position = add(eva.state.position, v3(40, 0, 0));
    w.tick(0.02, neutralInput());
    expect(w.nearestHatch()!.distance).toBeGreaterThan(38);
    const pod = w.nearestHatch()!.pod;
    pod.crew = Array.from({ length: 8 }, (_, i) => `x${i}`);
    expect(w.nearestHatch()!.free).toBe(false);
  });

  it('clamps an off-screen hatch to the view edge with an arrow toward it, also from behind the camera', () => {
    const out = { x: 0, y: 0 };
    expect(markerPlacement({ x: 0, y: 0, z: -10 }, { x: 0.5, y: -0.5 }, 1000, 800, out)).toBeNaN();
    expect(out).toEqual({ x: 750, y: 600 });
    // Far above the top edge (a hatch 15 m up the rocket): top edge, arrow pointing up.
    const up = markerPlacement({ x: 0, y: 10, z: -2 }, { x: 0, y: 4 }, 1000, 800, out);
    expect(out.x).toBeCloseTo(500, 6);
    expect(out.y).toBeCloseTo(28, 6);
    expect(up).toBeCloseTo(-Math.PI / 2, 6);
    // ... below the HUD's top bar when given its height.
    markerPlacement({ x: 0, y: 10, z: -2 }, { x: 0, y: 4 }, 1000, 800, out, 90);
    expect(out.y).toBeCloseTo(90, 6);
    // Behind the camera and to the right: right edge, arrow pointing right (projection would mirror it).
    const right = markerPlacement({ x: 5, y: 0, z: 10 }, { x: -3, y: 0 }, 1000, 800, out);
    expect(out.x).toBeCloseTo(972, 6);
    expect(right).toBeCloseTo(0, 6);
  });

  it('captions the distance, then the board key once in reach', () => {
    expect(hatchMarkerLabel(23.4, false, 'Enter')).toBe('Hatch · 23 m');
    expect(hatchMarkerLabel(4.25, false, 'Enter')).toBe('Hatch · 4.3 m');
    expect(hatchMarkerLabel(2, true, 'Enter')).toBe('Board · Enter');
  });
});
