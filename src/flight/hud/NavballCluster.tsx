import type { ReactNode } from 'react';
import { useGame } from '../../game/store';
import { bindingLabel } from '../../input/bindings';
import { formatDuration } from '../../ui/format';
import { SAS_COLORS, SasIcon, type SasGlyph } from './glyphs';
import type { HudCallbacks, Telemetry } from './Hud';

/** Mode buttons in the classic two-column arrangement: hold on top, opposite pairs side by side, maneuver last. */
const SAS_LAYOUT: { id: SasGlyph; label: string }[] = [
  { id: 'stabilityAssist', label: 'Stability assist (hold attitude)' },
  { id: 'prograde', label: 'Prograde' },
  { id: 'retrograde', label: 'Retrograde' },
  { id: 'normal', label: 'Normal' },
  { id: 'antinormal', label: 'Anti-normal' },
  { id: 'radialIn', label: 'Radial in' },
  { id: 'radialOut', label: 'Radial out' },
  { id: 'target', label: 'Target' },
  { id: 'antiTarget', label: 'Anti-target' },
  { id: 'maneuver', label: 'Maneuver: point at the next node burn' },
];

const SPEED_LABEL: Record<Telemetry['speedMode'], string> = { surface: 'Surface', orbit: 'Orbit', target: 'Target' };

/** Bottom-centre cluster: G meter, SAS/RCS, SAS modes, throttle arc, navball with speed + heading, burn readout. */
export function NavballCluster({ t, cb, navball, precision, speed }: { t: Telemetry; cb: HudCallbacks; navball: ReactNode; precision?: boolean; speed: (v: number) => string }) {
  const size = useGame(s => s.settings.navballSize);
  const colourBlind = useGame(s => s.settings.colourBlind);
  const controls = !t.eva;
  const canControl = !t.noControl;
  const moving = !t.onSurface || t.speed > 1;
  const available = (id: SasGlyph) => canControl && (
    id === 'stabilityAssist' ? true
      : id === 'target' || id === 'antiTarget' ? !!t.target
        : id === 'maneuver' ? !!t.maneuverBurn
          : moving);
  const pad = 14;
  const wrap = size + pad * 2;
  const speedLabel = t.speedMode === 'surface' && t.dynamicPressure > 50 ? 'Airspeed' : SPEED_LABEL[t.speedMode];
  return (
    <div className="nb-cluster" style={{ ['--nb-size' as string]: `${size}px` }}>
      <div className="nb-housing panel" aria-hidden />
      {controls && <GMeter g={t.gForce} height={Math.round(size * 0.62)} />}
      {controls && (
        <div className="nb-sas-col">
          <div className="nb-toggles">
            <button type="button" className={`nb-toggle ${t.sasOn ? 'on' : ''}`} data-tutorial="sas" disabled={!canControl} aria-pressed={t.sasOn}
              title={`SAS: attitude control (${bindingLabel('toggleSas')} · hold ${bindingLabel('sasHold')} to toggle momentarily)`} onClick={cb.onToggleSas}>SAS</button>
            <button type="button" className={`nb-toggle ${t.rcsOn ? 'on' : ''}`} disabled={!canControl} aria-pressed={t.rcsOn}
              title={`RCS thrusters (${bindingLabel('toggleRcs')})`} onClick={cb.onToggleRcs}>RCS</button>
          </div>
          <div className="nb-modes" role="group" aria-label="SAS modes">
            {SAS_LAYOUT.map(m => {
              const on = t.sasOn && t.sasMode === m.id;
              const ok = available(m.id);
              const color = SAS_COLORS[m.id][colourBlind ? 'colourBlind' : 'normal'];
              return (
                <button key={m.id} type="button" className={`nb-mode ${on ? 'on' : ''} ${m.id === 'stabilityAssist' || m.id === 'maneuver' ? 'wide' : ''}`} disabled={!ok} aria-pressed={on}
                  aria-label={m.label} title={ok ? m.label : `${m.label} — unavailable${m.id === 'maneuver' ? ' (no maneuver node)' : m.id.includes('arget') ? ' (no target)' : ''}`}
                  style={{ ['--mode-color' as string]: color }} onClick={() => cb.onSasMode(m.id)}>
                  <SasIcon mode={m.id} size={20} />
                </button>
              );
            })}
          </div>
          {precision && <div className="nb-fine" title={`Precision controls (${bindingLabel('precision')})`}>FINE</div>}
        </div>
      )}
      <div className="nb-ball" style={{ width: wrap, height: wrap }}>
        <button type="button" className="nb-speed" onClick={cb.onSpeedMode} title="Speed display: click to cycle Surface / Orbit / Target">
          <span className="nb-speed-mode">{speedLabel}</span>
          <span className="nb-speed-value">{speed(t.speed)}</span>
        </button>
        {controls && <ThrottleArc value={t.throttle} size={wrap} />}
        <div className="nb-ball-host" style={{ left: pad, top: pad }}>{navball}</div>
        {controls && (
          <div className="nb-throttle-readout" data-tutorial="throttle" title={`Throttle (${bindingLabel('throttleUp')} / ${bindingLabel('throttleDown')}, ${bindingLabel('throttleFull')} full, ${bindingLabel('throttleCut')} cut)`}>
            {Math.round(t.throttle * 100)}%
          </div>
        )}
        {t.intakeAir !== null && (
          <div className="nb-air" title="Intake air supply / jet demand" data-level={t.intakeAir < 0.5 ? 'bad' : t.intakeAir < 1 ? 'warn' : 'ok'}>
            AIR {(Math.min(t.intakeAir, 9.99) * 100).toFixed(0)}%
          </div>
        )}
      </div>
      {t.maneuverBurn && <BurnInfo burn={t.maneuverBurn} />}
    </div>
  );
}

