import { useState } from 'react';
import { useGame } from '../../game/store';
import { FACILITY_IDS, facilityPerk, ownedLevel, type FacilityId } from '../../sim/science/facilities';
import type { SiteObjectId } from '../../render/site/LaunchSite';
import { Button } from '../components';
import { Icon } from '../components/Icon';
import { FACILITY_ICON, FACILITY_TITLE, LevelPips, shortCr, UpgradeConfirm, upgradeOffer, type UpgradeOffer } from './FacilityUpgrade';

const BUILDING: Record<FacilityId, SiteObjectId> = { pad: 'pad', hall: 'vab', control: 'control', lab: 'workshop' };

/**
 * Career hub card: each upgradable facility with its level pips, current perk, the next one and an Upgrade
 * button (confirmed). Hovering a row rings its building.
 */
export function FacilitiesCard({ onHighlight, onNotice }: { onHighlight: (id: SiteObjectId | null) => void; onNotice: (text: string) => void }) {
  const p = useGame(s => s.resumeWorld?.progression);
  const preset = useGame(s => s.scalePreset);
  const [confirm, setConfirm] = useState<UpgradeOffer | null>(null);
  if (!p) return null;
  return <section className="panel hub-facilities" aria-label="Facility upgrades" onMouseLeave={() => onHighlight(null)}>
    <div className="label">Facilities</div>
    {FACILITY_IDS.map(id => {
      const level = ownedLevel(p, id), now = facilityPerk(id, level, preset), offer = upgradeOffer(p, preset, id);
      const next = offer && facilityPerk(id, offer.to, preset);
      return <div key={id} className="hub-fac-row" onMouseEnter={() => onHighlight(BUILDING[id])}>
        <Icon name={FACILITY_ICON[id]} size={18} />
        <span className="hub-fac-name">{FACILITY_TITLE[id]}</span><LevelPips level={level} />
        <span className="hub-fac-perk mono" title={now.meaning}>{now.value}{next && <span className="hub-fac-next"> → {next.value}</span>}</span>
        {offer
          ? <Button className="btn small" disabled={!offer.affordable} onFocus={() => onHighlight(BUILDING[id])}
            title={`${next!.value} ${next!.meaning}${offer.affordable ? '' : ' · not enough funds'}`} aria-label={`Upgrade ${FACILITY_TITLE[id]} to level ${offer.to}, ${offer.cost.toLocaleString()} credits`}
            onClick={() => setConfirm(offer)}>{shortCr(offer.cost)}</Button>
          : <span className="hub-fac-max label">Max</span>}
      </div>;
    })}
    {confirm && <UpgradeConfirm offer={confirm} preset={preset} onCancel={() => setConfirm(null)}
      onDone={e => { setConfirm(null); onNotice(e ?? `${FACILITY_TITLE[confirm.id]} upgraded to level ${confirm.to}.`); }} />}
  </section>;
}
