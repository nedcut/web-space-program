import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { bindingLabel, isTyping, matches } from '../../input/bindings';
import { frameProfiler as prof } from '../../util/frameProfiler';
import type { FlightData } from '../../game/flightData';
import { useGame } from '../../game/store';
import type { Astronaut } from '../../sim/crew/crew';
import { formatDistance, formatDuration, formatSpeed } from '../../ui/format';
import { Panel } from '../../ui/components';
import { Navball, type NavballFrame, type NavballMarker } from './navball';
import { DockingIndicator, TargetPanel } from './TargetPanel';
import { AlertStack, Countdown, FlightHint, type FeelTelemetry } from './FeelHud';
import type { WarpTargetId } from '../controller/warp';
import type { ManeuverBurnTelemetry } from '../controller/burn';
import type { ChuteLamp } from '../alerts';
import { FlightDataPanel } from './FlightDataPanel';
import { CrewPanel } from './CrewPanel';
import { NavballCluster } from './NavballCluster';
import { StagingStack } from './StagingStack';
import { Altimeter, TimeControl } from './TopBar';
import { AppToolbar, AppWindow, useAppEscape, useApps, type AppId, type HudApp, type ToolbarAction } from './AppLauncher';
import { ResizeGrip, useWinSizes } from './Resizable';
import { limits as sizeLimits } from './windowSize';
import { CrewCards } from './CrewCards';
import { PortHighlight, type PartScreenInto, type PortMark } from './PortHighlight';
import type { StagePartGlyph } from './glyphs';
import './hud.css';

export type { ManeuverBurnTelemetry } from '../controller/burn';

/** Docking alignment readout: target port relative to the active port's frame (x right, y up, z along axis). */
export interface DockingTelemetry {
  myPort: string;
  targetPort: string;
  /** Part uids of the port pair (for the 3D highlight) and the vessel the target port belongs to. */
  myPortUid: number;
  targetPortUid: number;
  targetId: string;
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
  /** False while either port is disarmed after an undock (re-arms once the ports drift clear). */
  armed: boolean;
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
  ports: { uid: number; name: string; size: number }[];
  approach: { distance: number; time: number; relSpeed: number } | null;
}

/** Snapshot of telemetry pushed to the HUD ~10–20 times per second (not every frame). */
export interface Telemetry {
  flightData: FlightData;
  engineering?: { stageDeltaV: number; twr: number; burnCountdown: number | null; impactTime: number | null };
  /** Control trim, null when centred; `held` while SAS is on (trim is then not applied). */
  trim?: { pitch: number; yaw: number; roll: number; held: boolean } | null;
  crew: Astronaut[];
  noControl: boolean;
  /** Experiments aboard that would add science here (lights the Science app). */
  scienceReady?: number;
  /** Active astronaut: jetpack gas (kg), jetpack switch, boarding state, feet on the ground (or water). */
  eva: { fuel: number; jetpack: boolean; canBoard: boolean; boardHint: string | null; landed: boolean } | null;
  ut: number;
  bodyName: string;
  altitudeAsl: number;
  altitudeTerrain: number;
  speedMode: 'surface' | 'orbit' | 'target';
  speedAutomatic?: boolean;
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
  /** Pressure the staging Δv figures are computed at, and the same stages' total in vacuum. */
  dvAt: 'asl' | 'atm' | 'vac';
  totalDvVac: number;
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
  /** Parachute lamp (null = none fitted) and the lowest opening load of armed chutes, Pa. */
  chute: ChuteLamp | null;
  chuteRating: number;
  /** Jet intake air supply / demand (null = no air-breathing engine running). */
  intakeAir: number | null;
  target: TargetTelemetry | null;
  targetOptions: { id: string; name: string; kind: 'vessel' | 'body'; distance: number }[];
  dockingMode: boolean;
  docking: DockingTelemetry | null;
  /** Docking ports of the active vessel that join two halves (undock candidates). */
  dockedPorts: { uid: number; name: string }[];
  /** Free docking ports of the active vessel (filled only while a vessel is targeted or in docking mode). */
  ownPorts: { uid: number; name: string; size: number }[];
  /** Own port chosen for docking (null = automatic). */
  ownPortUid: number | null;
  /** Part the vessel is controlled from ("control from here"), null = as built. */
  controlFrom: { uid: number; name: string; port: boolean } | null;
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
  /** Night vision (render-only fill light in shadow). */
  nightVision: boolean;
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
  /** Choose the active vessel's docking port (null = automatic). */
  onSetOwnPort?(uid: number | null): void;
  /** Control the vessel from a command part or docking port. */
  onControlFrom?(uid: number): void;
  /** Fly another vessel within physics range. */
  onSwitchVessel?(id: string): void;
  /** Open the controls help overlay. */
  onHelp?(): void;
  /** Open the settings dialog. */
  onSettings?(): void;
  /** Fire a custom action group ('custom1'..'custom10'). */
  onActionGroup?(group: string): void;
  onAbort?(): void;
  onToggleLights?(): void;
  onToggleNightVision?(): void;
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
  alarms?: ReactNode;
  alarmActive?: boolean;
  onboarding?: ReactNode;
  /** Offer to recover a vessel that has come to rest on Earth (landed or splashed down). */
  recovery?: ReactNode;
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
  /** Station overview: docked modules, crew, control points, ports, nearby vessels. */
  station?: ReactNode;
}

