import { memo, useSyncExternalStore } from 'react';
import { bindingLabel, getBindings, subscribeBindings } from '../../input/bindings';
import { cameraModeInfo } from '../camera';
import { Portrait } from './CrewPanel';
import { AppIcon } from './glyphs';
import type { HudCallbacks, Telemetry } from './Hud';

const MAX_CARDS = 4;

/** One line of the controls that matter right now (on the ground, flying with or without the jetpack). */
export function evaHint(eva: NonNullable<Telemetry['eva']>, label: (a: Parameters<typeof bindingLabel>[0]) => string): string {
  // Primary key only ("A", not "A / Q"): the line has to stay short.
  const key = (a: Parameters<typeof bindingLabel>[0]) => label(a).split(' / ')[0];
  const keys = [key('evaForward'), key('evaLeft'), key('evaBack'), key('evaRight')];
  const move = keys.every(k => k.length === 1) ? keys.join('') : keys.join('/');
  if (eva.landed) return `${move} walk · ${key('evaRun')} run · ${key('evaJump')} jump${eva.jetpack ? ` · ${key('evaUp')} lift off` : ''}`;
  if (!eva.jetpack) return `In the air · ${key('toggleRcs')} jetpack on`;
  if (eva.fuel <= 0) return 'Jetpack empty · board to refill';
  return `${move} fly · ${key('evaUp')} up · ${key('evaDown')} down`;
}

/** Bottom-right: crew portrait cards (EVA per astronaut) with MAP and camera buttons. */
export interface CrewCardsProps {
  crew: Telemetry['crew'];
  eva: Telemetry['eva'];
  mapMode: boolean;
  noControl: boolean;
  cameraMode: Telemetry['feel']['cameraMode'];
  /** Must be referentially stable (Hud passes a forwarding object) for the memo to hold. */
  cb: HudCallbacks;
}

/** Re-renders only when crew, EVA state, map/camera mode or control authority change (not at telemetry rate). */
export const CrewCards = memo(function CrewCards({ crew, eva, mapMode, noControl, cameraMode, cb }: CrewCardsProps) {
  const t = { crew, eva, mapMode, noControl };
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const key = (a: Parameters<typeof bindingLabel>[0]) => bindingLabel(a, bindings);
  const cam = cameraModeInfo(cameraMode, !!eva);
  const shown = t.crew.slice(0, MAX_CARDS);
  return (
    <div className="crew-dock">
      <div className="crew-views">
        {!t.mapMode && (
          <button type="button" className="view-btn" onClick={cb.onCameraMode} title={`Camera: ${cam.label} — ${cam.hint} (${key('toggleCamMode')})`}>
            <AppIcon name="camera" size={16} /><span className="mono">{cam.label.toUpperCase()}</span>
          </button>
        )}
        <button type="button" className={`view-btn map ${t.mapMode ? 'on' : ''}`} data-tutorial="map" onClick={cb.onMap} aria-pressed={t.mapMode} title={`Map view (${key('map')})`}>
          <AppIcon name="map" size={16} /><span>MAP</span>
        </button>
      </div>
      {t.eva ? (
        <div className="crew-cards">
          <article className="crew-card eva panel" aria-label="Astronaut on EVA">
            {t.crew[0] && <Portrait person={t.crew[0]} size={52} />}
            <div className="crew-info">
              <div className="crew-name">{t.crew[0]?.name ?? 'Astronaut'}</div>
              <div className="crew-meta mono eva-jet">
                <button type="button" className={`btn small eva-jet-toggle ${t.eva.jetpack ? 'on' : ''}`} aria-pressed={t.eva.jetpack} onClick={cb.onToggleRcs} title={`Jetpack on/off (${key('toggleRcs')})`}>Jetpack {t.eva.jetpack ? 'ON' : 'OFF'} · {key('toggleRcs')}</button>
                <span className="eva-gas" title="Jetpack monopropellant (5 kg full; refilled on boarding)"><span style={{ width: `${Math.min(100, t.eva.fuel * 20)}%` }} /></span>
                {t.eva.fuel.toFixed(2)} kg
              </div>
              <div className="crew-meta eva-keys">{evaHint(t.eva, key)}</div>
              <div className="crew-actions">
                <button type="button" className="btn small" disabled={!t.eva.canBoard} onClick={cb.onBoard} title={t.eva.boardHint ?? 'Board a hatch within 3 m'}>Board · {key('board')}</button>
                <button type="button" className="btn small" disabled={!t.eva.landed} onClick={cb.onPlantFlag} title="Plant a flag (landed)">Flag · {key('plantFlag')}</button>
              </div>
              {t.eva.boardHint && <div className="crew-meta" role="status">{t.eva.boardHint}</div>}
            </div>
          </article>
        </div>
      ) : shown.length > 0 && !t.mapMode && (
        <div className="crew-cards" aria-label="Crew">
          {shown.map(p => (
            <article key={p.id} className="crew-card panel" aria-label={p.name}>
              <Portrait person={p} size={52} />
              <div className="crew-info">
                <div className="crew-name" title={`Courage ${p.courage} · Skill ${p.skill}`}>{p.name}</div>
                <div className="crew-actions">
                  <button type="button" className="btn small" onClick={() => cb.onEva(p.id)} title={`Go on EVA (${key('eva')})`}>EVA</button>
                </div>
              </div>
            </article>
          ))}
          {t.crew.length > MAX_CARDS && <div className="crew-more panel" title="Open the Crew app for everyone aboard">+{t.crew.length - MAX_CARDS}</div>}
        </div>
      )}
      {!t.eva && t.noControl && !t.mapMode && <div className="crew-nocontrol panel">No control · {t.crew.length ? 'crew cannot fly this vessel' : 'an astronaut or probe core is required'}</div>}
    </div>
  );
});
