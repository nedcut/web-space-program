import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildTender } from '../src/editor/stockCrafts';
import { navball } from '../src/flight/controller/navball';
import type { NavballMarker } from '../src/flight/hud/navball';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../src/game/scenarios';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { neutralInput } from '../src/sim/vessel';
import { add, dot, normalize, scale, sub, type Vec3 } from '../src/util/vec3';

const internals = { maneuverDirection: () => null };
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
function marker(markers: NavballMarker[], kind: NavballMarker['kind']) {
  const found = markers.find(m => m.kind === kind);
  if (!found) throw new Error(`Missing ${kind} marker`);
  return found.dir;
}

function rendezvous(port: boolean) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const own = world.launch(buildTender());
  placeInCircularOrbit(world, own, 'earth', 142000);
  const target = spawnRendezvousTarget(world, buildTender(), 65)!;
  const along = normalize(world.relativeState(own).velocity);
  const up = normalize(world.relativeState(own).position);
  target.state.position = add(own.state.position, add(scale(along, 60), scale(up, 25)));
  target.state.velocity = add(own.state.velocity, scale(along, 0.5));
  if (!port) world.setTarget(target.state.id);
  return { world, own, target };
}

describe('near-target navball in flight', () => {
  for (const port of [false, true]) for (const hz of [60, 120, 144]) {
    it(`keeps ${port ? 'port' : 'vessel'} markers stable at ${hz} Hz and agrees with map and telemetry`, () => {
      const { world, own, target } = rendezvous(port);
      const flight = { world, speedMode: 'target', mapMode: false, network: null } satisfies ThisParameterType<typeof navball>;
      let last: Vec3 | null = null;
      let maxStep = 0;
      let maxMismatch = 0;
      let maxVelocityError = 0;
      for (let i = 0; i < hz; i++) {
        world.tick(1 / hz, neutralInput());
        const ownPosition = own.state.position, targetPosition = target.state.position;
        const ownOrientation = own.state.orientation, velocity = own.state.velocity;
        const current = navball.call(flight, internals)!;
        expect(own.state.position).toBe(ownPosition);
        expect(own.state.orientation).toBe(ownOrientation);
        expect(own.state.velocity).toBe(velocity);
        expect(target.state.position).toBe(targetPosition);
        const map = navball.call({ ...flight, mapMode: true }, internals)!;
        const direction = marker(current.markers, 'target');
        if (last) maxStep = Math.max(maxStep, angle(direction, last));
        last = direction;
        maxMismatch = Math.max(maxMismatch, angle(direction, marker(map.markers, 'target')));
        const ts = world.targetState()!;
        const expectedPro = normalize(sub(own.state.velocity, ts.velocity));
        maxVelocityError = Math.max(maxVelocityError, angle(marker(current.markers, 'prograde'), expectedPro));
        expect(angle(marker(current.markers, 'antiTarget'), scale(direction, -1))).toBeLessThan(0.00001);
        expect(angle(marker(current.markers, 'retrograde'), scale(expectedPro, -1))).toBeLessThan(0.00001);
      }
      console.log(`${port ? 'port' : 'vessel'} ${hz}Hz: max target step ${maxStep.toFixed(6)} deg; flight/map mismatch ${maxMismatch.toFixed(6)} deg; relative velocity error ${maxVelocityError.toFixed(6)} deg`);
      expect(maxVelocityError).toBeLessThan(0.00001);
      expect(maxMismatch).toBeLessThan(0.00001);
      expect(maxStep).toBeLessThan(0.02);
    });
  }
});