const ENGINEERING_KEY = 'wsp.hud.engineeringStrip.v1';
/** Map planner column width (the column's CSS width is the default). Height follows the column. */
const PLANNER_LIMITS = sizeLimits({ minW: 240, maxW: 480 });
const ORBIT_KEY = 'wsp.hud.orbitStrip.v1';

export function Hud({ t, cb, navball, dock, precision, stageProgress, gamepadConnected, shortcutsEnabled = true, partScreen, partScreenInto }: {
  t: Telemetry; cb: HudCallbacks; navball: ReactNode; dock?: HudDockSlots; precision?: boolean; stageProgress?: number; gamepadConnected?: boolean; shortcutsEnabled?: boolean;
  /** Screen position (CSS px) of an active-vessel part, for the staging-icon highlight. */
  partScreen?: (uid: number) => { x: number; y: number } | null;
  /** Allocation-free screen position of any vessel's part, for the docking-port highlight. */
  partScreenInto?: PartScreenInto;
}) {
  const settings = useGame(s => s.settings);
  const imperial = settings.units === 'imperial';
  const distance = (m: number) => imperial ? (!Number.isFinite(m) ? '—' : Math.abs(m) < 1609.344 ? `${(m / 0.3048).toFixed(0)} ft` : `${(m / 1609.344).toFixed(2)} mi`) : formatDistance(m);
  const speed = useCallback((v: number) => imperial ? `${(v * 2.236936).toFixed(1)} mph` : formatSpeed(v), [imperial]);
  const apps = useApps();
  const { sizes, setSize } = useWinSizes();
  const leftRef = useRef<HTMLDivElement>(null);
  const [engineeringStrip, setEngineeringStrip] = useState(() => { try { return sessionStorage.getItem(ENGINEERING_KEY) === '1'; } catch { return false; } });
  const toggleEngineering = () => setEngineeringStrip(v => { try { sessionStorage.setItem(ENGINEERING_KEY, v ? '0' : '1'); } catch { /* storage unavailable */ } return !v; });
  const [orbitStrip, setOrbitStrip] = useState(() => { try { return sessionStorage.getItem(ORBIT_KEY) === '1'; } catch { return false; } });
  const toggleOrbit = () => setOrbitStrip(v => { try { sessionStorage.setItem(ORBIT_KEY, v ? '0' : '1'); } catch { /* storage unavailable */ } return !v; });
  const [hover, setHover] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<{ uids: number[]; key: number } | null>(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  // Referentially stable callbacks for memoised children: forwards to the latest props (optional entries stay
  // undefined when the scene does not provide them, e.g. no settings in multiplayer).
  const cbKeys = Object.keys(cb).filter((k) => cb[k as keyof HudCallbacks]).sort().join();
  const stableCb = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const k of cbKeys.split(',')) if (k) out[k] = (...a: unknown[]) => (cbRef.current[k as keyof HudCallbacks] as ((...x: unknown[]) => void) | undefined)?.(...a);
    return out as unknown as HudCallbacks;
  }, [cbKeys]);
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
    { id: 'flightData', title: `Flight data (${bindingLabel('flightData')})`, icon: 'flightData', width: 290, shrink: 8, limits: { minW: 240 }, content: <FlightDataPanel data={t.flightData} onClose={() => apps.close('flightData')} /> },
    { id: 'science', title: t.scienceReady ? `Science · ${t.scienceReady} new here` : 'Science', icon: 'science', badge: t.scienceReady ? 'on' : null, shrink: 3, content: dock?.science ?? null },
    { id: 'crew', title: t.eva ? 'EVA' : `Crew (${t.crew.length})`, icon: 'crew', badge: t.noControl ? 'warn' : null, content: <CrewPanel t={t} cb={cb} /> },
    { id: 'alarms', title: 'Mission alarms', icon: 'alarm', badge: dock?.alarmActive ? 'warn' : null, content: dock?.alarms ?? null },
    { id: 'assist', title: 'Flight assist', icon: 'assist', badge: dock?.assistActive ? 'on' : null, content: dock?.assist ?? null },
    { id: 'target', title: 'Target & docking', icon: 'target', badge: t.target ? 'target' : null, width: 260, shrink: 3, content: <TargetPanel t={t} cb={cb} /> },
    { id: 'station', title: 'Station & modules', icon: 'docking', badge: t.dockedPorts.length ? 'on' : null, width: 300, shrink: 2, content: t.eva ? null : dock?.station ?? null },
    { id: 'comms', title: 'Communications', icon: 'comms', content: dock?.signal ?? null },
  ];
  const actions: ToolbarAction[] = [
    { id: 'engineering', title: 'Engineering strip: stage Δv, TWR, burn countdown and ballistic impact', icon: 'engineering', on: engineeringStrip, onClick: toggleEngineering },
    { id: 'orbit', title: t.mapMode ? 'Orbit summary (always shown in map view)' : 'Orbit summary strip', icon: 'orbit', on: orbitStrip || t.mapMode, onClick: toggleOrbit },
    ...(cb.onSettings ? [{ id: 'settings', title: 'Settings', icon: 'settings' as const, onClick: cb.onSettings }] : []),
    ...(cb.onHelp ? [{ id: 'help', title: `Controls help (${bindingLabel('help')})`, icon: 'help' as const, onClick: cb.onHelp }] : []),
  ];
  const openApps = apps.state.open.map(id => hudApps.find(a => a.id === id)).filter((a): a is HudApp => !!a && a.content !== null);
  const escTarget = useAppEscape(openApps.map(a => a.id), apps.close);
  const docked = openApps.filter(a => !apps.state.pos[a.id]);
  const floating = openApps.filter(a => apps.state.pos[a.id]);
  const showOrbit = (orbitStrip || t.mapMode) && !t.eva;
  const highlight = picked?.uids ?? hover;
  const canStage = !t.eva && !t.noControl && t.stage >= 0;
  const dockingShown = t.dockingMode && !t.mapMode && !t.eva;
  const portMarks = useDockingMarks(dockingShown ? t.docking : null);

  return (
    <div className="overlay hud" style={{ width: `${100 / settings.hudScale}%`, height: `${100 / settings.hudScale}%`, transform: `scale(${settings.hudScale})`, transformOrigin: 'top left', '--hud-scale': settings.hudScale } as CSSProperties}>
      {/* Top-left: time warp and clocks; in map view the maneuver planner; docking indicator; staging at the bottom. */}
      <div ref={leftRef} className={`hud-left${t.mapMode ? ' map' : ''}`} style={t.mapMode && sizes.planner?.w ? { width: sizes.planner.w } : undefined}>
        <TimeControl t={t} cb={cb} />
        {dock?.onboarding}
        {dock?.recovery}
        {engineeringStrip && !t.eva && t.engineering && <EngineeringStrip data={t.engineering} speed={speed} />}
        {!dock?.onboarding && !t.mapMode && t.feel.alerts.length === 0 && t.messages.length === 0 && <FlightHint hint={t.feel.hint} onDismiss={cb.onDismissHint} />}
        {gamepadConnected && <div className="hud-pad mono">GAMEPAD</div>}
        {t.mapMode && dock?.maneuver && <div className="mp-host">
          {dock.maneuver}
          <ResizeGrip edge="r" target={() => leftRef.current} limits={PLANNER_LIMITS} size={sizes.planner} onResize={s => setSize('planner', s)} label="Resize maneuver planner" focusable />
        </div>}
        <div className="hud-left-fill" />
        {/* In map view this block also keeps the planner above the navball cluster's SAS column. */}
        <div className="hud-left-bottom">
          {!t.eva && t.stages.length > 0 && (
            <StagingStack stages={t.stages} dvAt={t.dvAt} totalDvVac={t.totalDvVac} stage={t.stage} locked={t.stageLocked} imperial={imperial} canStage={canStage}
              dockingMode={t.dockingMode} stageProgress={stageProgress} cb={stagingCb} />
          )}
        </div>
      </div>

      {/* Top-centre: altimeter with status lamps, orbit strip, cautions and messages. */}
      <div className="hud-top">
        <Altimeter t={t} cb={cb} imperial={imperial} />
        {showOrbit && <OrbitStrip t={t} distance={distance} />}
        <div className="hud-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Flight notifications">
          <AlertStack alerts={t.feel.alerts} />
          {t.messages.map((m) => (
            <Panel key={m.id} className={`hud-msg ${m.level}`}>{m.text}</Panel>
          ))}
        </div>
      </div>

      {/* Top-right: application toolbar, its docked windows; bottom-right: crew portraits, map and camera. */}
      <div className={`hud-right${t.mapMode ? ' map' : ''}`}>
        <AppToolbar apps={hudApps} open={apps.state.open} onToggle={apps.toggle} actions={actions} />
        <div className="app-stack">
          {docked.map(a => <AppWindow key={a.id} app={a} scale={settings.hudScale} escTarget={a.id === escTarget} onClose={() => apps.close(a.id)} onMove={(x, y) => apps.move(a.id, x, y)} onDock={() => apps.dock(a.id)} size={sizes[a.id]} onResize={size => setSize(a.id, size)} />)}
        </div>
        <CrewCards crew={t.crew} eva={t.eva} mapMode={t.mapMode} noControl={t.noControl} cameraMode={t.feel.cameraMode} cb={stableCb} />
      </div>
      {floating.map(a => <AppWindow key={a.id} app={a} pos={apps.state.pos[a.id]} scale={settings.hudScale} escTarget={a.id === escTarget} onClose={() => apps.close(a.id)} onMove={(x, y) => apps.move(a.id, x, y)} onDock={() => apps.dock(a.id)} size={sizes[a.id]} onResize={size => setSize(a.id, size)} />)}

      {/* Lower-left instruments leave the vessel and its plume in the clear. */}
      {/* Docking mode: the alignment readout sits beside the navball, where the eyes already are. */}
      <div className={`hud-bottom${dockingShown ? ' with-docking' : ''}`}>
        <NavballCluster t={t} cb={vessel || t.eva ? cb : { ...cb, onSasMode: () => {}, onToggleSas: () => {}, onToggleRcs: () => {} }} navball={navball} precision={precision} speed={speed} />
        {dockingShown && <DockingIndicator d={t.docking} hasTarget={t.target?.kind === 'vessel'} />}
      </div>

      <Countdown value={t.feel.countdown} />
      {highlight && partScreen && !t.mapMode && <PartHighlight uids={highlight} at={partScreen} scale={settings.hudScale} strong={!!picked} />}
      {partScreenInto && !t.mapMode && <PortHighlight marks={portMarks} at={partScreenInto} scale={settings.hudScale} />}
    </div>
  );
}

