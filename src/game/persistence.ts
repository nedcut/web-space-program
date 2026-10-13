import { localId } from '../util/localId';
import { draftForSave, game, loadLastCraft, reportSaveError } from './store';
import { SLOTS_KEY, commitSaveSlot, deferSaveWrite, flushSaveWrites, listSaveSlots, sceneForSave, saveSlotJson, type SaveScene, type SaveSlot } from './saveSlots';
import { careerScaleMultiplier } from '../sim/bodies/scale';
import { newProgression, type GameMode, type Progression } from '../sim/science/progression';
import { LEGACY_FACILITIES } from '../sim/science/facilities';
import type { Astronaut, PlantedFlag } from '../sim/crew/crew';
import type { VesselState } from '../sim/vessel/runtime';
import type { PartDef } from '../sim/vessel/types';
import { rebuildTopology, recomputeMassProperties, retractablePanel } from '../sim/vessel';
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
  alarms?: import('./alarms').MissionAlarm[];
  seenTips?: string[];
  preciseGravity?: boolean;
  showLagrangePoints?: boolean;
  activatedAsteroids?: string[];
  flightlog?: import('./flightlog/recorder').RecorderState;
  latestReportId?: string | null;
  commsSettings?: import('../sim/comms/network').CommsSettings;
  transmitting?: string[];
  surveyedBodies?: string[];
  discoveries?: string[];
  mode?: GameMode;
  progression?: Progression;
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
      // Deep: deferred autosaves serialise this snapshot after the world has moved on.
      orbit: wv.orbit ? structuredClone(wv.orbit) : undefined,
      fixed: wv.fixed ? structuredClone(wv.fixed) : undefined,
    });
  }
  return {
    ...(world.preciseGravity ? { preciseGravity: true } : {}),
    ...(world.showLagrangePoints ? { showLagrangePoints: true } : {}),
    alarms: structuredClone(world.alarmClock.alarms),
    seenTips: [...world.seenTips],
    flightlog: structuredClone(world.flightlog),
    latestReportId: world.latestReportId,
    commsSettings: { ...world.commsSettings },
    transmitting: [...world.transmitting],
    surveyedBodies: [...world.surveyedBodies],
    mode: world.mode,
    progression: structuredClone(world.progression),
    crew: structuredClone(world.crew),
    crewSeed: world.crewSeed,
    flags: structuredClone(world.flags),
    discoveries: [...world.discoveries],
    version: SAVE_VERSION,
    preset: world.universe.preset,
    ut: world.ut,
    activeId: world.activeId,
    nodes: structuredClone(world.nodes),
    vessels,
    targetId: world.targetId,
    targetPortUid: world.targetPortUid,
    activatedAsteroids: [...world.universe.activatedAsteroids],
  };
}

