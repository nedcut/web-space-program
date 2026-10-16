import { useState } from 'react';
import { RAILS_WARP, PHYSICS_WARP } from '../../game/timewarp';
import { bindingLabel } from '../../input/bindings';
import { formatDate, formatSpeed } from '../../ui/format';
import { WarpToControl } from './FeelHud';
import { AppIcon } from './glyphs';
import type { HudCallbacks, Telemetry } from './Hud';
import type { ChuteLamp } from '../alerts';

const CHUTE_LAMP: Record<ChuteLamp, { label: string; state: 'on' | 'off' | 'warn' | 'bad'; title: string }> = {
  stowed: { label: 'CHUTE', state: 'off', title: 'stowed; they arm when their stage fires' },
  armed: { label: 'CHUTE ARM', state: 'warn', title: 'armed; they open in thick enough air' },
  waiting: { label: 'CHUTE WAIT', state: 'bad', title: 'armed but held shut: falling too fast for the canopy' },
  semi: { label: 'CHUTE SEMI', state: 'on', title: 'reefed; full canopy low and slow' },
  full: { label: 'CHUTE OPEN', state: 'on', title: 'fully open' },
  cut: { label: 'CHUTE CUT', state: 'bad', title: 'torn away by the airflow' },
};

const CLOCK_KEY = 'wsp.hud.clock.v1';
/** Locale formatting is slow; the warp level titles never change. */
const RAILS_LABELS = RAILS_WARP.map((r) => r.toLocaleString());

