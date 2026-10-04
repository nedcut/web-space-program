import type { Astronaut, PlantedFlag } from '../sim/crew/crew';
import type { VesselState } from '../sim/vessel/runtime';
import type { PartDef } from '../sim/vessel/types';
import { rebuildTopology } from '../sim/vessel';
import type { ManeuverNode, Orbit } from '../sim/orbit/api';
import type { Quat } from '../util/quat';
import type { Vec3 } from '../util/vec3';
import { RESOURCES } from '../data/resources';
import { World, type VesselMode, type WorldVessel } from './world';
import { Universe } from './universe';
import type { ScalePresetId } from '../sim/bodies/scale';

/**
 * World (de)serialization. Vessel runtime state is plain data except for `def` (catalog reference),
 * `resourceDefs` and `cache` (derived) — those are stripped on save and rebuilt on load.
 * Format is versioned; this is also the wire format a future multiplayer server can use.
 */
export const SAVE_VERSION = 1;

interface SavedVessel {
  state: Omit<VesselState, 'cache' | 'resourceDefs' | 'parts'> & { parts: Omit<VesselState['parts'][number], 'def'>[] };
  mode: VesselMode;
  body: string;
  orbit?: Orbit;
  fixed?: { pos: Vec3; orient: Quat };
}

export interface SavedWorld {
  crew?: Astronaut[];
  crewSeed?: number;
  flags?: PlantedFlag[];
  version: number;
  preset: ScalePresetId;
  ut: number;
  activeId: string | null;
  nodes: ManeuverNode[];
  vessels: SavedVessel[];
  /** Navigation target (vessel or body id) and optional docking port uid. Absent in older saves. */
  targetId?: string | null;
  targetPortUid?: number | null;
}

export function serializeWorld(world: World): SavedWorld {
  const vessels: SavedVessel[] = [];
  for (const wv of world.vessels.values()) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cache, resourceDefs, parts, ...rest } = wv.state;
    void cache;
    void resourceDefs;
    vessels.push({
      state: {
        ...structuredClone(rest),
        parts: parts.map(({ def, ...p }) => {
          void def;
          return structuredClone(p);
        }),
      },
      mode: wv.mode,
      body: wv.body,
      orbit: wv.orbit ? { ...wv.orbit } : undefined,
      fixed: wv.fixed ? structuredClone(wv.fixed) : undefined,
    });
  }
  return {
    crew: structuredClone(world.crew),
    crewSeed: world.crewSeed,
    flags: structuredClone(world.flags),
    version: SAVE_VERSION,
    preset: world.universe.preset,
    ut: world.ut,
    activeId: world.activeId,
    nodes: structuredClone(world.nodes),
    vessels,
    targetId: world.targetId,
    targetPortUid: world.targetPortUid,
  };
}

export function deserializeWorld(data: SavedWorld, catalog: Map<string, PartDef>, universe?: Universe): World {
  if (data.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${data.version}`);
  const world = new World(universe ?? new Universe(data.preset), catalog, data.ut);
  world.crew = structuredClone(data.crew ?? []);
  world.crewSeed = data.crewSeed ?? world.crewSeed;
  world.flags = structuredClone(data.flags ?? []);
  for (const sv of structuredClone(data.vessels)) {
    const parts = sv.state.parts.map((p) => {
      const def = world.catalog.get(p.partId);
      if (!def) throw new Error(`Save references unknown part ${p.partId}`);
      return { ...p, def };
    });
    const state = { ...sv.state, parts, resourceDefs: RESOURCES, cache: undefined } as unknown as VesselState;
    rebuildTopology(state);
    if (!data.crew) world.assignCrew(state);
    const wv: WorldVessel = { state, mode: sv.mode, body: sv.body, orbit: sv.orbit, fixed: sv.fixed };
    world.vessels.set(state.id, wv);
  }
  world.activeId = data.activeId && world.vessels.has(data.activeId) ? data.activeId : null;
  world.nodes = data.nodes ?? [];
  world.setTarget(data.targetId ?? null, data.targetPortUid ?? null);
  world.restoreAfterLoad();
  return world;
}

const KEY_PREFIX = 'wsp.world.v1.';

export function saveWorldToStorage(slot: string, world: World) {
  localStorage.setItem(KEY_PREFIX + slot, JSON.stringify({ savedAt: Date.now(), data: serializeWorld(world) }));
}

export function loadWorldFromStorage(slot: string): { savedAt: number; data: SavedWorld } | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + slot);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasSave(slot: string) {
  return typeof localStorage !== 'undefined' && localStorage.getItem(KEY_PREFIX + slot) !== null;
}