export function deserializeWorld(data: SavedWorld, catalog: Map<string, PartDef>, universe?: Universe): World {
  if (data.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${data.version}`);
  const world = new World(universe ?? new Universe(data.preset), catalog, data.ut, data.mode ?? 'sandbox');
  world.alarmClock.restore(data.alarms ?? []);
  world.seenTips = (data.seenTips ?? []).filter(id => typeof id === 'string');
  for (const id of data.activatedAsteroids ?? []) world.universe.activateAsteroid(id);
  world.preciseGravity = data.preciseGravity === true;
  world.showLagrangePoints = data.showLagrangePoints === true;
  world.flightlog = structuredClone(data.flightlog ?? world.flightlog);
  world.latestReportId = data.latestReportId ?? null;
  world.commsSettings = { ...world.commsSettings, ...data.commsSettings };
  world.transmitting = [...(data.transmitting ?? [])];
  world.surveyedBodies = [...(data.surveyedBodies ?? [])];
  world.progression = structuredClone(data.progression ?? newProgression(careerScaleMultiplier(world.universe.preset)));
  // Programs saved before facility upgrades keep everything they could launch (see LEGACY_FACILITIES).
  if (!data.progression?.facilities) world.progression.facilities = { ...LEGACY_FACILITIES };
  if (world.mode === 'career' && !world.progression.contracts.length) world.refreshContracts();
  world.crew = structuredClone(data.crew ?? []);
  world.crewSeed = data.crewSeed ?? world.crewSeed;
  world.flags = structuredClone(data.flags ?? []);
  world.discoveries = [...new Set(data.discoveries ?? [])];
  for (const sv of structuredClone(data.vessels)) {
    const parts = sv.state.parts.map((p) => {
      const def = world.catalog.get(p.partId);
      if (!def) throw new Error(`Save references unknown part ${p.partId}`);
      // Saves from before stowed-by-default arrays/antennas (no deploy progress): hardware already flying stays
      // extended as it was; a craft still waiting on the pad takes the new stowed default.
      if (p.panelDeploy === undefined && retractablePanel(def)) {
        const extended = p.tweaks?.extended ?? sv.mode !== 'prelaunch';
        return { ...p, def, tweaks: { ...p.tweaks, extended }, panelDeploy: extended ? 1 : 0 };
      }
      return { ...p, def };
    });
    const state = { ...sv.state, parts, resourceDefs: RESOURCES, cache: undefined } as unknown as VesselState;
    rebuildTopology(state);
    if (!data.crew) world.assignCrew(state);
    recomputeMassProperties(state, false);
    const wv: WorldVessel = { state, mode: sv.mode, body: sv.body, orbit: sv.orbit, fixed: sv.fixed };
    world.vessels.set(state.id, wv);
  }
  world.activeId = data.activeId && world.vessels.has(data.activeId) ? data.activeId : null;
  world.nodes = structuredClone(data.nodes ?? []);
  world.setTarget(data.targetId ?? null, data.targetPortUid ?? null);
  world.restoreAfterLoad();
  return world;
}

const KEY_PREFIX = 'wsp.world.v1.';

export interface SaveOptions {
  /**
   * Snapshot now, then serialise and write on later idle tasks (flight autosave: no frame pays for persistence).
   * Errors go to `onError`; readers and other saves flush the queue first, so order and visibility are unchanged.
   */
  defer?: boolean;
  /** Scene Load returns to. Default: flight when the player is in flight right now, otherwise the Space Center. */
  scene?: SaveScene;
  onError?: (e: unknown) => void;
}

export function saveWorldToStorage(slot: string, world: World, displayName?: string, options: SaveOptions = {}) {
  // The snapshot and slot identity are taken synchronously: the world and store keep changing afterwards.
  const data = serializeWorld(world), savedAt = Date.now();
  const programId = game.get().saveId ?? 'legacy-program';
  // The editor draft travels with the program save so Load restores this program's craft.
  const craft = game.get().trainingActive || game.get().scenarioActive ? loadLastCraft(programId) : game.get().craft;
  const saved: SaveSlot = { id: slot === 'autosave' ? localId() : `${programId}:${slot}`, programId, name: displayName ?? (slot === 'autosave' ? 'Autosave' : slot === 'quicksave' ? 'Quicksave' : slot), kind: slot === 'autosave' ? 'auto' : 'manual', savedAt, data, craft, scene: options.scene ?? (game.get().scene === 'flight' ? 'flight' : 'spaceCenter') };
  let dataJson = '', failed = false;
  const steps = [
    () => { dataJson = JSON.stringify(data); },
    () => {
      // Preserve pre-slot programs before replacing the legacy compatibility keys.
      if (localStorage.getItem(SLOTS_KEY) === null) for (const legacyName of ['autosave', 'quicksave']) {
        const raw = localStorage.getItem(KEY_PREFIX + legacyName);
        if (raw) {
          try {
            const legacy = JSON.parse(raw) as { savedAt: number; data: SavedWorld };
            const old: SaveSlot = { id: `legacy-program:${legacyName}`, programId: 'legacy-program', name: legacyName === 'autosave' ? 'Autosave' : 'Quicksave', kind: legacyName === 'autosave' ? 'auto' : 'manual', ...legacy };
            if (legacy.data?.version === SAVE_VERSION) commitSaveSlot(old, localStorage, saveSlotJson(old));
          } catch { /* A corrupt old save must not prevent a new program from saving. */ }
        }
      }
      commitSaveSlot(saved, localStorage, saveSlotJson(saved, dataJson));
    },
    // Same text as JSON.stringify({ savedAt, data }), without serialising the world twice.
    () => localStorage.setItem(KEY_PREFIX + slot, `{"savedAt":${JSON.stringify(savedAt)},"data":${dataJson}}`),
  ];
  if (!options.defer) {
    flushSaveWrites();
    for (const step of steps) step();
    return;
  }
  for (const step of steps) deferSaveWrite(() => {
    if (failed) return;
    try { step(); } catch (e) { failed = true; (options.onError ?? reportSaveError)(e); }
  });
}

export function loadWorldFromStorage(slot: string): { savedAt: number; data: SavedWorld } | null {
  try {
    flushSaveWrites();
    const programId = game.get().saveId ?? 'legacy-program';
    const saved = listSaveSlots().find(x => x.programId === programId && (slot === 'autosave' ? x.kind === 'auto' : x.id === `${programId}:${slot}`));
    if (saved) return { savedAt: saved.savedAt, data: saved.data };
    // Only an unmigrated legacy program may read the compatibility keys. A new
    // or deleted program must never fall back to another program's last save.
    if (programId !== 'legacy-program' || localStorage.getItem(SLOTS_KEY) !== null) return null;
    const raw = localStorage.getItem(KEY_PREFIX + slot);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasSave(slot: string) {
  return typeof localStorage !== 'undefined' && loadWorldFromStorage(slot) !== null;
}

export function deleteSave(slot: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + slot);
  } catch {
    /* storage unavailable */
  }
}


/** Never throws: a failed write (full or blocked storage) is reported as a notification and play/navigation continues. */
export function trySaveWorld(slot: string, world: World, displayName?: string, options?: SaveOptions): boolean {
  try {
    saveWorldToStorage(slot, world, displayName, options);
    return true;
  } catch (e) {
    reportSaveError(e);
    return false;
  }
}

/** Manual names cannot collide with the reserved autosave/quicksave channels. */
export function saveNamedWorld(name: string, world: World) {
  name = name.trim().slice(0, 200);
  if (!name) throw new Error('A save slot needs a name.');
  saveWorldToStorage(`manual:${name}`, world, name);
}

/** Resume a save: straight into the flight it was made in, else the Space Center. */
export function resumeSave(slot: SaveSlot) {
  game.set({ saveId: slot.programId, resumeWorld: slot.data, mode: slot.data.mode ?? 'sandbox', scalePreset: slot.data.preset, ut: slot.data.ut, launchPending: false, craft: draftForSave(slot), scene: sceneForSave(slot) });
}