/** Throttle arc hugging the lower-left of the ball (fills upward from the bottom). */
function ThrottleArc({ value, size }: { value: number; size: number }) {
  const c = size / 2;
  const r = c - 5;
  const a0 = 128, a1 = 232;
  const pt = (deg: number) => `${(c + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(c + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  const arc = (to: number) => `M${pt(a0)}A${r} ${r} 0 0 1 ${pt(to)}`;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg className="nb-throttle" width={size} height={size} aria-hidden>
      <path d={arc(a1)} className="edge" />
      <path d={arc(a1)} className="track" />
      {v > 0.001 && <path d={arc(a0 + (a1 - a0) * v)} className="fill" />}
      {[0, 0.5, 1].map(f => {
        const d = ((a0 + (a1 - a0) * f) * Math.PI) / 180;
        return <line key={f} x1={c + (r - 6) * Math.cos(d)} y1={c + (r - 6) * Math.sin(d)} x2={c + (r + 6) * Math.cos(d)} y2={c + (r + 6) * Math.sin(d)} className="tick" />;
      })}
    </svg>
  );
}

/** Vertical G meter: square-root scale to 10 g, ticks at 1/3/6/9 g. */
function GMeter({ g, height }: { g: number; height: number }) {
  const f = (x: number) => Math.sqrt(Math.max(0, Math.min(10, x)) / 10);
  const level = g > 9 ? 'bad' : g > 6 ? 'warn' : 'ok';
  return (
    <div className="nb-gmeter" title={`G-force ${g.toFixed(2)} g`} data-level={level}>
      <div className="nb-gmeter-bar" style={{ height }}>
        <div className="nb-gmeter-fill" style={{ height: `${f(g) * 100}%` }} />
        {[1, 3, 6, 9].map(x => <div key={x} className={`nb-gmeter-tick ${x === 1 ? 'one' : ''}`} style={{ bottom: `${f(x) * 100}%` }} />)}
      </div>
      <div className="nb-gmeter-label">G</div>
      <div className="nb-gmeter-value">{g.toFixed(1)}</div>
    </div>
  );
}

/** Node burn readout to the right of the navball: remaining Δv with a bar, estimated burn time, node countdown. */
function BurnInfo({ burn }: { burn: NonNullable<Telemetry['maneuverBurn']> }) {
  const frac = burn.dvTotal > 0 ? Math.max(0, Math.min(1, burn.dvRemaining / burn.dvTotal)) : 0;
  // Start the burn half its duration before the node: count down to that moment too.
  const startIn = Number.isFinite(burn.burnTime) ? burn.timeToNode - burn.burnTime / 2 : Number.NaN;
  return (
    <div className="nb-burn" aria-label="Maneuver burn" title="Remaining velocity change, estimated full-throttle burn duration, and time to the maneuver node">
      <div className="nb-burn-row">
        <span className="label">Δv</span>
        <span className="mono nb-burn-dv">{burn.dvRemaining.toFixed(1)} m/s</span>
      </div>
      <div className="nb-burn-bar" title={`${burn.dvRemaining.toFixed(1)} of ${burn.dvTotal.toFixed(1)} m/s remaining`}><div style={{ width: `${frac * 100}%` }} /></div>
      <div className="nb-burn-row">
        <span className="label">Burn</span>
        <span className="mono">{Number.isFinite(burn.burnTime) ? formatDuration(burn.burnTime) : 'no thrust'}</span>
      </div>
      <div className="nb-burn-row">
        <span className="label">Node</span>
        <span className={`mono ${burn.timeToNode < 0 ? 'late' : ''}`}>T{burn.timeToNode < 0 ? '+' : '−'} {formatDuration(Math.abs(burn.timeToNode))}</span>
      </div>
      {Number.isFinite(startIn) && startIn > 0 && <div className="nb-burn-start">start burn in {formatDuration(startIn)}</div>}
    </div>
  );
}
