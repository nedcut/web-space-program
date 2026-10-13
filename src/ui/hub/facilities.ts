import type { GameMode } from '../../sim/science/progression';
import type { SiteObjectId } from '../../render/site/LaunchSite';
import { facilityLabel } from '../nav/scenes';

/** Hub entries: the facility screens plus the Launch Pad (which opens the quick craft picker). */
export type HubFacilityId = 'editor' | 'launch' | 'flightlog' | 'tracking' | 'research' | 'missions';

export interface HubFacility {
  id: HubFacilityId;
  /** Building that stands for it in the 3D complex. */
  building: SiteObjectId;
  title: string;
  desc: string;
  /** Null when the facility is open in this mode, else why it is closed (shown on hover). */
  closed: string | null;
}

const BUILDING: Record<HubFacilityId, SiteObjectId> = {
  editor: 'vab', launch: 'pad', tracking: 'dish', flightlog: 'offices', research: 'workshop', missions: 'control',
};

/**
 * Every facility with its building, in tile order. Research and Mission Control stay in the list (their
 * buildings are still there) but are closed outside the modes that use them; tiles skip closed ones.
 */
export function hubFacilities(mode: GameMode, runway = false): HubFacility[] {
  return [
    { id: 'editor', title: facilityLabel('editor'), desc: 'Design and build rockets', closed: null },
    { id: 'launch', title: runway ? 'Runway' : 'Launch Pad', desc: 'Pick a vehicle and fly', closed: null },
    { id: 'flightlog', title: facilityLabel('flightlog'), desc: 'Flight reports, history and achievements', closed: null },
    { id: 'tracking', title: facilityLabel('tracking'), desc: 'Track vessels and explore the solar system', closed: null },
    { id: 'research', title: facilityLabel('research'), desc: 'Explore the technology tree', closed: mode === 'sandbox' ? 'Science and career programs' : null },
    { id: 'missions', title: facilityLabel('missions'), desc: 'Commission expeditions and track contracts', closed: mode !== 'career' ? 'Career programs' : null },
  ].map(f => ({ ...f, id: f.id as HubFacilityId, building: BUILDING[f.id as HubFacilityId] }));
}

export const facilityForBuilding = (list: readonly HubFacility[], building: SiteObjectId | null) => list.find(f => f.building === building) ?? null;
