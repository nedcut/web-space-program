import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bindingLabel, isTyping, matches } from '../../input/bindings';
import { frameProfiler as prof } from '../../util/frameProfiler';
import type { FlightData } from '../../game/flightData';
import { useGame } from '../../game/store';
import type { Astronaut } from '../../sim/crew/crew';
import { formatDistance, formatDuration, formatSpeed } from '../../ui/format';
import { Panel } from '../../ui/components';
import { Navball, type NavballFrame, type NavballMarker } from './navball';
import { DockingIndicator, TargetPanel } from './TargetPanel';
import { AlertStack, Countdown, FlightHint, StageFlash, type FeelTelemetry } from './FeelHud';
import type { WarpTargetId } from '../controller/warp';
import type { ManeuverBurnTelemetry } from '../controller/burn';
import { FlightDataPanel } from './FlightDataPanel';
import { CrewPanel } from './CrewPanel';
import { NavballCluster } from './NavballCluster';
import { StagingStack } from './StagingStack';
import { Altimeter, TimeControl } from './TopBar';
import { AppToolbar, AppWindow, useApps, type AppId, type HudApp, type ToolbarAction } from './AppLauncher';
import { CrewCards } from './CrewCards';
import type { StagePartGlyph } from './glyphs';
import './hud.css';

export type { ManeuverBurnTelemetry } from '../controller/burn';

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
  flightData: FlightData;
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
  warpMode: 'rails' | 'physics';
  warpIndex: number;
  /** Highest rails warp level allowed right now (higher arrows are shown blocked). */
  warpLimit: number;
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
  /** Abort and custom action groups: bound action count and toggle state. */
  actionGroups: { id: string; label: string; key: string; count: number; on: boolean }[];
  /** Lamps on (null = vessel has none). */
  lights: boolean | null;
  /** Prioritised cautions/warnings, camera mode, stage counter (HUD flash) and warp-to state. */
  feel: FeelTelemetry;
  /**
   * Next maneuver node burn (null without a node): remaining Δv, estimated burn time and countdown, shown to the
   * right of the navball. Derived from `World.nodes`, so any node editor (map gizmo, planners) feeds it for free.
   */
  maneuverBurn: ManeuverBurnTelemetry | null;
  /** Mission elapsed time since liftoff, s (null before launch). */
  met: number | null;
  /** Orbit inclination against the body's equator, degrees. */
  inclination: number;
  /** Stage lock (Alt+L) engaged. */
  stageLocked: boolean;
  vesselName: string;
}


export interface HudStage {
  index: number;
  parts: { uid: number; name: string; icon: StagePartGlyph; active: boolean; fuelFrac?: number; heatFrac?: number }[];
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
  /** Open the settings dialog. */
  onSettings?(): void;
  /** Fire a custom action group ('custom1'..'custom10'). */
  onActionGroup?(group: string): void;
  onAbort?(): void;
  onToggleLights?(): void;
  /** Alt+L: lock / unlock staging. */
  onStageLock?(): void;
  /** Staging icon click: open the part's details panel. */
  onSelectPart?(uid: number): void;
  /** Cycle camera mode (V). */
  onCameraMode?(): void;
  /** Warp to an event / cancel warp-to. */
  onWarpTo?(id: WarpTargetId): void;
  onCancelWarpTo?(): void;
  onDismissHint?(): void;
}

export function NavballView({ getFrame }: { getFrame: () => { frame: NavballFrame; markers: NavballMarker[] } | null }) {
  const size = useGame(s => s.settings.navballSize);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nb = new Navball(size);
    host.current!.appendChild(nb.element);
    let raf = 0;
    const loop = () => {
      const t0 = prof.now();
      const f = getFrame();
      if (f) nb.update(f.frame, f.markers);
      prof.add('navball', t0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      nb.dispose();
    };
  }, [getFrame, size]);
  return <div ref={host} className="hud-navball" />;
}

/** App windows supplied by the flight scene (they need the World / controller, not just telemetry). */
export interface HudDockSlots {
  /** Flight-assist panel (null when assist is unavailable, e.g. EVA / no control). */
  assist?: ReactNode;
  /** True while an assist program is running (keeps its status visible). */
  assistActive?: boolean;
  science?: ReactNode;
  signal?: ReactNode;
  /** Surface machinery / resource surveys (shown inside the Resources app). */
  resources?: ReactNode;
  /** Map-mode maneuver planner (left column in map view; owned by the map view). */
  maneuver?: ReactNode;
}

const ORBIT_KEY = 'wsp.hud.orbitStrip.v1';

