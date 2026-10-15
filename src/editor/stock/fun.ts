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

/** Stub fuselage, swept wings, all-moving elevon canards and tailplanes. */
export function buildSkipjack(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Skipjack Stunt Plane', 'Light, overpowered aerobatic jet. Rotate at 60 m/s; it loops and rolls on a little stick.', 'SPH');
  const cockpit = b.root('cockpit-skylark');
  const fuse = b.stack(cockpit, 'fuse-spar-short');
  const jet = b.stack(fuse, 'jet-kittiwake');
  b.radial(fuse, 'intake-gill', 'mirror', 0.1, 55);
  const wing = b.radial(fuse, 'wing-swept', 'mirror', 0, 90, qFromAxisAngle(v3(0, 0, 1), (2 * Math.PI) / 180));
  b.radial(cockpit, 'ctrl-elevon', 'mirror', -0.6, 90);
  b.radial(jet, 'ctrl-elevon', 'mirror', -0.95, 90);
  b.radial(jet, 'tail-hawk', 1, -0.5, 0);
  // Swift's tricycle layout: steerable nose wheel, braked mains under the wings just behind the centre of mass.
  b.radial(cockpit, 'gear-trundle', 1, -0.45, 180);
  const w = b.part(wing);
  b.surface(wing, 'gear-bogie', v3(w.position.x - 1, w.position.y - 0.65, w.position.z - 0.06), v3(0, 0, -1), 'mirror');
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

/**
 * Twin-jet freighter: fuel spar behind the cockpit, a 2.5 m cargo bay carrying a small fuel-cell rover on a side latch,
 * podded turbofans under the wings and a tailcone. Land, open the bay, release the rover and drive it out.
 */
export function buildPackmule(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Packmule Freighter', 'Twin-jet cargo plane with a rover in its bay. Rotate at 80 m/s. After landing, press 1 to open the bay and stage to drop the rover.', 'SPH');
  const cockpit = b.root('cockpit-skylark');
  const fuel = b.stack(cockpit, 'fuse-spar');
  const taper = b.stack(fuel, 'adapt-1-2');
  const bay = b.stack(taper, 'bay-cargo-2');
  const narrow = b.stack(bay, 'adapt-1-2', 'bottom', 'bottom');
  b.stack(narrow, 'fuse-tailcone', 'top', 'top');
  b.radial(fuel, 'intake-gill', 'mirror', -0.6, 70);
  b.radial(taper, 'ctrl-elevon', 'mirror', -0.3, 90);
  b.radial(bay, 'wing-broadleaf', 'mirror', 0.6, 90, qFromAxisAngle(v3(0, 0, 1), (3 * Math.PI) / 180));
  // Pods hang just under the wing: low enough to clear it, high enough not to lift the nose at full thrust.
  b.radial(bay, 'jet-kittiwake', 'mirror', -0.2, 115);
  b.radial(narrow, 'tail-hawk', 1, 0, 0);
  b.radial(narrow, 'tail-hawk', 'mirror', 0, 90);
  // Bogie nose gear on the taper, mounted as deep as the mains so the fuselage sits level.
  b.radial(taper, 'gear-bogie', 1, -0.31, 180);
  const y = b.part(bay).position.y;
  // Mains 0.75 m behind the centre of mass (the pods' thrust line is below it), inboard of the pods.
  b.surface(bay, 'gear-bogie', v3(0.6, y + 0.1, -Math.sqrt(1.25 ** 2 - 0.6 ** 2)), v3(0, 0, -1), 'mirror');
  // Rover: latch under the bay roof, a fuel thimble as its nose, deck, probe core at the back and four Pebble wheels.
  // The deck rides 0.15 m below the bay axis so the tyres stay inside the bay's curved floor.
  const latch = b.surface(bay, 'dec-radial', v3(0, y + 1.2, -0.15 + 0.3125 + 0.24), v3(0, 0, -1), 1);
  const nose = b.outward(latch, 'tank-0-short');
  const deck = b.stack(nose, 'rover-chassis', 'bottom', 'top');
  b.stack(deck, 'probe-pebble');
  const dy = b.part(deck).position.y, dz = b.part(deck).position.z;
  for (const at of [-0.55, 0.55]) b.surface(deck, 'rover-wheel-0', v3(0.75, dy + at, dz - 0.175), v3(0, 0, -1), 'mirror');
  b.surface(deck, 'fuelcell-1', v3(0, dy - 0.5, dz + 0.175), v3(0, 0, 1), 1);
  for (const p of b.ed.craft.parts) {
    if (p.partId === 'jet-kittiwake') b.stages.set(p.partId, 1);
    if (p.partId === 'dec-radial') b.stages.set(p.partId, 0);
  }
  const craft = b.done();
  // Action group 1 opens and closes the bay doors.
  craft.parts.find(p => p.uid === bay)!.actions = { custom1: ['deploy.toggle'] };
  return craft;
}
