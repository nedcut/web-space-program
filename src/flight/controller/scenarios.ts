import { placeInCircularOrbit, spawnRendezvousTarget } from '../../game/scenarios';
import { quatFromBasis } from '../../game/world';
import { qRotate } from '../../util/quat';
import { add, cross, normalize, scale, sub, v3 } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { FlightControllerInternals } from './internals';

/** Dev/test scenarios (URL ?scenario=): reposition the active vessel. */
export function devScenario(this: FlightController, internals: FlightControllerInternals, name: string): void {
  if (this.network) return;
  const wv = this.world.active;
  if (!wv) return;
  if (name === 'rendezvous') {
    placeInCircularOrbit(this.world, wv, 'earth', Math.max(90000, this.world.universe.body('earth').atmosphere!.height + 80000));
    if (internals.craft && spawnRendezvousTarget(this.world, internals.craft, 100)) {
      this.speedMode = 'target';
      this.dockingMode = true;
      this.sasOn = true;
      this.sas = 'target';
      this.world.message('Rendezvous: target 100 m ahead. R = RCS, I/K J/L H/N translate.', 'info', 8);
    }
    return;
  }
  const u = this.world.universe;
  const t = this.world.ut;
  const bodyId = name === 'moon' ? 'moon' : 'earth';
  const b = u.body(bodyId);
  const bs = u.ephem.getBodyState(bodyId, t);
  const up = normalize(sub(wv.state.position, u.ephem.getBodyState(wv.body, t).position));
  const pole = qRotate(u.ephem.bodyRotation(bodyId, t), v3(0, 0, 1));
  const east = normalize(cross(pole, up));
  let alt = 0;
  let vel = v3();
  if (name === 'reentry') { alt = b.atmosphere!.height * 0.6; vel = add(scale(east, Math.sqrt(b.gm / (b.radius + alt)) * 0.98), scale(up, -150)); }
  if (name === 'orbit') { alt = Math.max(90000, b.atmosphere!.height + 80000); vel = scale(east, Math.sqrt(b.gm / (b.radius + alt))); }
  if (name === 'moon') { alt = 20000; vel = scale(east, Math.sqrt(b.gm / (b.radius + 20000))); }
  // High circular orbit that permits every rails warp level (benchmarks: 100 000× and above).
  if (name === 'highorbit') { alt = Math.max(1_500_000, b.radius * 2.5); vel = scale(east, Math.sqrt(b.gm / (b.radius + alt))); }
  let surfaceDir = up;
  if (name === 'sea') {
    // Low over the sea ~40 km east of the launch site, co-rotating, lobbed upwards (splashdown/sea rendering checks).
    const a = 40000 / b.radius;
    surfaceDir = normalize(add(scale(up, Math.cos(a)), scale(east, Math.sin(a))));
    alt = 400;
    const omega = (2 * Math.PI) / b.rotationPeriod;
    vel = add(scale(cross(pole, surfaceDir), omega * (b.radius + alt)), scale(surfaceDir, 70));
  }
  wv.mode = 'physics';
  wv.fixed = undefined;
  wv.body = bodyId;
  wv.state.position = add(bs.position, scale(surfaceDir, b.radius + alt));
  wv.state.velocity = add(bs.velocity, vel);
  wv.state.situation = 'flying';
  // Point retrograde-ish for re-entry, prograde otherwise.
  const fwd = name === 'reentry' ? normalize(scale(vel, -1)) : normalize(vel);
  const side = normalize(cross(fwd, up));
  wv.state.orientation = quatFromBasis(side, fwd, cross(side, fwd));
  wv.state.angularVelocity = v3();
}
