import type { GameAudio } from '../../audio';
import { flightPredictions } from '../../game/flightData';
import { type WorldVessel } from '../../game/world';
import { type PortInfo } from '../../sim/vessel';
import type { CraftDef } from '../../sim/vessel/types';
import { type Vec3 } from '../../util/vec3';
import type { DockingTelemetry, Telemetry } from '../hud/Hud';

/** Private implementation bridge; helpers never own or copy scene/world state. */
export interface FlightControllerInternals {
  assistWarped: boolean;
  audio: GameAudio | null;
  craft: CraftDef | null;
  dockingPair: () => { mine: PortInfo; theirs: PortInfo; } | null;
  dockingTelemetry: () => DockingTelemetry | null;
  groundTelemetry: (wv: WorldVessel) => Pick<Telemetry, "gear" | "brakes" | "intakeAir">;
  maneuverDirection: () => Vec3 | null;
  predictions: ReturnType<typeof flightPredictions>;
  reentryHeat: number;
  targetOptions: (wv: WorldVessel) => Telemetry["targetOptions"];
  targetTelemetry: (wv: WorldVessel) => Telemetry["target"];
}
