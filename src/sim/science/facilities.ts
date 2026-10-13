import type { ScalePresetId } from '../bodies/scale';
import type { GameMode, Progression } from './progression';

/**
 * Space Center facility upgrades: the career's money sink. Each facility has three levels bought with funds;
 * every level adds a perk. Level 1 flies every stock craft of the Moon route up to the first flyby; the Moon
 * lander needs a level-2 pad, priced well inside what that route has earned by then. Sandbox and science
 * programs have no funds, so their limits are off (`facilityLevel` reads the top level) and the lab bonus
 * and Mission Control perks apply to careers only.
 */
export type FacilityId = 'pad' | 'hall' | 'control' | 'lab';
export const FACILITY_IDS: readonly FacilityId[] = ['pad', 'hall', 'control', 'lab'];
export const MAX_FACILITY_LEVEL = 3;
export type FacilityLevels = Record<FacilityId, number>;

export const NEW_PROGRAM_FACILITIES: Readonly<FacilityLevels> = { pad: 1, hall: 1, control: 1, lab: 1 };
/**
 * Careers saved before upgrades existed: no launch limits (so no saved design stops flying); Mission Control
 * and the lab stay at level 1, which is exactly what those programs had.
 */
export const LEGACY_FACILITIES: Readonly<FacilityLevels> = { pad: 3, hall: 3, control: 1, lab: 1 };

/** Standard-scale price of levels 2 and 3; larger scales pay the career credit multiplier (D-016). */
const COST: Record<FacilityId, readonly [number, number]> = {
  pad: [40_000, 180_000], hall: [25_000, 120_000], control: [40_000, 150_000], lab: [60_000, 200_000],
};
/** Heaviest craft (wet, kg) the pad and runway accept, by level. Heavier worlds need heavier rockets. */
const PAD_MASS: Record<ScalePresetId, readonly [number, number, number]> = {
  standard: [20_000, 150_000, Infinity],
  challenging: [100_000, 1_000_000, Infinity],
  real: [300_000, 6_000_000, Infinity],
};
const HALL_PARTS = [30, 100, Infinity] as const;
const CONTROL_SLOTS = [3, 4, 5] as const;
/** Contract reward factor for offers drawn at that Mission Control level. */
const CONTROL_REWARD = [1, 1, 1.25] as const;
/** Extra science on every result credited (recovery or transmission). */
const LAB_BONUS = [0, 0.15, 0.3] as const;

const clampLevel = (n: number) => Math.max(1, Math.min(MAX_FACILITY_LEVEL, Math.floor(n) || 1));
/** Stored level; a progression without a record predates upgrades (`LEGACY_FACILITIES`). */
export const ownedLevel = (p: Pick<Progression, 'facilities'>, id: FacilityId) => clampLevel(p.facilities?.[id] ?? LEGACY_FACILITIES[id]);
/** Level in effect: careers use what they bought; other modes have every facility at the top level. */
export const facilityLevel = (p: Pick<Progression, 'facilities'>, mode: GameMode, id: FacilityId) =>
  mode === 'career' ? ownedLevel(p, id) : MAX_FACILITY_LEVEL;

export const padMassLimit = (level: number, preset: ScalePresetId) => PAD_MASS[preset][clampLevel(level) - 1];
export const hallPartLimit = (level: number) => HALL_PARTS[clampLevel(level) - 1];
export const contractSlots = (p: Pick<Progression, 'facilities'>, mode: GameMode) => CONTROL_SLOTS[facilityLevel(p, mode, 'control') - 1];
export const contractRewardFactor = (p: Pick<Progression, 'facilities'>, mode: GameMode) => mode === 'career' ? CONTROL_REWARD[ownedLevel(p, 'control') - 1] : 1;
export const scienceBonus = (p: Pick<Progression, 'facilities'>, mode: GameMode) => mode === 'career' ? LAB_BONUS[ownedLevel(p, 'lab') - 1] : 0;

/** Price of the next level, or null at the top. */
export function upgradeCost(p: Pick<Progression, 'facilities'>, id: FacilityId, creditsMultiplier = 1): number | null {
  const level = ownedLevel(p, id);
  return level >= MAX_FACILITY_LEVEL ? null : Math.round(COST[id][level - 1] * creditsMultiplier);
}
/** Price to bring a facility from its current level to `level` (0 when already there). */
export function costToLevel(p: Pick<Progression, 'facilities'>, id: FacilityId, level: number, creditsMultiplier = 1): number {
  let total = 0;
  for (let l = ownedLevel(p, id); l < Math.min(level, MAX_FACILITY_LEVEL); l++) total += Math.round(COST[id][l - 1] * creditsMultiplier);
  return total;
}

/** Buy the next level (career only, funds permitting). */
export function upgradeFacility(p: Progression, mode: GameMode, id: FacilityId, creditsMultiplier = 1): boolean {
  if (mode !== 'career') return false;
  const cost = upgradeCost(p, id, creditsMultiplier);
  if (cost === null || cost > p.funds) return false;
  const levels = p.facilities ??= { ...LEGACY_FACILITIES };
  levels[id] = ownedLevel(p, id) + 1;
  p.funds -= cost;
  return true;
}

/** Lowest level whose limit admits `value` (craft mass in kg for the pad, part count for the hall). */
export function levelFor(id: 'pad' | 'hall', value: number, preset: ScalePresetId): number {
  for (let level = 1; level <= MAX_FACILITY_LEVEL; level++)
    if (value <= (id === 'pad' ? padMassLimit(level, preset) : hallPartLimit(level))) return level;
  return MAX_FACILITY_LEVEL;
}

/** One perk value at a level, for UI (icon key + short value + what it means). */
export interface FacilityPerk { value: string; meaning: string }
const tonnes = (kg: number) => Number.isFinite(kg) ? `${(kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} t` : 'No limit';
export function facilityPerk(id: FacilityId, level: number, preset: ScalePresetId): FacilityPerk {
  const l = clampLevel(level);
  switch (id) {
    case 'pad': return { value: tonnes(padMassLimit(l, preset)), meaning: 'heaviest launch' };
    case 'hall': { const n = hallPartLimit(l); return { value: Number.isFinite(n) ? `${n} parts` : 'No limit', meaning: 'largest vehicle' }; }
    case 'control': return { value: `${CONTROL_SLOTS[l - 1]} slots${CONTROL_REWARD[l - 1] > 1 ? ` · +${Math.round((CONTROL_REWARD[l - 1] - 1) * 100)}%` : ''}`, meaning: CONTROL_REWARD[l - 1] > 1 ? 'active commissions · rewards' : 'active commissions' };
    case 'lab': return { value: `+${Math.round(LAB_BONUS[l - 1] * 100)}%`, meaning: 'science from results' };
  }
}
