import { CrewPanel } from './CrewPanel';
import type { Astronaut } from '../../sim/crew/crew';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  crew: Astronaut[];
  noControl: boolean;
  eva: { fuel: number; canBoard: boolean; landed: boolean } | null;
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
  /** Landed, splashed or still on the pad: orbital readouts are meaningless and shown as dashes. */
  onSurface: boolean;
  assist: { name: string; status: string } | null;
  /** Landing gear / legs state (null = vessel has none). */
  gear: 'up' | 'down' | 'moving' | null;
  /** Wheel brakes held (null = no wheels). */
  brakes: boolean | null;
  /** Jet intake air supply / demand (null = no air-breathing engine running). */
  intakeAir: number | null;
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
  onEva(astronautId: string): void;
  onBoard(): void;
  onPlantFlag(): void;
  onStage(): void;
  onToggleSas(): void;
  onSasMode(mode: string): void;
  onToggleRcs(): void;
  onWarp(delta: number): void;
  onMap(): void;
  onMenu(): void;
  onSpeedMode(): void;
  /** G: raise / lower landing gear. */
  onToggleGear?(): void;
  onSetTarget(id: string | null, portUid?: number | null): void;
  onToggleDocking(): void;
  onUndock(portUid?: number): void;
  /** Open the controls help overlay. */
  onHelp?(): void;
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

/** Left-column dock sections that can be toggled from the chip bar. */
type DockId = 'assist' | 'crew' | 'science' | 'resources' | 'target';
const DOCK_KEY = 'wsp.hud.dock.v1';

function loadDock(): Set<DockId> {
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    return new Set(raw ? (JSON.parse(raw) as DockId[]) : []);
  } catch {
    return new Set();
  }
}

export interface HudDockSlots {
  /** Flight-assist panel (null when assist is unavailable, e.g. EVA / no control). */
  assist?: ReactNode;
  /** True while an assist program is running (keeps its status visible). */
  assistActive?: boolean;
  science?: ReactNode;
  signal?: ReactNode;
  resources?: ReactNode;
  /** Map-mode maneuver planner (rendered at the top of the dock in map view). */
  maneuver?: ReactNode;
}

