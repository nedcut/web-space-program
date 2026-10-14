import { useMemo, useState } from 'react';
import { useGame } from '../../game/store';
import { openProgram, saveProgram } from '../../game/program';
import { PART_CATALOG } from '../../data/parts';
import { facilityProblem, type FacilityBlock } from '../../data/technology';
import { careerScaleMultiplier, type ScalePresetId } from '../../sim/bodies/scale';
import { costToLevel, facilityPerk, MAX_FACILITY_LEVEL, ownedLevel, upgradeCost, type FacilityId } from '../../sim/science/facilities';
import { newProgression, type Progression } from '../../sim/science/progression';
import type { CraftDef } from '../../sim/vessel/types';
import { Button, ConfirmModal } from '../components';
import { Icon } from '../components/Icon';
import type { HubFacilityId } from './facilities';

export const FACILITY_TITLE: Record<FacilityId, string> = { pad: 'Launch Pad', hall: 'Integration Hall', control: 'Mission Control', lab: 'Research Lab' };
export const FACILITY_ICON: Record<FacilityId, string> = { pad: 'rocket', hall: 'build', control: 'groups', lab: 'science' };
/** Hub facility (tile/building) for each upgradable facility. */
export const HUB_FACILITY: Record<FacilityId, HubFacilityId> = { pad: 'launch', hall: 'editor', control: 'missions', lab: 'research' };
export const upgradableFor = (id: HubFacilityId) => (Object.keys(HUB_FACILITY) as FacilityId[]).find(f => HUB_FACILITY[f] === id) ?? null;

/** 40,000 → "40k cr", 4,096,000 → "4.1M cr": button-sized prices (the confirm shows the exact amount). */
export const shortCr = (cr: number) => cr >= 1e6 ? `${+(cr / 1e6).toFixed(1)}M cr` : cr >= 1e4 ? `${Math.round(cr / 1e3)}k cr` : `${cr.toLocaleString()} cr`;

/** Filled/empty level pips (●●○). */
export function LevelPips({ level, max = MAX_FACILITY_LEVEL, label }: { level: number; max?: number; label?: string }) {
  return <span className="fac-pips" role="img" aria-label={label ?? `Level ${level} of ${max}`}>
    {Array.from({ length: max }, (_, i) => <i key={i} className={i < level ? 'on' : ''} />)}
  </span>;
}

/** Buy levels up to `level` on the program (one autosave). Returns the error text, or null. */
export function buyFacility(id: FacilityId, level: number): string | null {
  const w = openProgram();
  while (ownedLevel(w.progression, id) < level) if (!w.upgradeFacility(id)) return 'Not enough funds';
  saveProgram(w);
  return null;
}

export interface UpgradeOffer { id: FacilityId; from: number; to: number; cost: number; affordable: boolean }
export function upgradeOffer(p: Progression, preset: ScalePresetId, id: FacilityId, to = ownedLevel(p, id) + 1): UpgradeOffer | null {
  const from = ownedLevel(p, id);
  if (from >= MAX_FACILITY_LEVEL || to <= from) return null;
  const cost = to === from + 1 ? upgradeCost(p, id, careerScaleMultiplier(preset))! : costToLevel(p, id, to, careerScaleMultiplier(preset));
  return { id, from, to, cost, affordable: cost <= p.funds };
}

/** Confirm dialog for an upgrade: perks before → after, price and balance. */
export function UpgradeConfirm({ offer, preset, onDone, onCancel }: { offer: UpgradeOffer; preset: ScalePresetId; onDone: (error: string | null) => void; onCancel: () => void }) {
  const before = facilityPerk(offer.id, offer.from, preset), after = facilityPerk(offer.id, offer.to, preset);
  const funds = useGame(s => s.resumeWorld?.progression?.funds ?? 0);
  return <ConfirmModal title={`Upgrade the ${FACILITY_TITLE[offer.id]}?`} confirmLabel={`Upgrade · ${offer.cost.toLocaleString()} cr`}
    onCancel={onCancel} onConfirm={() => onDone(buyFacility(offer.id, offer.to))}>
    <div className="fac-confirm">
      <Icon name={FACILITY_ICON[offer.id]} size={28} />
      <LevelPips level={offer.from} /><span aria-hidden>→</span><LevelPips level={offer.to} />
      <span className="mono">{before.value}</span><span aria-hidden>→</span><strong className="mono">{after.value}</strong>
      <small>{after.meaning}</small>
    </div>
    <p className="fac-confirm-funds mono">{funds.toLocaleString()} cr → {(funds - offer.cost).toLocaleString()} cr</p>
  </ConfirmModal>;
}

/** The Space Center limit the craft breaks in this program (career only), recomputed when the craft or program changes. */
export function useFacilityBlock(craft: CraftDef | null): FacilityBlock | null {
  const mode = useGame(s => s.mode);
  const p = useGame(s => s.resumeWorld?.progression);
  const preset = useGame(s => s.scalePreset);
  return useMemo(() => craft && craft.parts.length ? facilityProblem(craft, PART_CATALOG, mode, p ?? newProgression(), preset) : null, [craft, mode, p, preset]);
}

/** One-click path past a facility limit: "Launch Pad → level 2 · 40,000 cr" opens the confirm; buys every level needed. */
export function FacilityUnblock({ block, className = 'btn small warn', compact = false, onBought }: { block: FacilityBlock; className?: string; compact?: boolean; onBought?: () => void }) {
  const p = useGame(s => s.resumeWorld?.progression);
  const preset = useGame(s => s.scalePreset);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const offer = p ? upgradeOffer(p, preset, block.facility, block.level) : null;
  if (!offer) return null;
  return <>
    <Button className={className} disabled={!offer.affordable}
      title={offer.affordable ? block.message : `${block.message} Costs ${offer.cost.toLocaleString()} cr.`}
      aria-label={`Upgrade the ${FACILITY_TITLE[offer.id]} to level ${offer.to}, ${offer.cost.toLocaleString()} credits`}
      onClick={() => setOpen(true)}>
      <Icon name={FACILITY_ICON[offer.id]} size={14} />{!compact && ` ${FACILITY_TITLE[offer.id]} `}<LevelPips level={offer.to} /> {compact ? shortCr(offer.cost) : `${offer.cost.toLocaleString()} cr`}
    </Button>
    {error && <span role="alert" className="fac-error">{error}</span>}
    {open && <UpgradeConfirm offer={offer} preset={preset} onCancel={() => setOpen(false)}
      onDone={e => { setOpen(false); setError(e ?? ''); if (!e) onBought?.(); }} />}
  </>;
}