/** Compact orbit readout: always on in map view, optional (toolbar) in flight. */
function OrbitStrip({ t, distance }: { t: Telemetry; distance: (m: number) => string }) {
  const dash = t.onSurface;
  const cell = (label: string, value: string, color?: string) => (
    <div className="orbit-cell" title={{ Ap: 'Apoapsis: highest point of orbit', Pe: 'Periapsis: lowest point of orbit', 'T-Ap': 'Time to apoapsis', 'T-Pe': 'Time to periapsis', Inc: 'Inclination to the equator' }[label]}><span className="label">{label}</span><span className="mono" style={{ color }}>{dash ? '—' : value}</span></div>
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

/** Uses the existing 10 Hz telemetry snapshot; no timers or frame hooks. */
function EngineeringStrip({ data, speed }: { data: NonNullable<Telemetry['engineering']>; speed: (v: number) => string }) {
  return <div className="engineering-strip panel" aria-label="Engineering readouts">
    <div title="Current burning stage, or next engine stage, at current pressure"><span>Stage Δv</span><b>{speed(data.stageDeltaV)}</b></div>
    <div title="Full-throttle thrust / local weight"><span>Max TWR</span><b>{data.twr.toFixed(2)}</b></div>
    <div title="Vertical full-throttle burn estimate; assumes upright thrust, constant gravity and no drag"><span>Burn in</span><b>{data.burnCountdown === null ? '—' : data.burnCountdown <= 0 ? 'NOW' : formatDuration(data.burnCountdown)}</b></div>
    <div title="Unpowered impact prediction along the orbit; no atmospheric drag"><span>Ballistic TTI</span><b>{data.impactTime === null ? '—' : formatDuration(data.impactTime)}</b></div>
  </div>;
}

const NO_MARKS: readonly PortMark[] = [];
/** The docking pair as highlight marks, referentially stable while the pair is unchanged (telemetry is 10–20 Hz). */
function useDockingMarks(d: DockingTelemetry | null): readonly PortMark[] {
  const own = d?.myPortUid ?? -1, target = d?.targetPortUid ?? -1, id = d?.targetId ?? '';
  return useMemo(() => (own < 0 ? NO_MARKS : [
    { uid: own, tone: 'own', label: 'Your port' },
    { uid: target, vesselId: id, tone: 'target', label: 'Target port' },
  ]), [own, target, id]);
}
