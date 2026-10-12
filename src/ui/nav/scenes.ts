import type { GameMode } from '../../sim/science/progression';
import type { Scene } from '../../game/store';

/** Space Center facilities reachable from the hub and from each other's headers (one naming source). */
export type FacilityScene = Extract<Scene, 'editor' | 'tracking' | 'flightlog' | 'research' | 'missions'>;
export interface Facility { scene: FacilityScene; label: string; icon: string }

const FACILITIES: readonly (Facility & { modes?: readonly GameMode[] })[] = [
  { scene: 'editor', label: 'Integration Hall', icon: 'build' },
  { scene: 'tracking', label: 'Fleet Tracking', icon: 'orbit' },
  { scene: 'flightlog', label: 'Flight Log', icon: 'log' },
  { scene: 'research', label: 'Research Lab', icon: 'science', modes: ['science', 'career'] },
  { scene: 'missions', label: 'Mission Control', icon: 'groups', modes: ['career'] },
];

export function facilities(mode: GameMode): Facility[] {
  return FACILITIES.filter(f => !f.modes || f.modes.includes(mode));
}
export const facilityLabel = (scene: FacilityScene) => FACILITIES.find(f => f.scene === scene)!.label;
