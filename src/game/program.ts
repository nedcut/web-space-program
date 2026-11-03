import { game, enterProgram, DEFAULT_START_UT } from './store';
import { World } from './world';
import { Universe } from './universe';
import { PART_CATALOG } from '../data/parts';
import type { GameMode } from '../sim/science/progression';
import type { ScalePresetId } from '../sim/bodies/scale';
import { deserializeWorld, serializeWorld, trySaveWorld } from './persistence';
/** Scenes exchange immutable snapshots; only the mounted scene owns a mutable World. */
export function openProgram(): World {
  const s = game.get();
  return s.resumeWorld ? deserializeWorld(s.resumeWorld, PART_CATALOG) : new World(new Universe(s.scalePreset), PART_CATALOG, s.ut, s.mode);
}
export function saveProgram(world: World) {
  game.set({ resumeWorld: serializeWorld(world), mode: world.mode, ut: world.ut });
  // The snapshot above keeps progress for this session; a failed write only raises a notification.
  trySaveWorld('autosave', world);
}

/** New game: a fresh program becomes current, ending any lesson, challenge or multiplayer room. */
export function startProgram(mode: GameMode, scale: ScalePresetId) {
  const world = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT, mode);
  // Program-scoped lookups isolate old quicksaves; retain them for legacy migration.
  // Clear the editor with the program switch so neither the first autosave nor the
  // new program's draft inherits the previous program's craft.
  enterProgram({ saveId: `${mode}-${Date.now()}`, craft: null });
  saveProgram(world);
  game.set({ mode, scalePreset: scale, craft: null, launchPending: false, ut: DEFAULT_START_UT, scene: 'spaceCenter' });
}
