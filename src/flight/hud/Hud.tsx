import { useEffect, useRef, type ReactNode } from 'react';
import { formatDistance, formatSpeed, formatDuration, formatDate } from '../../ui/format';
import { Navball, type NavballFrame, type NavballMarker } from './navball';
import { DockingIndicator, TargetPanel } from './TargetPanel';

/** Docking alignment readout: target port relative to the active port's frame (x right, y up, z along axis). */
export interface DockingTelemetry {
  myPort: string;
  targetPort: string;
  sizeMatch: boolean;
  /** Target face position in the active port frame, m. */
  x: number;
  y: number;
  z: number;
  /** Target face velocity relative to the active face, port frame, m/s. */
  vx: number;
  vy: number;
  vz: number;
  /** Angle between the active port axis and the reversed target port axis, degrees. */
  angle: number;
  /** Target port facing direction (reversed) projected on the active port's right/up axes. */
  tiltX: number;
  tiltY: number;
  captureRange: number;
  captureSpeed: number;
  /** Degrees. */
  captureAngle: number;
}

export interface TargetTelemetry {
  id: string;
  name: string;
  kind: 'vessel' | 'body';
  /** Distance to target (bodies: to the surface), m. */
  distance: number;
  relSpeed: number;
  /** Closing speed (positive = approaching), m/s. */
  closing: number;
  portUid: number | null;
  ports: { uid: number; name: string }[];
  approach: { distance: number; time: number; relSpeed: number } | null;
}

/** Snapshot of telemetry pushed to the HUD ~10–20 times per second (not every frame). */
export interface Telemetry {
  ut: number;
  bodyName: string;
  altitudeAsl: number;
  altitudeTerrain: number;
  speedMode: 'surface' | 'orbit' | 'target';
  speed: number;
  verticalSpeed: number;
  apoapsis: number;
  periapsis: number;
  timeToAp: number;
  timeToPe: number;
  throttle: number;
  gForce: number;
  mach: number;
  dynamicPressure: number;
  warp: number;
  warpLabel: string;
  physicsWarp: boolean;
  sasOn: boolean;
  sasMode: string;
  rcsOn: boolean;
  stage: number;
  stages: HudStage[];
  resources: { id: string; name: string; amount: number; max: number; color: string }[];
  messages: { id: number; text: string; level: 'info' | 'warn' | 'bad' }[];
  mapMode: boolean;
  assist: { name: string; status: string } | null;
  target: TargetTelemetry | null;
  targetOptions: { id: string; name: string; kind: 'vessel' | 'body'; distance: number }[];
  dockingMode: boolean;
  docking: DockingTelemetry | null;
  /** Docking ports of the active vessel that join two halves (undock candidates). */
  dockedPorts: { uid: number; name: string }[];
}

export interface HudStage {
  index: number;
  parts: { uid: number; name: string; icon: 'engine' | 'decoupler' | 'chute' | 'other'; active: boolean; fuelFrac?: number }[];
  deltaV: number;
}

export interface HudCallbacks {
  onStage(): void;
  onToggleSas(): void;
  onSasMode(mode: string): void;
  onToggleRcs(): void;
  onWarp(delta: number): void;
  onMap(): void;
  onMenu(): void;
  onSpeedMode(): void;
  onSetTarget(id: string | null, portUid?: number | null): void;
  onToggleDocking(): void;
  onUndock(portUid?: number): void;
}

const SAS_MODES: { id: string; label: string }[] = [
  { id: 'stabilityAssist', label: 'HOLD' },
  { id: 'prograde', label: 'PRO' },
  { id: 'retrograde', label: 'RETRO' },
  { id: 'normal', label: 'NRM' },
  { id: 'antinormal', label: 'A-NRM' },
  { id: 'radialOut', label: 'RAD+' },
  { id: 'radialIn', label: 'RAD−' },
  { id: 'maneuver', label: 'MNV' },
  { id: 'target', label: 'TGT' },
  { id: 'antiTarget', label: 'A-TGT' },
];

export function NavballView({ getFrame }: { getFrame: () => { frame: NavballFrame; markers: NavballMarker[] } | null }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nb = new Navball(200);
    host.current!.appendChild(nb.element);
    let raf = 0;
    const loop = () => {
      const f = getFrame();
      if (f) nb.update(f.frame, f.markers);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      nb.dispose();
    };
  }, [getFrame]);
  return <div ref={host} />;
}

function Readout({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <span className="label">{label}</span>
      <span className="mono" style={{ color }}>{value}</span>
    </div>
  );
}

