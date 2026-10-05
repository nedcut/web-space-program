import type { TrajectoryPatch } from '../../sim/orbit/api';
import type { VesselEvent } from '../../sim/vessel/runtime';
import type { CraftDef } from '../../sim/vessel/types';
import type { WorldVessel } from '../world';

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
  trajectoryCache: { time: number; key: string; patches: TrajectoryPatch[] } | null;
  unpack: (wv: WorldVessel) => void;
}