export function Hud({ t, cb, navball, dock, precision, stageProgress, gamepadConnected, shortcutsEnabled = true, partScreen }: {
  t: Telemetry; cb: HudCallbacks; navball: ReactNode; dock?: HudDockSlots; precision?: boolean; stageProgress?: number; gamepadConnected?: boolean; shortcutsEnabled?: boolean;
  /** Screen position (CSS px) of an active-vessel part, for the staging-icon highlight. */
  partScreen?: (uid: number) => { x: number; y: number } | null;
}) {
  const settings = useGame(s => s.settings);
  const imperial = settings.units === 'imperial';
  const distance = (m: number) => imperial ? (!Number.isFinite(m) ? '—' : Math.abs(m) < 1609.344 ? `${(m / 0.3048).toFixed(0)} ft` : `${(m / 1609.344).toFixed(2)} mi`) : formatDistance(m);
  const speed = useCallback((v: number) => imperial ? `${(v * 2.236936).toFixed(1)} mph` : formatSpeed(v), [imperial]);
  const apps = useApps();
  const [orbitStrip, setOrbitStrip] = useState(() => { try { return sessionStorage.getItem(ORBIT_KEY) === '1'; } catch { return false; } });
  const toggleOrbit = () => setOrbitStrip(v => { try { sessionStorage.setItem(ORBIT_KEY, v ? '0' : '1'); } catch { /* storage unavailable */ } return !v; });
  const [hover, setHover] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<{ uids: number[]; key: number } | null>(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const toggleApp = apps.toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!shortcutsEnabled || e.repeat || isTyping(e.target) || !matches('flightData', e)) return;
      e.preventDefault();
      toggleApp('flightData');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shortcutsEnabled, toggleApp]);
  useEffect(() => {
    if (!picked) return;
    const id = window.setTimeout(() => setPicked(null), 2200);
    return () => window.clearTimeout(id);
  }, [picked]);
  // Stable callbacks so the memoised staging stack only re-renders on stage data changes.
  const stagingCb = useMemo(() => ({
    onStage: () => cbRef.current.onStage(),
    onStageLock: () => cbRef.current.onStageLock?.(),
    onToggleDocking: () => cbRef.current.onToggleDocking(),
    onSelectPart: (uid: number) => { setPicked({ uids: [uid], key: performance.now() }); cbRef.current.onSelectPart?.(uid); },
    onHoverPart: (uids: number[] | null) => setHover(uids),
  }), []);

  const vessel = !t.eva && !t.noControl;
  const hudApps: HudApp[] = [
    { id: 'resources', title: 'Resources', icon: 'resources', width: 250, content: <>
      <ResourceBars resources={t.resources} />
      {dock?.resources}
    </> },
    { id: 'flightData', title: `Flight data (${bindingLabel('flightData')})`, icon: 'flightData', width: 290, content: <FlightDataPanel data={t.flightData} onClose={() => apps.close('flightData')} /> },
    { id: 'science', title: 'Science', icon: 'science', content: dock?.science ?? null },
    { id: 'crew', title: t.eva ? 'EVA' : `Crew (${t.crew.length})`, icon: 'crew', badge: t.noControl ? 'warn' : null, content: <CrewPanel t={t} cb={cb} /> },
    { id: 'assist', title: 'Flight assist', icon: 'assist', badge: dock?.assistActive ? 'on' : null, content: dock?.assist ?? null },
    { id: 'target', title: 'Target & docking', icon: 'target', badge: t.target ? 'target' : null, width: 260, content: <TargetPanel t={t} cb={cb} /> },
    { id: 'comms', title: 'Communications', icon: 'comms', content: dock?.signal ?? null },
  ];
  const actions: ToolbarAction[] = [
    { id: 'orbit', title: t.mapMode ? 'Orbit summary (always shown in map view)' : 'Orbit summary strip', icon: 'orbit', on: orbitStrip || t.mapMode, onClick: toggleOrbit },
    ...(cb.onSettings ? [{ id: 'settings', title: 'Settings', icon: 'settings' as const, onClick: cb.onSettings }] : []),
    ...(cb.onHelp ? [{ id: 'help', title: `Controls help (${bindingLabel('help')})`, icon: 'help' as const, onClick: cb.onHelp }] : []),
  ];
  const openApps = apps.state.open.map(id => hudApps.find(a => a.id === id)).filter((a): a is HudApp => !!a && a.content !== null);
  const docked = openApps.filter(a => !apps.state.pos[a.id]);
  const floating = openApps.filter(a => apps.state.pos[a.id]);
  const showOrbit = (orbitStrip || t.mapMode) && !t.eva;
  const highlight = picked?.uids ?? hover;
  const canStage = !t.eva && !t.noControl && t.stages.length > 0;

  return (
    <div className="overlay hud" style={{ width: `${100 / settings.hudScale}%`, height: `${100 / settings.hudScale}%`, transform: `scale(${settings.hudScale})`, transformOrigin: 'top left' }}>
      {/* Top-left: time warp and clocks; in map view the maneuver planner; docking indicator; staging at the bottom. */}
      <div className="hud-left">
        <TimeControl t={t} cb={cb} />
        {gamepadConnected && <div className="hud-pad mono">GAMEPAD</div>}
        {t.mapMode && dock?.maneuver}
        {t.dockingMode && !t.mapMode && <DockingIndicator d={t.docking} hasTarget={t.target?.kind === 'vessel'} />}
        <div className="hud-left-fill" />
        {!t.eva && t.stages.length > 0 && (
          <StagingStack stages={t.stages} stage={t.stage} locked={t.stageLocked} imperial={imperial} canStage={canStage}
            dockingMode={t.dockingMode} stageProgress={stageProgress} cb={stagingCb} />
        )}
      </div>

      {/* Top-centre: altimeter with status lamps, orbit strip, cautions and messages. */}
      <div className="hud-top">
        <Altimeter t={t} cb={cb} imperial={imperial} />
        {showOrbit && <OrbitStrip t={t} distance={distance} />}
        <div className="hud-messages">
          <AlertStack alerts={t.feel.alerts} />
          {t.messages.map((m) => (
            <Panel key={m.id} className={`hud-msg ${m.level}`}>{m.text}</Panel>
          ))}
        </div>
      </div>

      {/* Top-right: application toolbar, its docked windows; bottom-right: crew portraits, map and camera. */}
      <div className="hud-right">
        <AppToolbar apps={hudApps} open={apps.state.open} onToggle={apps.toggle} actions={actions} />
        <div className="app-stack">
          {docked.map(a => <AppWindow key={a.id} app={a} scale={settings.hudScale} onClose={() => apps.close(a.id)} onMove={(x, y) => apps.move(a.id, x, y)} onDock={() => apps.dock(a.id)} />)}
        </div>
        <CrewCards t={t} cb={cb} />
      </div>
      {floating.map(a => <AppWindow key={a.id} app={a} pos={apps.state.pos[a.id]} scale={settings.hudScale} onClose={() => apps.close(a.id)} onMove={(x, y) => apps.move(a.id, x, y)} onDock={() => apps.dock(a.id)} />)}

      {/* Bottom-centre navball cluster. */}
      <div className="hud-bottom">
        <NavballCluster t={t} cb={vessel || t.eva ? cb : { ...cb, onSasMode: () => {}, onToggleSas: () => {}, onToggleRcs: () => {} }} navball={navball} precision={precision} speed={speed} />
      </div>

      <StageFlash count={t.feel.stagedCount} stage={t.stage} />
      <Countdown value={t.feel.countdown} />
      {!t.mapMode && <FlightHint hint={t.feel.hint} onDismiss={cb.onDismissHint} navballSize={settings.navballSize} />}
      {highlight && partScreen && !t.mapMode && <PartHighlight uids={highlight} at={partScreen} scale={settings.hudScale} strong={!!picked} />}
    </div>
  );
}