export function Hud({ t, cb, navball }: { t: Telemetry; cb: HudCallbacks; navball: ReactNode }) {
  return (
    <div className="overlay">
      {/* Top bar: time, warp, altitude */}
      <div className="panel" style={{ position: 'absolute', top: 10, left: 10, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn small" onClick={cb.onMenu}>☰</button>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{formatDate(t.ut)}</div>
        <button className="btn small" onClick={() => cb.onWarp(-1)}>◀</button>
        <div className="mono" style={{ minWidth: 64, textAlign: 'center', color: t.physicsWarp ? 'var(--warn)' : 'var(--accent)' }}>
          {t.warpLabel}
        </div>
        <button className="btn small" onClick={() => cb.onWarp(1)}>▶</button>
        <button className="btn small" onClick={cb.onMap}>MAP</button>
      </div>

      <div className="panel" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', textAlign: 'center' }}>
        <div className="label">{t.bodyName} · altitude</div>
        <div className="mono" style={{ fontSize: 26 }}>{formatDistance(t.altitudeAsl)}</div>
        {t.altitudeTerrain < 5000 && <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>radar {formatDistance(t.altitudeTerrain)}</div>}
      </div>

      {/* Orbit info */}
      <div className="panel" style={{ position: 'absolute', top: 10, right: 10, padding: 12, width: 230, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Readout label="Apoapsis" value={formatDistance(t.apoapsis)} />
        <Readout label="T-Ap" value={formatDuration(t.timeToAp)} />
        <Readout label="Periapsis" value={formatDistance(t.periapsis)} color={t.periapsis < 0 ? 'var(--bad)' : undefined} />
        <Readout label="T-Pe" value={formatDuration(t.timeToPe)} />
        <div style={{ height: 6 }} />
        <Readout label="Vert. speed" value={formatSpeed(t.verticalSpeed)} />
        <Readout label="G-force" value={t.gForce.toFixed(2)} color={t.gForce > 6 ? 'var(--bad)' : undefined} />
        <Readout label="Mach" value={t.mach.toFixed(2)} />
        <Readout label="Dyn. press." value={`${(t.dynamicPressure / 1000).toFixed(1)} kPa`} />
      </div>

      {/* Resources */}
      <div className="panel" style={{ position: 'absolute', top: 210, right: 10, padding: 12, width: 230, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {t.resources.map((r) => (
          <div key={r.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span className="label">{r.name}</span>
              <span className="mono">{r.amount.toFixed(0)}/{r.max.toFixed(0)}</span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
              <div style={{ width: `${(100 * r.amount) / Math.max(r.max, 1e-9)}%`, height: '100%', background: r.color, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Staging stack */}
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column-reverse', gap: 6, maxHeight: '45vh', overflowY: 'auto' }}>
        {t.stages.map((s) => (
          <div key={s.index} className="panel" style={{ padding: 8, width: 180, borderColor: s.index === t.stage ? 'var(--accent)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label">Stage {s.index}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent-2)' }}>{s.deltaV.toFixed(0)} m/s</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {s.parts.map((p) => (
                <span key={p.uid} title={p.name} style={{ fontSize: 16, opacity: p.active ? 1 : 0.6 }}>
                  {p.icon === 'engine' ? '🔥' : p.icon === 'decoupler' ? '⫘' : p.icon === 'chute' ? '☂' : '◆'}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom-centre: navball + speed + SAS */}
      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div className="panel" style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, width: 130 }}>
          <button className={`btn small ${t.sasOn ? 'primary' : ''}`} style={{ gridColumn: 'span 2' }} onClick={cb.onToggleSas}>SAS</button>
          {SAS_MODES.map((m) => (
            <button key={m.id} className={`btn small ${t.sasOn && t.sasMode === m.id ? 'primary' : ''}`} onClick={() => cb.onSasMode(m.id)} style={{ padding: '4px 2px', fontSize: 10 }}>
              {m.label}
            </button>
          ))}
          <button className={`btn small ${t.rcsOn ? 'primary' : ''}`} style={{ gridColumn: 'span 2' }} onClick={cb.onToggleRcs}>RCS</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <button className="panel btn" onClick={cb.onSpeedMode} style={{ padding: '4px 14px', marginBottom: 6, textAlign: 'center' }}>
            <div className="label">{t.speedMode}</div>
            <div className="mono" style={{ fontSize: 18 }}>{formatSpeed(t.speed)}</div>
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <ThrottleGauge value={t.throttle} />
            {navball}
          </div>
        </div>
      </div>

      <TargetPanel t={t} cb={cb} />
      {t.dockingMode && <DockingIndicator d={t.docking} hasTarget={t.target?.kind === 'vessel'} />}

      {/* Messages */}
      <div style={{ position: 'absolute', top: 100, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {t.messages.map((m) => (
          <div key={m.id} className="panel" style={{ padding: '6px 14px', color: m.level === 'bad' ? 'var(--bad)' : m.level === 'warn' ? 'var(--warn)' : 'var(--text)' }}>
            {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThrottleGauge({ value }: { value: number }) {
  return (
    <div className="panel" style={{ width: 22, height: 180, padding: 3, display: 'flex', flexDirection: 'column-reverse' }}>
      <div style={{ height: `${value * 100}%`, background: 'linear-gradient(0deg, #ff8a3c, #ffd166)', borderRadius: 4, transition: 'height 0.08s' }} />
    </div>
  );
}
