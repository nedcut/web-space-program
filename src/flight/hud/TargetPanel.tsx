import { useEffect, useState, type CSSProperties } from 'react';
import { SIZE_RADIUS } from '../../data/parts/builders';
import { bindingLabel } from '../../input/bindings';
import { formatDistance, formatDuration, formatSpeed } from '../../ui/format';
import type { DockingTelemetry, HudCallbacks, Telemetry } from './Hud';
import { hoverPorts, portHover } from './PortHighlight';

/** Vessels this close can be flown directly (they share the physics bubble). */
export const SWITCH_RANGE = 5000;
/** Port diameter for a size class ("1.25 m"). */
export const portSize = (size: number) => `${+(2 * (SIZE_RADIUS[size] ?? 0)).toFixed(3)} m`;

/** Bottom-left target panel: pick/clear target, target readouts, closest approach, port choice, docking. */
export function TargetPanel({ t, cb }: { t: Telemetry; cb: HudCallbacks }) {
  const [open, setOpen] = useState(false);
  useEffect(() => () => portHover.set(null), []);
  const tg = t.target;
  const targetVessel = tg?.kind === 'vessel' ? tg : null;
  // Ports that can mate with anything on the other side (equal size), for the size-mismatch hint.
  const ownSizes = new Set(t.ownPorts.map(p => p.size));
  const targetSizes = new Set(targetVessel?.ports.map(p => p.size) ?? []);
  const ownPort = t.ownPorts.find(p => p.uid === (t.docking?.myPortUid ?? t.ownPortUid)) ?? null;
  return (
    <div data-tutorial="target-panel" className="panel target-panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 5, pointerEvents: 'auto', flexShrink: 0 }}>
      <div className="label" style={{ color: tg ? '#ff4fb8' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tg?.name}>
        {tg ? `Target · ${tg.name}` : 'No target'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button title="Choose a vessel or celestial body to target" style={{ flex: 1 }} className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Set target'}</button>
        {tg && <button className="btn small" title="Clear target" onClick={() => cb.onSetTarget(null)}>✕</button>}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflowY: 'auto' }}>
          {t.targetOptions.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Nothing to target</div>}
          {t.targetOptions.map((o) => (
            <div key={o.id} className="tgt-row">
              <button
                title={`Target ${o.name}`}
                className={`btn small ${tg?.id === o.id ? 'primary' : ''}`}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, textAlign: 'left', flex: 1, minWidth: 0 }}
                onClick={() => { cb.onSetTarget(o.id); setOpen(false); }}
              >
                <span className="tgt-name">{o.kind === 'vessel' ? '◇' : '●'} {o.name}</span>
                <span className="mono" style={{ color: 'var(--text-dim)' }}>{formatDistance(o.distance)}</span>
              </button>
              {o.kind === 'vessel' && o.distance < SWITCH_RANGE && cb.onSwitchVessel && (
                <button className="btn small" title={`Fly ${o.name} (switch vessel)`} onClick={() => cb.onSwitchVessel!(o.id)}>Fly</button>
              )}
            </div>
          ))}
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Tip: click an icon in map view to target it. “Fly” switches to a vessel nearby.</div>
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
        </>
      )}
      {targetVessel && targetVessel.ports.length > 0 && (
        <div className="port-pick" role="group" aria-label="Target docking port">
          <span className="label">Target port</span>
          <button title="Aim at the vessel's centre; docking uses the closest free port" className={`btn small ${targetVessel.portUid === null ? 'primary' : ''}`} aria-pressed={targetVessel.portUid === null} onClick={() => cb.onSetTarget(targetVessel.id, null)}>Auto</button>
          {targetVessel.ports.map((p, i) => (
            <button key={p.uid} title={`${p.name} (${portSize(p.size)})${ownSizes.size && !ownSizes.has(p.size) ? ' — no free port of this size on your vessel' : ''}`}
              className={`btn small ${targetVessel.portUid === p.uid ? 'primary' : ''} ${ownSizes.size && !ownSizes.has(p.size) ? 'mismatch' : ''}`}
              aria-pressed={targetVessel.portUid === p.uid}
              onClick={() => cb.onSetTarget(targetVessel.id, p.uid)} {...hoverPorts([{ uid: p.uid, vesselId: targetVessel.id, tone: 'hover', label: `Port ${i + 1}` }])}>
              {i + 1} · {portSize(p.size)}
            </button>
          ))}
        </div>
      )}
      {(targetVessel || t.dockingMode) && t.ownPorts.length > 0 && (
        <div className="port-pick" role="group" aria-label="Your docking port">
          <span className="label">Your port</span>
          {t.ownPorts.length > 1 && cb.onSetOwnPort && (
            <button title="Use whichever free port is closest to the target port" className={`btn small ${t.ownPortUid === null ? 'primary' : ''}`} aria-pressed={t.ownPortUid === null} onClick={() => cb.onSetOwnPort!(null)}>Auto</button>
          )}
          {t.ownPorts.map((p, i) => (
            <button key={p.uid} title={`${p.name} (${portSize(p.size)})${targetSizes.size && !targetSizes.has(p.size) ? ' — target has no free port of this size' : ''}`}
              className={`btn small ${t.ownPortUid === p.uid || (t.ownPorts.length === 1) ? 'primary' : ''} ${targetSizes.size && !targetSizes.has(p.size) ? 'mismatch' : ''}`}
              aria-pressed={t.ownPortUid === p.uid}
              onClick={() => t.ownPorts.length > 1 && cb.onSetOwnPort?.(p.uid)} {...hoverPorts([{ uid: p.uid, tone: 'hover', label: `Your port ${i + 1}` }])}>
              {i + 1} · {portSize(p.size)}
            </button>
          ))}
        </div>
      )}
      {ownPort && cb.onControlFrom && (
        <button className={`btn small ${t.controlFrom?.uid === ownPort.uid ? 'primary' : ''}`} disabled={t.controlFrom?.uid === ownPort.uid}
          title="Point the controls, SAS and navball out of this port (forward = toward the port face)"
          onClick={() => cb.onControlFrom!(ownPort.uid)} {...hoverPorts([{ uid: ownPort.uid, tone: 'own', label: 'Control here' }])}>
          {t.controlFrom?.uid === ownPort.uid ? '◎ Controlling from this port' : '◎ Control from this port'}
        </button>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
        <button title="Show port alignment and target-relative speed" className={`btn small ${t.dockingMode ? 'primary' : ''}`} style={{ flex: 1 }} aria-pressed={t.dockingMode} onClick={cb.onToggleDocking}>Docking mode</button>
        {t.dockedPorts.map((p, i) => (
          <button key={p.uid} className="btn small danger" title={`Undock at ${p.name}`} onClick={() => cb.onUndock(p.uid)} {...hoverPorts([{ uid: p.uid, tone: 'hover', label: 'Undock here' }])}>
            Undock{t.dockedPorts.length > 1 ? ` ${i + 1}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div title={`${label}: ${value}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
      <span className="label">{label}</span>
      <span className="mono" style={{ color }}>{value}</span>
    </div>
  );
}

/** Fixed-point readout without a "-0.00" for values that round to zero. */
export const fixed = (v: number, digits = 2): string => {
  const s = v.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

/** Non-linear radial mapping so both metres and centimetres are readable on the same dial. */
function dial(v: number, range = 25): number {
  const s = Math.sign(v);
  return s * Math.min(1, Math.log10(1 + Math.abs(v) * 20) / Math.log10(1 + range * 20));
}

/** Indicator headline: why the ports will not latch yet, or CAPTURE when the soft-capture field is active. */
export function dockingStatus(d: DockingTelemetry): 'SIZE MISMATCH' | 'REARMING' | 'ALIGN' | 'APPROACH' | 'TOO FAST' | 'MISALIGNED' | 'CAPTURE' {
  if (!d.sizeMatch) return 'SIZE MISMATCH';
  if (!d.armed) return 'REARMING';
  if (Math.hypot(d.x, d.y, d.z) > d.captureRange) {
    // Out of range: ALIGN only while the axes or the lateral offset are outside the capture tolerance.
    return d.angle > d.captureAngle || Math.hypot(d.x, d.y) > d.captureRange ? 'ALIGN' : 'APPROACH';
  }
  if (Math.hypot(d.vx, d.vy, d.vz) > d.captureSpeed) return 'TOO FAST';
  if (d.angle > d.captureAngle) return 'MISALIGNED';
  return 'CAPTURE';
}

/**
 * Docking alignment indicator. Crosshair = active port axis. Magenta dot = target port's lateral offset
 * (x right, y up in the active port frame); ring = target port's facing (centre it to align the axes);
 * arrow = lateral relative velocity. Readouts give the exact numbers and capture limits.
 */
export function DockingIndicator({ d, hasTarget }: { d: DockingTelemetry | null; hasTarget: boolean }) {
  const S = 150;
  const R = S / 2 - 10;
  const box: CSSProperties = { padding: 10, pointerEvents: 'none', flexShrink: 0, width: 214 };
  if (!d) {
    return (
      <div className="panel dock-indicator" style={box} role="group" aria-label="Docking alignment">
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
  const status = dockingStatus(d);
  const good = 'var(--good)', warn = 'var(--warn)', bad = 'var(--bad)';
  // Radial dial mapping (keeps the direction, compresses the distance) so the dot never leaves the dial.
  const lr = Math.hypot(d.x, d.y);
  const dk = lr > 1e-9 ? (dial(lr) * R) / lr : 0;
  const dx = d.x * dk, dy = -d.y * dk;
  const tx = Math.max(-1, Math.min(1, d.tiltX)) * R, ty = -Math.max(-1, Math.min(1, d.tiltY)) * R;
  const vscale = R / Math.max(0.5, latSpeed * 4);
  const vx = d.vx * vscale * 0.6, vy = -d.vy * vscale * 0.6;
  return (
    <div className="panel dock-indicator" style={box} role="group" aria-label="Docking alignment">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="label">Docking</span>
        <span className="mono" style={{ fontSize: 11, color: status === 'CAPTURE' ? good : status === 'ALIGN' || status === 'APPROACH' ? 'var(--text-dim)' : warn }}>{status}</span>
      </div>
      <div className="dock-pair" title={`Your ${d.myPort} → target ${d.targetPort}`}>{d.myPort} → {d.targetPort}</div>
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
        <span className="label">Range</span><span>{fixed(d.z)} m</span><span style={{ color: closing > d.captureSpeed ? bad : closing > 0 ? good : 'var(--text-dim)' }}>{fixed(closing)} m/s</span>
        <span className="label">Right</span><span>{fixed(d.x)} m</span><span>{fixed(d.vx)} m/s</span>
        <span className="label">Up</span><span>{fixed(d.y)} m</span><span>{fixed(d.vy)} m/s</span>
        <span className="label">Align</span><span style={{ color: okAngle ? good : warn }}>{fixed(d.angle, 1)}°</span><span style={{ color: lateral < 0.05 ? good : warn }}>{lateral < 0.05 ? 'centred' : 'offset'}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
        Capture: &lt;{d.captureRange} m, &lt;{d.captureSpeed} m/s, &lt;{d.captureAngle.toFixed(0)}°. Translate: {bindingLabel('translateForward')}/{bindingLabel('translateBack')} fwd/back, {bindingLabel('translateRight')}/{bindingLabel('translateLeft')} right/left, {bindingLabel('translateUp')}/{bindingLabel('translateDown')} up/down.
      </div>
    </div>
  );
}
