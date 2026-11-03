import { game, type Scene } from '../../game/store';
import { serializeWorld, trySaveWorld } from '../../game/persistence';
import type { World } from '../../game/world';

/** Worlds leaveTracking already saved: the scene's unmount handoff skips them, so one exit saves once. */
const handedOff = new WeakSet<World>();
/** Hand the tracked world to the rest of the game; a failed autosave (full storage) never blocks this. */
export function persistTracking(world: World) {
  if (handedOff.has(world)) return;
  game.set({ resumeWorld: serializeWorld(world), mode: world.mode, ut: world.ut });
  trySaveWorld('autosave', world);
}
export type TrackingExit = Extract<Scene, 'spaceCenter' | 'flight' | 'pedia' | 'flightlog' | 'editor' | 'research' | 'missions'>;
export function leaveTracking(world: World, scene: TrackingExit) {
  world.warp = { mode: 'rails', index: 0 };
  trySaveWorld('autosave', world, undefined, { scene: scene === 'flight' ? 'flight' : 'spaceCenter' });
  handedOff.add(world);
  game.set({ resumeWorld: serializeWorld(world), mode: world.mode, ut: world.ut, launchPending: false, scene });
}
