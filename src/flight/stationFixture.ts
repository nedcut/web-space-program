import { Builder } from '../editor/stockCrafts';
import { buildTender } from '../editor/stockCrafts';
import { PART_CATALOG } from '../data/parts';
import type { PartCatalog } from '../editor/core';
import { spawnRendezvousTarget } from '../game/scenarios';
import type { World, WorldVessel } from '../game/world';
import { freePorts, mergeVessels, recomputeMassProperties } from '../sim/vessel';
import type { CraftDef } from '../sim/vessel/types';
import { add, scale, v3 } from '../util/vec3';

/**
 * A small docked outpost for tests and the `?scenario=station` dev start: a crew-cabin core with two collars, a
 * one-seat ferry docked on top (its far collar free) and a probe tug docked below. Original designs, 1.25 m ports.
 */
export function buildOutpostCore(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Bellweather Core', 'Test outpost core: four-seat cabin between two collars.');
  const core = b.root('probe-cairn');
  b.stack(core, 'dock-1', 'top');
  const cap = b.stack(core, 'adapt-1-2');
  const cabin = b.stack(cap, 'cabin-wayfarer');
  b.radial(cabin, 'solar-grand-1', 2, 0, 90);
  b.radial(cabin, 'rcs-nudge', 4, 1, 45);
  const battery = b.stack(cabin, 'battery-bank-2');
  const narrow = b.stack(battery, 'adapt-1-2', 'bottom', 'bottom');
  b.stack(narrow, 'dock-1', 'top', 'bottom');
  return b.done();
}

export function buildLanternFerry(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Lantern Ferry', 'Test one-seat ferry with a collar at each end.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'dock-1', 'top');
  const tank = b.stack(pod, 'mono-bagel');
  b.stack(tank, 'dock-1', 'bottom', 'bottom');
  return b.done();
}

/** Spawn `craft` at `wv` and dock its first free port to `keep`'s port `keepPortUid` (snapped into contact). */
function dockNew(world: World, keep: WorldVessel, keepPortUid: number, craft: CraftDef, name: string, port = 0): void {
  const s = keep.state;
  const nv = world.spawnVessel(craft, { position: add(s.position, scale(v3(1, 0, 0), 30)), velocity: { ...s.velocity }, orientation: { ...s.orientation } }, name);
  mergeVessels(s, nv.state, keepPortUid, freePorts(nv.state)[port].part.uid);
  world.vessels.delete(nv.state.id);
}

/**
 * Build the outpost `ahead` metres along the active vessel's orbit and target its free collar. Two cabin seats are
 * left empty so crew transfers have somewhere to go. Returns the outpost.
 */
export function spawnTestOutpost(world: World, ahead = 60, catalog: PartCatalog = PART_CATALOG): WorldVessel | null {
  const core = spawnRendezvousTarget(world, buildOutpostCore(catalog), ahead);
  if (!core) return null;
  core.state.name = 'Bellweather Outpost';
  const [top, bottom] = freePorts(core.state).sort((a, b) => b.posBody.y - a.posBody.y);
  dockNew(world, core, top.part.uid, buildLanternFerry(catalog), 'Lantern Ferry');
  dockNew(world, core, bottom.part.uid, buildTender(catalog), 'Wren Tender');
  const cabin = core.state.parts.find(p => p.partId === 'cabin-wayfarer');
  if (cabin?.crew && cabin.crew.length > 2) {
    const gone = cabin.crew.splice(2);
    world.crew = world.crew.filter(c => !gone.includes(c.id));
  }
  recomputeMassProperties(core.state, true);
  const free = freePorts(core.state)[0];
  world.setTarget(core.state.id, free ? free.part.uid : null);
  return core;
}