/** Mission clock: T+ [d] hh:mm:ss. */
export function formatMet(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const hms = [Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
  return `T+ ${d > 0 ? `${d}d ` : ''}${hms}`;
}

/** Top-left: pause menu, warp arrows with a level indicator, warp-to, and the MET / UT clock. */
export function TimeControl({ t, cb }: { t: Telemetry; cb: HudCallbacks }) {
  const [primary, setPrimary] = useState<'met' | 'ut'>(() => {
    try { return sessionStorage.getItem(CLOCK_KEY) === 'ut' ? 'ut' : 'met'; } catch { return 'met'; }
  });
  const swap = () => setPrimary(p => {
    const next = p === 'met' ? 'ut' : 'met';
    try { sessionStorage.setItem(CLOCK_KEY, next); } catch { /* storage unavailable */ }
    return next;
  });
  const physics = t.warpMode === 'physics';
  const levels = physics ? PHYSICS_WARP.length - 1 : RAILS_WARP.length - 1;
  const met = t.met === null ? 'T+ 00:00:00 (pre-launch)' : formatMet(t.met);
  const ut = formatDate(t.ut);
  return (
    <div className="tc panel" aria-label="Time control">
      <div className="tc-row">
        <button type="button" className="tc-btn" onClick={cb.onMenu} title={`Pause menu (${bindingLabel('menu')})`}><AppIcon name="menu" size={15} /></button>
        <button type="button" className="tc-btn" onClick={() => cb.onWarp(-1)} title={`Slower time warp (${bindingLabel('warpDown')})`}>◀</button>
        <div className={`tc-levels ${physics ? 'physics' : ''}`} title={physics ? 'Physics warp (thrusting or in atmosphere)' : `Rails warp · ${bindingLabel('warpStop')} returns to 1×`}>
          {Array.from({ length: levels }, (_, i) => {
            const idx = i + 1;
            const lit = t.warpIndex >= idx;
            const blocked = !physics && idx > t.warpLimit;
            return (
              <button key={idx} type="button" className={`tc-level ${lit ? 'lit' : ''} ${blocked ? 'blocked' : ''}`} aria-label={`Warp ${physics ? PHYSICS_WARP[idx] : RAILS_WARP[idx]}×`}
                title={`${physics ? PHYSICS_WARP[idx] : RAILS_LABELS[idx]}×${blocked ? ' — not available at this altitude / while thrusting' : ''}`}
                onClick={() => cb.onWarp((t.warpIndex >= idx ? idx - 1 : idx) - t.warpIndex)} />
            );
          })}
        </div>
        <button type="button" className="tc-btn" onClick={() => cb.onWarp(1)} title={`Faster time warp (${bindingLabel('warpUp')})`}>▶</button>
        <div className={`tc-rate mono ${physics ? 'physics' : ''}`} title="Current time multiplier">{t.warpLabel}</div>
        <WarpToControl feel={t.feel} onWarpTo={cb.onWarpTo} onCancel={cb.onCancelWarpTo} />
      </div>
      <button type="button" className="tc-clock" onClick={swap} title={`${primary === 'met' ? `Universal time: ${ut}` : `Mission time: ${met}`} · click to swap`}>
        <span className="tc-clock-main mono"><span className="tc-tag">{primary === 'met' ? 'MET' : 'UT'}</span>{primary === 'met' ? met : ut}</span>
        <span className="tc-clock-sub mono"><span className="tc-tag">{primary === 'met' ? 'UT' : 'MET'}</span>{primary === 'met' ? ut : met}</span>
      </button>
    </div>
  );
}

/** Odometer-style digit tumbler: 6 digits and a unit that steps m → km → Mm → Gm. */
function tumbler(m: number, units: string[]): { digits: string; unit: string; negative: boolean } {
  if (!Number.isFinite(m)) return { digits: '------', unit: units[0], negative: false };
  let v = Math.abs(m), u = 0;
  while (v >= 999999.5 && u < units.length - 1) { v /= 1000; u++; }
  return { digits: String(Math.round(v)).padStart(6, '0').slice(-6), unit: units[u], negative: m < 0 };
}

const ALT_KEY = 'wsp.hud.altimeter.v1';

/** Top-centre altimeter (click: sea level ↔ terrain) with status lamps on either side and custom groups below. */
export function Altimeter({ t, cb, imperial }: { t: Telemetry; cb: HudCallbacks; imperial: boolean }) {
  const [terrain, setTerrain] = useState(() => { try { return localStorage.getItem(ALT_KEY) === 'terrain'; } catch { return false; } });
  const flip = () => setTerrain(v => { try { localStorage.setItem(ALT_KEY, v ? 'sea' : 'terrain'); } catch { /* storage unavailable */ } return !v; });
  const alt = terrain ? t.altitudeTerrain : t.altitudeAsl;
  const tm = imperial ? tumbler(alt / 0.3048, ['ft', 'kft', 'Mft', 'Gft']) : tumbler(alt, ['m', 'km', 'Mm', 'Gm', 'Tm']);
  const unit = tm.unit;
  const vs = imperial ? `${(t.verticalSpeed / 0.3048).toFixed(1)} ft/s` : formatSpeed(t.verticalSpeed);
  const abort = t.actionGroups.find(g => g.id === 'abort');
  const custom = t.actionGroups.filter(g => g.id !== 'abort' && g.count > 0);
  const vessel = !t.eva && !t.noControl;
  const lamp = (id: string, label: string, state: 'on' | 'off' | 'warn' | 'bad' | 'na', title: string, onClick?: () => void) => (
    <button key={id} type="button" className={`lamp ${state}`} data-lamp={id} title={title} disabled={!onClick || state === 'na'} onClick={onClick}>{label}</button>
  );
  return (
    <div className="alt-wrap">
      <div className="alt-lamps left">
        {lamp('gear', 'GEAR', t.gear === null ? 'na' : t.gear === 'moving' ? 'warn' : t.gear === 'down' ? 'on' : 'off', `Landing gear / legs (${bindingLabel('toggleGear')})${t.gear === null ? ' — none fitted' : `: ${t.gear}`}`, vessel ? cb.onToggleGear : undefined)}
        {t.chute && lamp('chute', CHUTE_LAMP[t.chute].label, CHUTE_LAMP[t.chute].state,
          `Parachutes: ${CHUTE_LAMP[t.chute].title}${t.chuteRating > 0 ? ` · open below ${(t.chuteRating / 1000).toFixed(0)} kPa of airflow` : ''}`)}
        {lamp('brakes', 'BRAKES', t.brakes === null ? 'na' : t.brakes ? 'bad' : 'off', `Wheel brakes (hold ${bindingLabel('brakes')})${t.brakes === null ? ' — no wheels' : ''}`)}
        {lamp('lights', 'LIGHTS', t.lights === null ? 'na' : t.lights ? 'on' : 'off', `Lights (${bindingLabel('toggleLights')})${t.lights === null ? ' — no lamps fitted' : ''}`, vessel ? cb.onToggleLights : undefined)}
        {lamp('night', 'NIGHT VIS', t.nightVision ? 'on' : 'off', `Night vision (${bindingLabel('nightVision')}): see the vessel when the sun is hidden`, cb.onToggleNightVision)}
        {lamp('lock', 'STG LOCK', t.stageLocked ? 'warn' : 'off', `Stage lock (${bindingLabel('stageLock')})`, vessel ? cb.onStageLock : undefined)}
      </div>
      <button type="button" className="alt panel" onClick={flip} title={`${terrain ? 'Height above terrain' : 'Altitude above sea level'} · click for ${terrain ? 'sea level' : 'terrain'}`}>
        <span className="alt-mode">{terrain ? 'TERRAIN' : 'SEA LVL'}</span>
        <span className="alt-digits mono" aria-label={`${terrain ? 'Radar altitude' : 'Altitude'} ${Math.round(alt)} metres`}>
          {tm.negative && <span className="alt-neg">−</span>}
          {tm.digits.split('').map((d, i) => <span key={i} className={`alt-digit ${i === 3 ? 'gap' : ''}`}>{d}</span>)}
          <span className="alt-unit">{unit}</span>
        </span>
        <span className="alt-sub mono">{t.bodyName} · <span title="Vertical speed">{t.verticalSpeed >= 0 ? '▲' : '▼'} {vs}</span></span>
      </button>
      <div className="alt-lamps right">
        {lamp('sas', 'SAS', t.sasOn ? 'on' : 'off', `SAS (${bindingLabel('toggleSas')})`, vessel ? cb.onToggleSas : undefined)}
        {lamp('rcs', 'RCS', t.rcsOn ? 'on' : 'off', `RCS (${bindingLabel('toggleRcs')})`, vessel ? cb.onToggleRcs : undefined)}
        {lamp('abort', 'ABORT', abort?.on ? 'bad' : 'off', `Abort (${abort?.key ?? bindingLabel('abort')}): cut throttle and fire the Abort group${abort?.count ? ` · ${abort.count} actions` : ' · none assigned'}`, vessel ? cb.onAbort : undefined)}
        {custom.length > 0 && (
          <div className="alt-groups" aria-label="Custom action groups">
            {custom.map(g => (
              <button key={g.id} type="button" className={`lamp small ${g.on ? 'on' : 'off'}`} disabled={!vessel} onClick={() => cb.onActionGroup?.(g.id)}
                title={`${g.label} (${g.key}) · ${g.count} action${g.count === 1 ? '' : 's'}`}>{g.id.slice(6)}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
