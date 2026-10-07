import type { TrajectoryPatch } from '../../sim/orbit/api';
import type { VesselEvent } from '../../sim/vessel/runtime';
import type { CraftDef } from '../../sim/vessel/types';
import type { WorldVessel } from '../world';

/** Patched-conic map path of the active vessel; `thrusting` = computed while the engines were producing thrust. */
export interface TrajectoryCache { time: number; key: string; patches: TrajectoryPatch[]; thrusting?: boolean }

/** Private implementation bridge; helpers never own or copy scene/world state. */
export interface WorldInternals {
  advanceRails: (target: number) => void;
  captureFixed: (wv: WorldVessel, t: number) => void;
  handleEvent: (e: VesselEvent) => void;
  launchRunway: (craft: CraftDef, keepExisting?: boolean) => WorldVessel;
  newVesselId: () => string;
  pack: (wv: WorldVessel) => void;
  predictRailsEvent: (wv: WorldVessel) => void;
  stageRequested: boolean;
  syncFixed: (wv: WorldVessel, t: number) => void;
  syncPacked: (wv: WorldVessel, t: number) => void;
  trajectoryCache: TrajectoryCache | null;
  unpack: (wv: WorldVessel) => void;
}
