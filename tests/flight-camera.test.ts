import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAMERA_MODES, FlightCamera, PivotSmoother, TouchdownKick, framingDistance, zoomLimits, type CameraFrame } from '../src/flight/camera';
import { PART_CATALOG } from '../src/data/parts';
import { buildMoonLander, buildOrbiter } from '../src/editor/stockCrafts';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { bodyToWorld } from '../src/sim/vessel';
import { qRotate } from '../src/util/quat';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { PHYSICS_DT, World } from '../src/game/world';
import { neutralInput } from '../src/sim/vessel';
import { cross, length, normalize, sub } from '../src/util/vec3';

const frame = (over: Partial<CameraFrame> = {}): CameraFrame => ({
  up: new THREE.Vector3(0, 0, 1),
  vesselQuat: new THREE.Quaternion(),
  velocity: new THREE.Vector3(100, 0, 0),
  orbitNormal: new THREE.Vector3(0, 1, 0),
  spaceBlend: 0,
  vesselId: 'a',
  radius: 5,
  ...over,
});

describe('flight camera feel', () => {
  it('frames the vessel on load and derives zoom limits from its size', () => {
    const cam = new FlightCamera();
    cam.update(frame({ radius: 8 }), 1 / 60);
    expect(cam.distance).toBeCloseTo(framingDistance(8), 6);
    expect(cam.minDistance).toBe(zoomLimits(8).min);
    const tiny = new FlightCamera();
    tiny.update(frame({ radius: 0.6 }), 1 / 60);
    expect(tiny.distance).toBeGreaterThanOrEqual(tiny.minDistance);
    expect(tiny.minDistance).toBeLessThan(2);
  });

  it('eases zoom without overshoot and settles within half a second', () => {
    const cam = new FlightCamera();
    cam.update(frame(), 1 / 60);
    const start = cam.distance;
    cam.zoomTo(start * 4);
    let t95 = Infinity;
    let maxD = 0;
    for (let i = 1; i <= 120; i++) {
      cam.update(frame(), 1 / 60);
      maxD = Math.max(maxD, cam.distance);
      if (t95 === Infinity && Math.log(cam.distance / start) >= 0.95 * Math.log(4)) t95 = i / 60;
    }
    console.log(`zoom ×4: 95% in ${(t95 * 1000).toFixed(0)} ms, overshoot ${((maxD / (start * 4) - 1) * 100).toFixed(2)}%`);
    expect(maxD).toBeLessThanOrEqual(start * 4 * (1 + 1e-9));
    expect(t95).toBeLessThan(0.5);
  });

  it('follows the vessel size when staging shrinks it', () => {
    const cam = new FlightCamera();
    cam.update(frame({ radius: 10 }), 1 / 60);
    const before = cam.distance;
    for (let i = 0; i < 120; i++) cam.update(frame({ radius: 5 }), 1 / 60);
    expect(cam.distance).toBeCloseTo(before / 2, 0);
  });

  it('eases to frame a newly focused vessel', () => {
    const cam = new FlightCamera();
    cam.update(frame({ radius: 10 }), 1 / 60);
    cam.update(frame({ vesselId: 'eva', radius: 1 }), 1 / 60);
    expect(cam.distance).toBeGreaterThan(framingDistance(1) * 2);
    for (let i = 0; i < 180; i++) cam.update(frame({ vesselId: 'eva', radius: 1 }), 1 / 60);
    expect(cam.distance).toBeCloseTo(framingDistance(1), 1);
  });

  it('keeps the view direction when switching between every mode', () => {
    const cam = new FlightCamera();
    const f = frame({ vesselQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.1, -0.3)), spaceBlend: 0.5 });
    for (let i = 0; i < 30; i++) cam.update(f, 1 / 60);
    for (const m of [...CAMERA_MODES, 'auto' as const]) {
      const before = cam.camera.position.clone();
      cam.mode = m;
      cam.update(f, 1 / 60);
      const moved = cam.camera.position.distanceTo(before) / cam.distance;
      expect(moved, `switch to ${m}`).toBeLessThan(0.02);
    }
  });

  it('never puts the camera below the terrain', () => {
    const cam = new FlightCamera();
    // Vessel 2 m above flat ground (scene z = height).
    const clearance = (p: THREE.Vector3) => p.z + 2;
    cam.pitch = -1.4;
    let lowest = Infinity;
    for (let i = 0; i < 240; i++) {
      cam.update(frame({ clearance }), 1 / 60);
      lowest = Math.min(lowest, clearance(cam.camera.position));
    }
    expect(lowest).toBeGreaterThan(0.5);
  });

  it('chase mode settles behind the direction of travel', () => {
    const cam = new FlightCamera();
    cam.mode = 'chase';
    cam.pitch = 0;
    const f = frame({ velocity: new THREE.Vector3(0, 200, 0) });
    for (let i = 0; i < 240; i++) cam.update(f, 1 / 60);
    const dir = cam.camera.position.clone().normalize();
    expect(dir.dot(new THREE.Vector3(0, -1, 0))).toBeGreaterThan(0.95);
  });

  it('keeps camera motion smooth during an interpolated climb at 144 Hz', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const wv = world.launch(buildOrbiter());
    const input = (stage = false) => neutralInput({ throttle: 1, sas: 'stabilityAssist', stage });
    world.tick(PHYSICS_DT, input(true));
    for (let i = 0; i < 300; i++) world.tick(PHYSICS_DT, input());
    const run = (interpolate: boolean) => {
      const w = world; // continue the same climb; compare consecutive windows
      const cam = new FlightCamera();
      const path: THREE.Vector3[] = [];
      for (let i = 0; i < 288; i++) {
        // Real displays jitter a little around their nominal refresh interval.
        const dt = (1 / 144) * (1 + 0.08 * Math.sin(i * 1.7));
        w.tick(dt, input());
        const { renderUt, restore } = interpolate ? w.renderHistory.apply(w.ut, PHYSICS_DT, w.renderAlpha, w.vessels.values(), w.universe.ephem) : { renderUt: w.ut, restore: () => {} };
        const body = w.universe.ephem.getBodyState(wv.body, renderUt);
        const r = sub(wv.state.position, body.position);
        const up = normalize(r);
        const n = normalize(cross(r, sub(wv.state.velocity, body.velocity)));
        const q = wv.state.orientation;
        cam.update(frame({ up: new THREE.Vector3(up.x, up.y, up.z), orbitNormal: new THREE.Vector3(n.x, n.y, n.z), vesselQuat: new THREE.Quaternion(q.x, q.y, q.z, q.w), radius: wv.state.cache.boundingRadius }), dt);
        // Camera position in the planet frame: vessel (rendered) + camera offset.
        path.push(new THREE.Vector3(r.x, r.y, r.z).add(cam.camera.position));
        restore();
      }
      const d: number[] = [];
      for (let i = 1; i < path.length; i++) d.push(path[i].distanceTo(path[i - 1]));
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      let worst = 0;
      for (let i = 1; i < d.length; i++) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
      return worst / mean;
    };
    const raw = run(false);
    const smooth = run(true);
    console.log(`camera judder at 144 Hz with ±8% frame jitter: raw ${raw.toFixed(3)} -> interpolated ${smooth.toFixed(3)}`);
    expect(smooth).toBeLessThan(0.2);
    expect(smooth).toBeLessThan(raw / 10);
  }, 60000);
});

