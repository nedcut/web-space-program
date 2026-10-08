import type { CraftDef } from '../sim/vessel/types';

/**
 * Player-facing names for the two building modes. The stored ids ('VAB' | 'SPH') are persisted in saved crafts, share
 * codes and multiplayer messages, so they stay as-is; only these labels are shown in the UI.
 */
export const CRAFT_TYPE_LABELS: Record<CraftDef['type'], { short: string; long: string; hint: string }> = {
  'VAB': { short: 'Rockets', long: 'Rocket hall', hint: 'build vertically, launch from the pad' },
  'SPH': { short: 'Planes', long: 'Plane hangar', hint: 'build horizontally, launch from the runway' },
};
