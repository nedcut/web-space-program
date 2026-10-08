import type { ScalePresetId } from '../../sim/bodies';
import type { ManeuverNode, Orbit, StateVector } from '../../sim/orbit/api';
import type { TransferOptions, TransferPlan } from './transfers';
import type { CourseCorrectionOptions, InterplanetaryOptions, InterplanetaryPlan, PorkchopPoint, SearchRange } from '../interplanetary';

/** No craft, functions, class instances, render state or mutable World crosses the boundary. */
export interface PlanningSnapshot {
  preset: ScalePresetId;
  activatedAsteroids?: string[];
  ut: number;
  vessel: { id: string; body: string; orbit: Orbit; state: StateVector } | null;
  nodes: ManeuverNode[];
}
export interface PlanningOperations {
  landing: { args: import('./landing').LandingRequest; result: import('./landing').LandingPrediction };
  transfer: { args: { target: string; options?: TransferOptions }; result: TransferPlan | null };
  interplanetary: { args: { target: string; options?: InterplanetaryOptions }; result: InterplanetaryPlan | null };
  correction: { args: { target: string; options: CourseCorrectionOptions }; result: TransferPlan | null };
  porkchop: { args: { from: string; target: string; departures: SearchRange; flights: SearchRange }; result: (PorkchopPoint | null)[] };
}
export type PlanningOperation = keyof PlanningOperations;
export type PlanningRequest = { [K in PlanningOperation]: {
  type: 'plan'; id: number; operation: K; snapshot: PlanningSnapshot; args: PlanningOperations[K]['args'];
} }[PlanningOperation];
export type PlannerMessage = PlanningRequest | { type: 'cancel'; id: number };
export type PlanningProgress = { phase: string; fraction: number; row?: { index: number; cells: (PorkchopPoint | null)[] } };
export type PlannerEvent =
  | { type: 'progress'; id: number; progress: PlanningProgress }
  | { type: 'result'; id: number; result: PlanningOperations[PlanningOperation]['result'] }
  | { type: 'error'; id: number; name: string; message: string }
  | { type: 'cancelled'; id: number };