describe('camera continuity across staging', () => {
  it('PivotSmoother eases a COM jump without overshoot', () => {
    const p = new PivotSmoother();
    p.update('a', { x: 0, y: 0, z: 0 }, 1 / 60);
    const o = p.update('a', { x: 0, y: 5, z: 0 }, 1 / 60);
    expect(o.y).toBeLessThan(-4.9); // still at the old COM right after the jump
    let prev = o.y, t95 = -1;
    for (let i = 2; i < 240; i++) {
      const y = p.update('a', { x: 0, y: 5, z: 0 }, 1 / 60).y;
      expect(y).toBeLessThanOrEqual(1e-12); // never past the new COM
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      if (t95 < 0 && y > -0.25) t95 = i / 60;
      prev = y;
    }
    expect(t95).toBeGreaterThan(0.8);
    expect(t95).toBeLessThan(2);
    expect(p.update('b', { x: 0, y: 0, z: 0 }, 1 / 60).y).toBe(0); // a vessel switch snaps
  });

  it('keeps the drawn vessel and the camera continuous when a stage drops', () => {
    const run = (smooth: boolean) => {
      const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
      world.commsSettings.enabled = false;
      const wv = world.launch(buildMoonLander());
      placeInCircularOrbit(world, wv, 'earth', 300000);
      world.tick(PHYSICS_DT, neutralInput({ stage: true })); // light the first stage; the next press decouples
      const cam = new FlightCamera();
      const pivot = new PivotSmoother();
      const root = wv.state.rootUid;
      let worstCam = 0, worstPart = 0, lastCam: THREE.Vector3 | null = null, lastPart: THREE.Vector3 | null = null, comShift = 0;
      for (let i = 0; i < 120; i++) {
        const dt = 1 / 120;
        const com0 = { ...wv.state.com };
        world.tick(dt, neutralInput({ stage: i === 30 }));
        comShift = Math.max(comShift, length(sub(wv.state.com, com0)));
        const { renderUt, restore } = world.renderHistory.apply(world.ut, PHYSICS_DT, world.renderAlpha, world.vessels.values(), world.universe.ephem);
        const body = world.universe.ephem.getBodyState('earth', renderUt);
        const r = sub(wv.state.position, body.position);
        const q = wv.state.orientation;
        const po = pivot.update(wv.state.id, wv.state.com, smooth ? dt : 10);
        const pw = qRotate(q, po);
        cam.update(frame({ up: new THREE.Vector3(...Object.values(normalize(r)) as [number, number, number]), vesselQuat: new THREE.Quaternion(q.x, q.y, q.z, q.w), radius: 8, vesselId: wv.state.id, pivot: new THREE.Vector3(pw.x, pw.y, pw.z), spaceBlend: 1 }), dt);
        const part = wv.state.cache.byUid.get(root)!;
        const pp = sub(bodyToWorld(wv.state, part.position), body.position);
        const partNow = new THREE.Vector3(pp.x, pp.y, pp.z);
        const camNow = new THREE.Vector3(r.x, r.y, r.z).add(cam.camera.position);
        restore();
        // Motion relative to the orbital drift of the drawn root part (the pod the player is looking at).
        if (lastCam && lastPart) {
          const drift = partNow.clone().sub(lastPart);
          worstCam = Math.max(worstCam, camNow.clone().sub(lastCam).sub(drift).length());
        }
        if (lastPart) worstPart = Math.max(worstPart, partNow.distanceTo(lastPart));
        lastCam = camNow; lastPart = partNow;
      }
      return { worstCam, worstPart, comShift };
    };
    const smooth = run(true);
    const raw = run(false);
    console.log(`Selene stage drop: COM shift ${smooth.comShift.toFixed(2)} m; worst camera step vs pod ${smooth.worstCam.toFixed(3)} m (unsmoothed ${raw.worstCam.toFixed(3)} m)`);
    expect(smooth.comShift).toBeGreaterThan(2);
    expect(smooth.worstCam).toBeLessThan(0.15);
    expect(raw.worstCam).toBeGreaterThan(smooth.comShift * 0.5);
    // The pod itself moves only with the orbit (~7.7 km/s / 120 Hz ≈ 64 m per frame), never with the COM jump.
    expect(smooth.worstPart).toBeLessThan(70);
  }, 60000);
});

describe('touchdown camera kick', () => {
  it('stays still for a gentle landing and kicks for a hard one', () => {
    const k = new TouchdownKick();
    const land = (sink: number) => {
      k.update('a', true, 0, 0.016);
      k.update('a', false, -sink, 0.016);
      return k.update('a', true, 0, 0.016);
    };
    expect(k.update('a', true, 0, 0.016)).toBe(0); // spawning on the ground is not a touchdown
    expect(land(1.2)).toBe(0);
    expect(land(5)).toBeGreaterThan(0.3);
    expect(land(20)).toBe(1);
  });
});
