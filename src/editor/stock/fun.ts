import { PART_CATALOG } from '../../data/parts';
import type { CraftDef } from '../../sim/vessel/types';
import { qFromAxisAngle } from '../../util/quat';
import { v3 } from '../../util/vec3';
import type { PartCatalog } from '../core';
import { Builder } from '../stockCrafts';

/**
 * Stock aircraft, rovers and "just for fun" vehicles. Each one shows off parts the rocket fleet never uses; the
 * spaceplane hangar convention applies to SPH craft (+Y forward, -Z down).
 */

/** Starting equipment only: six Sparkler motors round a liquid core, all lit at once. */
export function buildFizzwick(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Fizzwick Bundle', 'Six Sparkler solids strapped round a Gust core. Everything lights at once; separate the capsule at the top and float home.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const dec = b.stack(shield, 'dec-1');
  const tank = b.stack(dec, 'tank-1-mid');
  b.stack(tank, 'eng-gust');
  const sparkler = b.radial(tank, 'srb-sparkler', 6, -0.6, 30);
  b.outward(sparkler, 'fin-keel', -0.6);
  return b.done();
}

/** Stub fuselage, swept wings, all-moving elevon canards and tailplanes; beacon lamps on the wingtips. */
export function buildSkipjack(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Skipjack Stunt Plane', 'Light, overpowered aerobatic jet. Rotate at 55 m/s; loops and rolls need only a little stick.', 'SPH');
  const cockpit = b.root('cockpit-skylark');
  const fuse = b.stack(cockpit, 'fuse-spar-short');
  const jet = b.stack(fuse, 'jet-kittiwake');
  b.radial(fuse, 'intake-gill', 'mirror', 0.1, 55);
  const wing = b.radial(fuse, 'wing-swept', 'mirror', 0, 90, qFromAxisAngle(v3(0, 0, 1), (2 * Math.PI) / 180));
  b.radial(cockpit, 'ctrl-elevon', 'mirror', -0.6, 90);
  b.radial(jet, 'ctrl-elevon', 'mirror', -0.95, 90);
  b.radial(jet, 'tail-hawk', 1, -0.5, 0);
  b.radial(cockpit, 'gear-trundle', 1, -0.45, 180);
  const w = b.part(wing);
  b.surface(wing, 'gear-skid', v3(w.position.x - 0.9, w.position.y - 0.3, w.position.z - 0.06), v3(0, 0, -1), 'mirror');
  return b.done();
}

/** Land-speed dragster: canopy cockpit on two rover decks, Boulder wheels and a turbofan pushing from behind. */
export function buildSaltstreak(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Saltstreak Jet Dragster', 'Turbofan on wheels, delivered at 40 % thrust. Hold B, stage the jet, open the throttle and release; brake before the runway ends.', 'SPH');
  const front = b.root('rover-chassis');
  b.stack(front, 'cockpit-skylark', 'top');
  const rear = b.stack(front, 'rover-chassis');
  // Front tyres stay under the deck, clear of the cockpit; the rear pair sits under the jet's weight.
  wheels(b, [[front, 0.6], [rear, -0.3]]);
  const fuse = b.stack(rear, 'fuse-spar-short');
  const jet = b.stack(fuse, 'jet-kittiwake');
  b.radial(fuse, 'intake-gill', 'mirror', 0, 60);
  b.radial(fuse, 'tail-hawk', 1, 0, 0);
  b.surface(front, 'light-area', v3(0, b.part(front).position.y + 0.6, 0.175), v3(0, 0, 1), 1);
  // Delivered at 40 % thrust: a stop inside the runway. Full thrust is the player's dare.
  const craft = b.done();
  craft.parts.find(p => p.uid === jet)!.tweaks = { thrustLimit: 0.4 };
  return craft;
}

/** Three rover decks end to end on six Boulder wheels, carrying every surface instrument. */
export function buildTrekker(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Trekker Field Lab', 'Six-wheel science rover. Drive to new ground and run the pressure, seismic, magnetic and gravity instruments. Works on any solid world.', 'SPH');
  const front = b.root('rover-chassis');
  b.stack(front, 'probe-pebble', 'top');
  const middle = b.stack(front, 'rover-chassis');
  const rear = b.stack(middle, 'rover-chassis');
  outriggerWheels(b, [[front, 0], [middle, 0], [rear, 0]]);
  const top = (deck: number, x: number, dy: number, id: string) => b.surface(deck, id, v3(x, b.part(deck).position.y + dy, 0.175), v3(0, 0, 1), 1);
  top(front, 0.45, 0.5, 'sensor-pressure');
  top(front, -0.45, 0.5, 'sensor-thermal');
  top(middle, 0.45, 0.5, 'sensor-magnetic');
  top(middle, -0.45, 0.5, 'sensor-gravity');
  top(rear, 0, 0.6, 'sensor-seismic');
  b.surface(middle, 'solar-wing', v3(0, b.part(middle).position.y - 0.4, 0.175), v3(0, 0, 1), 1);
  top(rear, 0, -0.5, 'antenna-thread');
  for (const x of [-0.5, 0.5]) b.surface(front, 'light-task', v3(x, 1, 0.05), v3(0, 1, 0), 1);
  return b.done();
}

/** Powered Boulder wheels under the deck edges, mirrored left/right, `dy` metres along each deck. */
function wheels(b: Builder, at: [number, number][]) {
  for (const [deck, dy] of at) b.surface(deck, 'rover-wheel-1', v3(0.75, b.part(deck).position.y + dy, -0.175), v3(0, 0, -1), 'mirror');
}

/** Boulder wheels hung from deck-panel outriggers: a 2.5 m track instead of the deck's 1.5 m, so turns stay upright. */
function outriggerWheels(b: Builder, at: [number, number][]) {
  for (const [deck, dy] of at) {
    const y = b.part(deck).position.y + dy;
    const panel = b.surface(deck, 'panel-1', v3(0.75, y, -0.175), v3(0, 0, -1), 'mirror');
    // The mirrored panel takes its copy of the wheel automatically.
    b.surface(panel, 'rover-wheel-1', v3(1.25, y, -0.255), v3(0, 0, -1), 'mirror');
  }
}

/** Hover test rig: four throttleable radial engines, sturdy legs and floodlamps. */
export function buildCricket(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Cricket Hopper', 'Crewed hover rig. Throttle to about 45 % to hang in the air, lean to drift and set down on the legs.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const tank = b.stack(pod, 'tank-1-mid');
  b.radial(tank, 'eng-radial-rill', 4, -0.2, 45);
  b.radial(tank, 'leg-strider', 4, -0.2, 0);
  b.radial(pod, 'light-area', 4, -0.4, 45);
  return b.done();
}