export function Hud({ t, cb, navball, dock }: { t: Telemetry; cb: HudCallbacks; navball: ReactNode; dock?: HudDockSlots }) {
  const [open, setOpen] = useState<Set<DockId>>(loadDock);
  const toggle = (id: DockId) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(DOCK_KEY, JSON.stringify([...n]));
      } catch {
        /* storage unavailable */
      }
      return n;
    });
  };
  const dash = t.onSurface;
  const showAssistChip = !!dock?.assist && !t.mapMode;
  const showCrewChip = !t.mapMode && !t.dockingMode;
  const showScienceChip = !!dock?.science && !t.mapMode;
  const crewOpen = showCrewChip && (open.has('crew') || !!t.eva);
  const targetOpen = open.has('target') || !!t.target;
  const chip = (id: DockId, label: string, title: string, extra?: ReactNode) => (
    <button
      key={id}
      data-tutorial={id}
      className={`btn small hud-chip ${open.has(id) ? 'on' : ''}`}
      title={title}
      aria-pressed={open.has(id)}
      onClick={() => toggle(id)}
    >
      {label}
      {extra}
    </button>
  );
  return (
    <div className="overlay">
      {/* Top bar: time, warp, altitude */}
      <div className="panel" style={{ position: 'absolute', top: 10, left: 10, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn small" onClick={cb.onMenu} title="Pause menu (Esc)">☰</button>
        <div className="mono hud-date" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{formatDate(t.ut)}</div>
        <button className="btn small" onClick={() => cb.onWarp(-1)} title="Slower time warp ( , )">◀</button>
        <div className="mono" style={{ minWidth: 64, textAlign: 'center', color: t.physicsWarp ? 'var(--warn)' : 'var(--accent)' }} title="Time warp">
          {t.warpLabel}
        </div>
        <button className="btn small" onClick={() => cb.onWarp(1)} title="Faster time warp ( . )">▶</button>
        <button className={`btn small ${t.mapMode ? 'primary' : ''}`} data-tutorial="map" onClick={cb.onMap} title="Map view (M)">MAP</button>
        {cb.onHelp && <button className="btn small" onClick={cb.onHelp} title="Controls help (F1)">?</button>}
      </div>

      <div className="panel" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', textAlign: 'center' }}>
        <div className="label">{t.bodyName} · altitude</div>
        <div className="mono" style={{ fontSize: 26 }}>{formatDistance(t.altitudeAsl)}</div>
        {t.altitudeTerrain < 5000 && <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>radar {formatDistance(t.altitudeTerrain)}</div>}
      </div>

      {/* Right column: orbit info + resources (stacked so they never overlap) */}
      <div className="hud-right">
        <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Readout label="Apoapsis" value={dash ? '—' : formatDistance(t.apoapsis)} />
          <Readout label="T-Ap" value={dash ? '—' : formatDuration(t.timeToAp)} />
          <Readout label="Periapsis" value={dash ? '—' : formatDistance(t.periapsis)} color={!dash && t.periapsis < 0 ? 'var(--bad)' : undefined} />
          <Readout label="T-Pe" value={dash ? '—' : formatDuration(t.timeToPe)} />
          <div style={{ height: 6 }} />
          <Readout label="Vert. speed" value={formatSpeed(t.verticalSpeed)} />
          <Readout label="G-force" value={t.gForce.toFixed(2)} color={t.gForce > 6 ? 'var(--bad)' : undefined} />
          <Readout label="Mach" value={t.mach.toFixed(2)} />
          <Readout label="Dyn. press." value={`${(t.dynamicPressure / 1000).toFixed(1)} kPa`} />
        </div>
        {t.resources.length > 0 && (
          <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        )}
      </div>

      {/* Staging stack */}
      <div className="hud-stages">
        {!t.eva && !t.noControl && t.stages.length > 0 && (
          <button className="btn small" onClick={cb.onStage} title="Activate the next stage (Space)" style={{ width: 180, flexShrink: 0 }}>
            Stage · Space
          </button>
        )}
        {t.stages.map((s) => (
          <div key={s.index} className="panel" style={{ padding: 8, width: 180, flexShrink: 0, borderColor: s.index === t.stage ? 'var(--accent)' : s.parts.some((p) => p.active) ? 'var(--accent-2)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label" style={{ color: s.index === t.stage ? 'var(--accent)' : undefined }} title={s.index === t.stage ? 'Fires on the next Space press' : undefined}>{s.parts.some((p) => p.active) ? 'Active' : `${s.index === t.stage ? '▸ ' : ''}Stage ${s.index}`}</span>
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
        {!t.eva && <div className="panel" style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, width: 130 }}>
          <button className={`btn small ${t.sasOn ? 'primary' : ''}`} style={{ gridColumn: 'span 2' }} data-tutorial="sas" onClick={cb.onToggleSas} title="Stability assist (T)">SAS</button>
          {SAS_MODES.map((m) => (
            <button key={m.id} className={`btn small ${t.sasOn && t.sasMode === m.id ? 'primary' : ''}`} onClick={() => cb.onSasMode(m.id)} style={{ padding: '4px 2px', fontSize: 10 }}>
              {m.label}
            </button>
          ))}
          <button className={`btn small ${t.rcsOn ? 'primary' : ''}`} style={{ gridColumn: 'span 2' }} onClick={cb.onToggleRcs} title="Reaction control thrusters (R)">RCS</button>
          {t.gear !== null && (
            <button
              className={`btn small ${t.gear === 'down' ? 'primary' : ''}`}
              style={{ padding: '4px 2px', fontSize: 10, color: t.gear === 'moving' ? 'var(--warn)' : undefined }}
              title="Landing gear (G)"
              onClick={() => cb.onToggleGear?.()}
            >
              GEAR {t.gear === 'down' ? '▼' : t.gear === 'up' ? '▲' : '…'}
            </button>
          )}
          {t.brakes !== null && (
            <span className={`btn small ${t.brakes ? 'primary' : ''}`} style={{ padding: '4px 2px', fontSize: 10, textAlign: 'center', color: t.brakes ? 'var(--bad)' : undefined }} title="Wheel brakes (hold B)">
              BRAKES
            </span>
          )}
          {t.intakeAir !== null && (
            <span className="mono" style={{ gridColumn: 'span 2', fontSize: 10, textAlign: 'center', color: t.intakeAir < 0.5 ? 'var(--bad)' : t.intakeAir < 1 ? 'var(--warn)' : 'var(--text-dim)' }} title="Intake air supply / jet demand">
              AIR {(Math.min(t.intakeAir, 9.99) * 100).toFixed(0)}%
            </span>
          )}
        </div>}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <button className="panel btn" onClick={cb.onSpeedMode} title="Click to switch surface / orbit / target speed" style={{ padding: '4px 14px', marginBottom: 6, textAlign: 'center' }}>
            <div className="label">{t.speedMode === 'surface' && t.dynamicPressure > 50 ? 'airspeed' : t.speedMode}</div>
            <div className="mono" style={{ fontSize: 18 }}>{formatSpeed(t.speed)}</div>
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            {!t.eva && <span data-tutorial="throttle"><ThrottleGauge value={t.throttle} /></span>}
            {navball}
          </div>
        </div>
      </div>

      {/* Left dock: compact toggles; panels expand underneath and scroll if space runs out. */}
      <div className="hud-dock">
        {dock?.signal}
        {t.mapMode && dock?.maneuver}
        <div className="hud-chips">
          {showAssistChip && chip('assist', 'Assist', 'Flight assist (autopilot programs)', dock?.assistActive ? <span className="hud-dot" /> : null)}
          {showCrewChip && chip('crew', t.eva ? 'EVA' : `Crew ${t.crew.length}`, 'Crew and EVA', t.noControl ? <span className="hud-dot warn" /> : null)}
          {showScienceChip && chip('science', 'Science', 'Science instruments and data')}
          {dock?.resources && chip('resources', 'Resources', 'Surface machinery and resource surveys')}
          {chip('target', 'Target', 'Navigation target and docking', t.target ? <span className="hud-dot target" /> : null)}
        </div>
        {showAssistChip && (open.has('assist') || dock?.assistActive) && dock?.assist}
        {t.dockingMode && !t.mapMode && <DockingIndicator d={t.docking} hasTarget={t.target?.kind === 'vessel'} />}
        {crewOpen && <CrewPanel t={t} cb={cb} />}
        {showScienceChip && open.has('science') && dock?.science}
        {open.has('resources') && dock?.resources}
        {targetOpen && <TargetPanel t={t} cb={cb} />}
      </div>

      {/* Messages */}
      <div style={{ position: 'absolute', top: 100, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', pointerEvents: 'none' }}>
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
