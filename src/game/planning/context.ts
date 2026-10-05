import type { ManeuverNode, Orbit, StateVector } from '../../sim/orbit/api';
import type { Universe } from '../universe';

/** Minimal structural contract: both World and a reconstructed snapshot satisfy it. */
export interface PlanningWorld {
  universe: Pick<Universe, 'body' | 'bodies' | 'ephem' | 'sunId'>;
  ut: number;
  active: { body: string } | null | undefined;
  orbitOf(vessel: { body: string }): Orbit;
  relativeState(vessel: { body: string }): StateVector;
  addNode(time: number): ManeuverNode;
}
export type PlanningProgressReporter = (phase: string, fraction: number) => void;
