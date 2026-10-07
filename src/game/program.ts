import { game } from './store';
import { World } from './world';
import { Universe } from './universe';
import { PART_CATALOG } from '../data/parts';
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