/** Compact orbit readout: always on in map view, optional (toolbar) in flight. */
function OrbitStrip({ t, distance }: { t: Telemetry; distance: (m: number) => string }) {
  const dash = t.onSurface;
  const cell = (label: string, value: string, color?: string) => (
    <div className="orbit-cell"><span className="label">{label}</span><span className="mono" style={{ color }}>{dash ? '—' : value}</span></div>
  );
  return (
    <div className="orbit-strip panel" aria-label="Orbit summary">
      {cell('Ap', distance(t.apoapsis))}
      {cell('T-Ap', formatDuration(t.timeToAp))}
      {cell('Pe', distance(t.periapsis), t.periapsis < 0 ? 'var(--bad)' : undefined)}
      {cell('T-Pe', formatDuration(t.timeToPe))}
      {cell('Inc', `${t.inclination.toFixed(1)}°`)}
    </div>
  );
}

function ResourceBars({ resources }: { resources: Telemetry['resources'] }) {
  if (!resources.length) return <div className="app-empty">No resources aboard.</div>;
  return (
    <div className="res-bars">
      {resources.map((r) => {
        const f = r.amount / Math.max(r.max, 1e-9);
        return (
          <div key={r.id} className="res-row" title={`${r.name}: ${(f * 100).toFixed(1)}%`}>
            <div className="res-head"><span>{r.name}</span><span className="mono">{r.amount.toFixed(r.amount < 10 ? 1 : 0)} / {r.max.toFixed(0)}</span></div>
            <div className="res-track"><div style={{ width: `${f * 100}%`, background: r.color }} /></div>
          </div>
        );
      })}
    </div>
  );
}

/** Screen-space rings around parts picked or hovered in the staging stack (no material changes in the 3D scene). */
function PartHighlight({ uids, at, scale, strong }: { uids: number[]; at: (uid: number) => { x: number; y: number } | null; scale: number; strong: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = host.current;
      if (el) {
        for (let i = 0; i < el.children.length; i++) {
          const ring = el.children[i] as HTMLElement;
          const p = at(uids[i]);
          ring.style.display = p ? 'block' : 'none';
          if (p) ring.style.transform = `translate(${p.x / scale}px, ${p.y / scale}px)`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [uids, at, scale]);
  return <div ref={host} className={`part-hl ${strong ? 'strong' : ''}`} aria-hidden>{uids.map(u => <div key={u} className="part-hl-ring" />)}</div>;
}

export type { AppId };
