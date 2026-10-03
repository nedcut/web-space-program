import { useState, type CSSProperties } from 'react';
import { formatDistance, formatDuration, formatSpeed } from '../../ui/format';
import type { DockingTelemetry, HudCallbacks, Telemetry } from './Hud';

/** Bottom-left target panel: pick/clear target, target readouts, closest approach, port choice, docking. */
export function TargetPanel({ t, cb }: { t: Telemetry; cb: HudCallbacks }) {
  const [open, setOpen] = useState(false);
  const tg = t.target;
  return (
    <div className="panel" style={{ position: 'absolute', left: 10, bottom: 34, width: 250, padding: 10, display: 'flex', flexDirection: 'column', gap: 5, pointerEvents: 'auto' }}>
      <div className="label" style={{ color: tg ? '#ff4fb8' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tg?.name}>
        {tg ? `Target · ${tg.name}` : 'No target'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={{ flex: 1 }} className="btn small" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Set target'}</button>
        {tg && <button className="btn small" title="Clear target" onClick={() => cb.onSetTarget(null)}>✕</button>}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
          {t.targetOptions.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Nothing to target</div>}
          {t.targetOptions.map((o) => (
            <button
              key={o.id}
              className="btn small"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}
              onClick={() => { cb.onSetTarget(o.id); setOpen(false); }}
            >
              <span>{o.kind === 'vessel' ? '◇' : '●'} {o.name}</span>
              <span className="mono" style={{ color: 'var(--text-dim)' }}>{formatDistance(o.distance)}</span>
            </button>
          ))}
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Tip: click an icon in map view to target it.</div>
        </div>
      )}
      {tg && (
        <>
          <Row label="Distance" value={formatDistance(tg.distance)} />
          <Row label="Rel. speed" value={formatSpeed(tg.relSpeed)} />
          <Row label="Closing" value={formatSpeed(tg.closing)} color={tg.closing > 0 ? 'var(--good)' : 'var(--text-dim)'} />
          {tg.approach && (
            <Row
              label="Closest appr."
              value={`${formatDistance(tg.approach.distance)} · ${formatDuration(Math.max(0, tg.approach.time))}`}
            />
          )}
          {tg.ports.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              <span className="label" style={{ width: '100%' }}>Target port</span>
              <button className={`btn small ${tg.portUid === null ? 'primary' : ''}`} onClick={() => cb.onSetTarget(tg.id, null)}>Vessel</button>
              {tg.ports.map((p, i) => (
                <button key={p.uid} title={p.name} className={`btn small ${tg.portUid === p.uid ? 'primary' : ''}`} onClick={() => cb.onSetTarget(tg.id, p.uid)}>
                  Port {i + 1}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button className={`btn small ${t.dockingMode ? 'primary' : ''}`} style={{ flex: 1 }} onClick={cb.onToggleDocking}>Docking mode</button>
        {t.dockedPorts.map((p, i) => (
          <button key={p.uid} className="btn small danger" title={`Undock at ${p.name}`} onClick={() => cb.onUndock(p.uid)}>
            Undock{t.dockedPorts.length > 1 ? ` ${i + 1}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
      <span className="label">{label}</span>
      <span className="mono" style={{ color }}>{value}</span>
    </div>
  );
}

/** Non-linear radial mapping so both metres and centimetres are readable on the same dial. */
function dial(v: number, range = 25): number {
  const s = Math.sign(v);
  return s * Math.min(1, Math.log10(1 + Math.abs(v) * 20) / Math.log10(1 + range * 20));
}

/**
 * Docking alignment indicator. Crosshair = active port axis. Magenta dot = target port's lateral offset
 * (x right, y up in the active port frame); ring = target port's facing (centre it to align the axes);
 * arrow = lateral relative velocity. Readouts give the exact numbers and capture limits.
 */
export function DockingIndicator({ d, hasTarget }: { d: DockingTelemetry | null; hasTarget: boolean }) {
  const S = 180;
  const R = S / 2 - 10;
  const box: CSSProperties = { position: 'absolute', left: 10, top: 110, width: 210, padding: 10, pointerEvents: 'none' };
  if (!d) {
    return (
      <div className="panel" style={box}>
        <div className="label">Docking mode</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          {hasTarget ? 'No free docking port pair (need a free port on both vessels).' : 'Target a vessel with a docking port.'}
        </div>
      </div>
    );
  }
  const lateral = Math.hypot(d.x, d.y);
  const latSpeed = Math.hypot(d.vx, d.vy);
  const closing = -d.vz;
  const okAngle = d.angle < d.captureAngle;
  const okSpeed = Math.hypot(d.vx, d.vy, d.vz) < d.captureSpeed;
  const inRange = Math.hypot(d.x, d.y, d.z) < d.captureRange;
  const good = 'var(--good)', warn = 'var(--warn)', bad = 'var(--bad)';
  // Radial dial mapping (keeps the direction, compresses the distance) so the dot never leaves the dial.
  const lr = Math.hypot(d.x, d.y);
  const dk = lr > 1e-9 ? (dial(lr) * R) / lr : 0;
  const dx = d.x * dk, dy = -d.y * dk;
  const tx = Math.max(-1, Math.min(1, d.tiltX)) * R, ty = -Math.max(-1, Math.min(1, d.tiltY)) * R;
  const vscale = R / Math.max(0.5, latSpeed * 4);
  const vx = d.vx * vscale * 0.6, vy = -d.vy * vscale * 0.6;
  return (
    <div className="panel" style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="label">Docking</span>
        <span className="mono" style={{ fontSize: 11, color: inRange ? good : 'var(--text-dim)' }}>{inRange ? 'CAPTURE' : d.sizeMatch ? 'ALIGN' : 'SIZE MISMATCH'}</span>
      </div>
      <svg width={S} height={S} viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} style={{ display: 'block', margin: '6px auto' }}>
        <circle r={R} fill="rgba(0,0,0,0.35)" stroke="rgba(140,180,255,0.35)" />
        <circle r={R * dial(1)} fill="none" stroke="rgba(140,180,255,0.18)" strokeDasharray="3 3" />
        <circle r={R * dial(0.1)} fill="none" stroke="rgba(140,180,255,0.18)" strokeDasharray="2 3" />
        <line x1={-R} x2={R} y1={0} y2={0} stroke="rgba(140,180,255,0.35)" />
        <line y1={-R} y2={R} x1={0} x2={0} stroke="rgba(140,180,255,0.35)" />
        <circle cx={tx} cy={ty} r={14} fill="none" stroke={okAngle ? good : warn} strokeWidth={2} />
        {latSpeed > 0.002 && <line x1={dx} y1={dy} x2={dx + vx} y2={dy + vy} stroke="#ffd0ec" strokeWidth={2} />}
        <circle cx={dx} cy={dy} r={6} fill="#ff4fb8" />
      </svg>
      <div className="mono" style={{ fontSize: 11, display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', columnGap: 8, rowGap: 1 }}>
        <span className="label">Range</span><span>{d.z.toFixed(2)} m</span><span style={{ color: closing > d.captureSpeed ? bad : closing > 0 ? good : 'var(--text-dim)' }}>{closing.toFixed(2)} m/s</span>
        <span className="label">Right</span><span>{d.x.toFixed(2)} m</span><span>{d.vx.toFixed(2)} m/s</span>
        <span className="label">Up</span><span>{d.y.toFixed(2)} m</span><span>{d.vy.toFixed(2)} m/s</span>
        <span className="label">Align</span><span style={{ color: okAngle ? good : warn }}>{d.angle.toFixed(1)}°</span><span style={{ color: okSpeed ? good : warn }}>{lateral < 0.05 ? 'centred' : 'offset'}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
        Capture: &lt;{d.captureRange} m, &lt;{d.captureSpeed} m/s, &lt;{d.captureAngle.toFixed(0)}°. Translate: I/K fwd/back, L/J right/left, H/N up/down.
      </div>
    </div>
  );
}
