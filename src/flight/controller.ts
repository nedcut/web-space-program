import { HUD_BLOCKS } from './hud/hudBlocks';
import { SpeedModeTracker } from './speedMode';
import { dockingModeAfterEvent } from './dockingMode';
import { explosionDiameter, separationPunch, impactPunch, structuralStressPunch } from '../render/fx/eventDesign';
import { updateSiteShadow } from '../render/site/shadows';
import { maxDrawingEdge } from '../render/core/drawingLimits';
import { ShadowMapCache } from '../render/core/shadowCache';
import { onContextRestored } from '../render/core/contextRecovery';
import { stageExplanation } from './cues';
import { actionAvailable, partActions } from '../sim/vessel/actions';
import { CondensationFx } from '../render/fx/CondensationFx';
import { SurfaceDust } from '../render/planet/surfaceDust';
import { flightRumble } from '../audio/design';
import { FlightFx, isBurstEvent } from '../render/fx/FlightFx';

import { PhotoCamera } from '../render/core/PhotoCamera';
import * as THREE from 'three';
import { SkyEnvironment, surfaceBounce } from '../render/core/skyEnv';
import { releasePartTexturePixels, restorePartTexturePixels, setPartDetail } from '../render/parts';
import type { GameAudio } from '../audio';
import { PART_CATALOG } from '../data/parts';
import type { Autopilot } from '../game/autopilot';
import { flightPredictions, targetOrbitState } from '../game/flightData';
import type { SaveScene } from '../game/saveSlots';
import { deserializeWorld, loadWorldFromStorage, saveWorldToStorage, serializeWorld, type SavedWorld } from '../game/persistence';
import { applyCommsSettings, cameraShakeScale, game } from '../game/store';
import { Universe } from '../game/universe';
import { PHYSICS_DT, World, type WorldVessel } from '../game/world';
import { MultiplayerClient, type MultiplayerConfig } from '../net/client';
import { RenderPipeline, getQuality, type QualityId } from '../render/core';
import { compileInSlices } from '../render/core/compileInSlices';
import { offscreenWarmup } from '../render/core/offscreenWarmup';
import type { ExtraOrbit } from '../render/map/MapView';
import { MapView } from '../render/map/MapView';
import { FlightMap } from './map/FlightMap';
import { LaunchSite, launchSiteDistance, type PadVessel } from '../render/site/LaunchSite';
import { Starfield } from '../render/sky/Starfield';
import { SunGlare } from '../render/sky/SunGlare';
import { FlagView } from '../render/vessel/FlagView';
import { ReentryFx } from '../render/vessel/ReentryFx';
import { VesselView } from '../render/vessel/VesselView';
import { sampleAtmosphere } from '../sim/atmosphere';
import type { ScalePresetId } from '../sim/bodies/scale';
import type { Orbit } from '../sim/orbit/api';
import type { GameMode } from '../sim/science/progression';
import { canControlFrom, freeSeats, gearState, groupBindings, lightOn, neutralInput, type PortInfo } from '../sim/vessel';
import type { ActionGroupId, PartActionId } from '../sim/vessel/types';
import type { FlightTweaks, SasMode, VesselCommand, VesselState } from '../sim/vessel/runtime';
import { pickPartAlongRay, partWorldPosition } from './partPick';
import { stagnationHeatFlux } from '../sim/vessel/heating';
import { fairingShellMass } from '../sim/vessel/fairing';
import type { CraftDef } from '../sim/vessel/types';
import { getTutorial } from '../tutorial/runtime';
import { formatDistance, formatDuration, formatSpeed } from '../ui/format';
import { frameProfiler as prof } from '../util/frameProfiler';
import { shareUnchanged, snapshotEqual } from '../util/snapshotEqual';
import { bindingLabel } from '../input/bindings';
import { HatchMarker, HATCH_MARKER_RANGE } from './hatchMarker';
import { BOARD_RANGE, BOARD_SPEED } from '../game/world/crew';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../util/vec3';
import { qRotate } from '../util/quat';
import { type AssistId } from './assist';
import { CAMERA_MODE_INFO, cameraModeInfo, FlightCamera, PivotSmoother, TouchdownKick } from './camera';
import { hudLensShift, LiftoffDetector, speedFovBoost, towerAvailable, towerPlacement, towerRevertDistance } from './cameraFraming';
import { warpRate } from '../game/timewarp';
import * as assist from './controller/assist';
import * as audio from './controller/audio';
import type { FlightControllerInternals } from './controller/internals';
import * as navball from './controller/navball';
import * as scenarios from './controller/scenarios';
import * as telemetry from './controller/telemetry';
import { WarpDriver, type WarpTargetId } from './controller/warp';
import { HintTracker } from './hints';
import type { DockingTelemetry, Telemetry } from './hud/Hud';
import type { NavballFrame, NavballMarker } from './hud/navball';
import { FlightInput } from './input';
import { actionAllowedWhileSuspended } from './modals';
import { saveErrorText } from '../game/storageErrors';
import { createPlanetLayer, type PlanetLayer } from './planets';
import { requestBiomeMap } from '../game/biomeMaps';
import { biomeObjectives } from '../game/biomeObjectives';


const graphicsKeyOf = (s: { quality: string; shadows: boolean; bloom: boolean; renderScale: number }) =>
  `${s.quality}:${s.shadows}:${s.bloom}:${s.renderScale}:${JSON.stringify(game.get().settings.advancedGraphics)}`;

/**
 * Owns the flight scene: world simulation, rendering (flight + map), input, camera.
 * React only hosts the canvas and HUD; this class runs the frame loop.
 */
/** Bottom-HUD and top-HUD extents (CSS px at HUD scale 1) used to frame the vessel in the clear band between them. */
const HUD_TOP_PX = 64;
const HUD_BOTTOM_EXTRA_PX = 70;

export class FlightController {
  private stressOverlay = false;
  private readonly systems: FlightControllerInternals = ((owner: FlightController) => ({
    get assistWarped() { return owner.assistWarped; },
    set assistWarped(value: boolean) { owner.assistWarped = value; },
    get audio() { return owner.audio; },
    set audio(value: GameAudio | null) { owner.audio = value; },
    get craft() { return owner.craft; },
    set craft(value: CraftDef | null) { owner.craft = value; },
    dockingPair: () => owner.dockingPair(),
    dockingTelemetry: () => owner.dockingTelemetry(),
    groundTelemetry: (wv: WorldVessel) => owner.groundTelemetry(wv),
    maneuverDirection: () => owner.maneuverDirection(),
    get predictions() { return owner.predictions; },
    set predictions(value: ReturnType<typeof flightPredictions>) { owner.predictions = value; },
    get reentryHeat() { return owner.reentryHeat; },
    set reentryHeat(value: number) { owner.reentryHeat = value; },
    targetOptions: (wv: WorldVessel) => owner.targetOptions(wv),
    targetTelemetry: (wv: WorldVessel) => owner.targetTelemetry(wv),
  }))(this);

  readonly world: World;
  readonly network: MultiplayerClient | null;
  private lastOwnedVessel: string | null = null;
  private playerLabels = new Map<string, HTMLDivElement>();
  readonly input: FlightInput;
  readonly pipeline: RenderPipeline;
  readonly scene = flightScene();
  /** Skips the sun's depth pass while every caster and the light are unchanged (pad, attitude hold, pause). */
  private readonly shadowCache = new ShadowMapCache();
  private unwatchContext: (() => void) | null = null;
  readonly cam = new FlightCamera();
  readonly map: MapView;
  /** Map focus, menus and maneuver-node commands. */
  readonly mapUi: FlightMap;
  mapMode = false;
  /** Last refresh of the map's objective biomes (contracts change rarely; checked once a second). */
  private objectivesAt = -Infinity;
  paused = false;
  /** A modal (the Controls reference) covers the flight: flight input is suspended but the sim keeps running. */
  modalOpen = false;
  /** Applies at once rather than on the next rendered frame, so no key slips through while a slow frame is pending. */
  setModalOpen(open: boolean) {
    this.modalOpen = open;
    this.input.enabled = !this.paused && !open;
  }
  readonly photo: PhotoCamera;
  private photoWasPaused = false;
  assist: Autopilot | null = null;
  private assistWarped = false;
  sas: SasMode = 'off';
  /** Warp-to targets and the rails warp ramp. */
  readonly warpDriver = new WarpDriver();
  /** Contextual coaching hints (remembered in the world save). */
  readonly hints: HintTracker;
  /** Stage events on the active vessel (the HUD flashes when this changes). */
  stagedCount = 0;
  sasOn = false;
  rcsOn = false;
  /** Astronaut jetpack switch (the RCS key on EVA). Each new EVA starts with it on in flight/space, off on the ground. */
  jetpackOn = false;
  private jetpackFor: string | null = null;
  readonly speedReference = new SpeedModeTracker();
  get speedMode(): Telemetry['speedMode'] { return this.speedReference.mode; }
  set speedMode(mode: Telemetry['speedMode']) { this.speedReference.select(mode); }
  /** Docking mode: HUD shows the port alignment indicator for the targeted docking port. */
  dockingMode = false;
  /** Docking port of the active vessel chosen for the approach (null = the one closest to the target port). */
  ownPortUid: number | null = null;
  /** Stage lock (Alt+L): staging requests are refused so a stray Space cannot fire the next stage. */
  stageLocked = false;
  /** SAS was toggled by a momentary hold (F); releasing the key toggles it back. */
  private sasHeld = false;
  private craft: CraftDef | null;
  /** Map conics of non-active vessels, refreshed at most once per second while in physics. */
  private mapOrbits = new Map<string, { orbit?: Orbit; at: number }>();
  private stagePending = false;
  /** Jump request from the astronaut's jump key, latched until the next control input is built. */
  private evaJumpPending = false;
  /** Gear command from G (applied once, then left to the vessel state). */
  private gearPending: boolean | undefined = undefined;
  /** Latest G press (true = down) until the vessel's state reflects it; the world applies it on its next physics step. */
  private gearWanted: { vesselId: string; down: boolean } | undefined = undefined;
  /** One-shot part actions / action groups / flight settings for the next input sent to the authority. */
  private pendingCommands: VesselCommand[] = [];
  private brakesWere = false;
  /** Right-click / long-press part picks (the HUD opens an inspector panel). */
  private partPickListeners = new Set<(uid: number) => void>();
  private readonly raycaster = new THREE.Raycaster();
  private views = new Map<string, VesselView>();
  private stars: Starfield;
  private glare: SunGlare;
  private skyEnv!: SkyEnvironment;
  private readonly envUp = new THREE.Vector3();
  private readonly envBounce: [number, number, number] = [0, 0, 0];
  private sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  private ambient = new THREE.HemisphereLight(0x8899bb, 0x221a10, 0.12);
  private planets: PlanetLayer;
  private site: LaunchSite | null = null;
  private flags = new FlagView();
  private effects: FlightFx;
  private readonly condensation = new CondensationFx();
  private readonly surfaceDust = new SurfaceDust();
  private readonly sunDirScratch = new THREE.Vector3();
  /** Reused argument for the launch site's pad equipment (no per-frame object). */
  private readonly padVessel: PadVessel = { state: null as unknown as VesselState, held: false, firing: false };
  private readonly effectPosition = new THREE.Vector3();
  private lastShroudJettison = '';
  private reentry = new ReentryFx();
  private reentryHeat = 0;
  private labelHost: HTMLDivElement;
  /** On EVA: marks the nearest free hatch so it can be found on a long hull or from a drift. */
  private hatchMarker: HatchMarker;
  /** Smoothed frames per second (for the optional FPS readout). */
  fps = 60;
  private raf = 0;
  private last = performance.now();
  private disposers: (() => void)[] = [];
  private telemetryListeners = new Set<(t: Telemetry) => void>();
  private telemetryTimer = 0;
  private lastTelemetry?: Telemetry;
  private lastHudInput = '';
  private predictions: ReturnType<typeof flightPredictions> = { impact: null, crossings: [] };
  private elapsed = 0;
  onExit: (() => void) | null = null;
  private framesRendered = 0;
  /** Next time to drop CPU pixels of part textures this renderer has uploaded (newly seen parts upload later). */
  private nextPixelRelease = 0;
  /**
   * Shader warm-up: the first frame updates the scene without drawing, then every material in the
   * flight and map scenes (including hidden plumes, FX and the map) is compiled with
   * `compileAsync` (parallel, non-blocking where KHR_parallel_shader_compile exists) behind the
   * loading screen, so the first stage/map/explosion does not stall on a shader compile.
   */
  private warmup: 'pending' | 'compiling' | 'done' = 'pending';
  private warmupTimer = 0;
  private startedAt = performance.now();

  /**
   * True once the scene has rendered a few frames and the focused planet's terrain has finished its initial
   * build (or after a timeout on slow machines). Drives the flight loading overlay.
   */
  get sceneReady(): boolean {
    if (this.warmup !== 'done' || this.framesRendered < 3) return false;
    if (performance.now() - this.startedAt > 20000) return true;
    const body = this.world.active?.body;
    return !body || (this.planets.isSurfaceReady?.(body) ?? true);
  }

  constructor(
    private host: HTMLElement,
    craft: CraftDef | null,
    preset: ScalePresetId,
    ut: number,
    quality: QualityId,
    private audio: GameAudio | null,
    saved?: SavedWorld | null,
    mode: GameMode = 'sandbox',
    multiplayer?: MultiplayerConfig | null,
  ) {
    performance.mark('wsp:flight:construct:start');
    this.craft = craft;
    this.network = multiplayer ? new MultiplayerClient(multiplayer) : null;
    if (this.network) {
      this.world = this.network.world;
    } else if (saved) {
      this.world = deserializeWorld(saved, PART_CATALOG);
    } else {
      this.world = new World(new Universe(preset), PART_CATALOG, ut, mode);
    }
    if (craft && !this.network) this.world.launch(craft);
    const universe = this.world.universe;
    this.hints = new HintTracker(new Set(this.world.seenTips as import('./hints').HintId[]), seen => { this.world.seenTips = [...seen]; });
    this.input = new FlightInput();

    this.pipeline = new RenderPipeline({ quality: getQuality(quality), toneMapping: 'aces', exposure: 1 });
    const canvas = this.pipeline.renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.appendChild(canvas);
    this.photo = new PhotoCamera(this.pipeline, this.scene, this.cam.camera, () => new THREE.Vector3(), active => {
      if (active) { if (this.network || !this.world.active) return false; this.photoWasPaused = this.paused; this.paused = true; this.mapMode = false; this.map.setVisible(false); this.pipeline.setMapMode(false); this.cam.clearLensShift(); }
      else this.paused = this.photoWasPaused;
      return true;
    });

    const q = getQuality(quality);
    setPartDetail(q.partDetail);
    this.stars = new Starfield({ count: q.stars.count, milkyWay: q.stars.milkyWay, seed: 7 });
    this.scene.add(this.stars.group);
    this.glare = new SunGlare();
    this.scene.add(this.glare.mesh);
    this.scene.add(this.sunLight, this.sunLight.target, this.ambient);
    this.effects = new FlightFx(getQuality(quality).particleQuality);
    this.scene.add(this.condensation.object, this.surfaceDust.mesh);
    this.scene.add(this.effects.root, this.reentry.object, this.flags.root);
    this.sunLight.castShadow = true;
    const shadowSize = Math.min(q.shadowMapSize || 512, maxDrawingEdge(this.pipeline.renderer));
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    // The pipeline was just built from these settings; do not rebuild it on the first frame.
    if (game.get().settings.quality === quality) this.graphicsKey = graphicsKeyOf(game.get().settings);
    this.sunLight.shadow.bias = -0.00002;
    this.sunLight.shadow.normalBias = 0.02;
    // Soft PCF (Vogel disk); three r186 PCFShadowMap honours the radius.
    this.sunLight.shadow.radius = 2.5;

    // Image-based fill light so sunlit-from-behind vessels aren't pitch black. Scaled by air density each frame.
    // Procedural sky/planetshine environment, re-baked as altitude, attitude and sun change.
    this.skyEnv = new SkyEnvironment(this.pipeline.renderer);
    // A restored context has an empty shadow depth map: the cache would otherwise keep skipping the redraw.
    this.unwatchContext = onContextRestored(this.pipeline.renderer, () => this.shadowCache.invalidate());
    this.scene.environmentIntensity = 1;

    this.planets = createPlanetLayer(this.scene, universe, quality, this.pipeline.renderer);

    const labelHost = (this.labelHost = document.createElement('div'));
    Object.assign(labelHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    labelHost.classList.add('photo-hide');
    host.appendChild(labelHost);
    this.hatchMarker = new HatchMarker(labelHost);
    this.map = new MapView(universe.bodies, universe.ephem, labelHost, q, universe);
    this.map.setVisible(false);
    this.map.setBiomeSource(requestBiomeMap);
    this.mapUi = new FlightMap(this);
    // The navball cluster owns the bottom centre in flight; the map overlay shows the focus path instead.
    this.map.showBreadcrumb = false;
    this.map.setHudBlocks(HUD_BLOCKS);
    this.disposers.push(() => this.mapUi.dispose());

    this.disposers.push(this.cam.attach(canvas, () => !this.mapMode && !this.paused));
    this.disposers.push(this.map.attachControls(canvas, () => this.mapUi.minDistance(), () => this.mapMode && !this.paused));
    this.disposers.push(this.attachPartPicking(canvas));
    this.disposers.push(
      this.input.onAction((a) => {
        if (this.photo.active) return;
        // While paused (pause menu, vessel lost) or under a modal only the menu toggle and quickload are live;
        // a momentary SAS toggle still restores itself when its key is released.
        if ((this.paused || this.modalOpen) && !actionAllowedWhileSuspended(a)) return;
        switch (a) {
          case 'stage': this.requestStage(); break;
          case 'eva': this.goEva(); break;
          case 'board': this.boardEva(); break;
          case 'evaJump': this.evaJump(); break;
          case 'plantFlag': this.plantFlag(); break;
          case 'toggleSas': this.toggleSas(); break;
          case 'toggleRcs': this.toggleRcs(); break;
          case 'toggleLights': this.toggleLights(); break;
          case 'abort': this.abort(); break;
          case 'stressOverlay': this.stressOverlay = !this.stressOverlay; this.world.message(this.stressOverlay ? 'Stress overlay: green = low, yellow = near limit, red = overloaded' : 'Stress overlay off'); break;
          case 'toggleGear': this.toggleGear(); break;
          case 'map': this.toggleMap(); break;
          case 'warpUp': this.changeWarp(1); break;
          case 'warpDown': this.changeWarp(-1); break;
          case 'warpStop': this.warpDriver.cancel(this.world); if (this.network) this.network.send({ v: 1, type: 'warp', rate: 1 }); else this.world.warp = { mode: 'rails', index: 0 }; break;
          case 'menu': this.onExit?.(); break;
          case 'focusNext': case 'focusPrev': this.switchVessel(a === 'focusNext' ? 1 : -1); break;
          case 'stageLock': this.toggleStageLock(); break;
          case 'sasHold': if (this.world.canControl()) { this.toggleSas(); this.sasHeld = true; } break;
          case 'sasHoldRelease': if (this.sasHeld) { this.sasHeld = false; this.toggleSas(); } break;
          case 'quicksave': this.quicksave(); break;
          case 'actionGroup1': case 'actionGroup2': case 'actionGroup3': case 'actionGroup4': case 'actionGroup5':
          case 'actionGroup6': case 'actionGroup7': case 'actionGroup8': case 'actionGroup9': case 'actionGroup10':
            this.fireGroup(`custom${a.slice(11)}` as ActionGroupId, undefined, true); break;
          case 'quickload': if (!this.network) this.onQuickload?.(); break;
          case 'toggleCamMode': this.cycleCameraMode(); break;
          case 'trimReset': this.world.message('Trim cleared', 'info', 1.5); break;
        }
      }),
    );
    this.world.onEvent = (e) => {
      if (e.type === 'stage' && e.vesselId === this.world.activeId) this.stagedCount++;
      const shake = cameraShakeScale(game.get().settings);
      if (e.vesselId === this.world.activeId && shake > 0) {
        if (e.type === 'structuralWarning') this.cam.addKick(structuralStressPunch(e.loadFraction) * shake);
        else if (e.type === 'stage') this.cam.addKick(0.35 * shake);
        else if (e.type === 'decouple' || e.type === 'structuralFailure') {
          const part = this.views.get(e.vesselId)?.eventPart(e.partUid);
          const separator = part?.def.modules.find(m => m.type === 'decoupler');
          this.cam.addKick(separationPunch(separator?.type === 'decoupler' ? separator.ejectionImpulse * (part?.tweaks?.ejectionScale ?? 1) : 2000) * shake);
        } else if (e.type === 'partDestroyed') {
          const part = this.views.get(e.vesselId)?.eventPart(e.partUid);
          const source = this.world.vessels.get(e.vesselId);
          this.cam.addKick(impactPunch(part?.mass ?? 1000, source ? length(this.world.surfaceVelocity(source)) : 100) * shake);
        }
      }
      if (isBurstEvent(e)) {
        const vessel = this.world.vessels.get(e.vesselId) ?? this.world.active;
        if (vessel) {
          if (!this.views.get(e.vesselId)?.partPosition(e.partUid, this.effectPosition)) this.effectPosition.copy(vessel.state.position);
          const view = this.views.get(e.vesselId);
          const part = view?.eventPart(e.partUid);
          const shape = part?.def.shape;
          const diameter = shape?.kind === 'box' ? Math.max(shape.size.x,shape.size.z) : shape ? Math.max(shape.radiusTop,shape.radiusBottom)*2 : 2.5;
          const propellant = part ? Math.max(0,part.mass-part.def.dryMass) : 0;
          const size = explosionDiameter(part?.mass ?? 1000,propellant,diameter);
          this.effects.burst(this.effectPosition, e.type !== 'partDestroyed', vessel.state.velocity,size);
          const geometry = e.type === 'partDestroyed' ? view?.debrisGeometry(e.partUid) : undefined;
          if (geometry) this.effects.debris.emit(geometry,this.effectPosition,vessel.state.velocity,size);

        }
      }
      if (e.type === 'decouple') {
        // The decoupler under an engine throws its interstage skirt clear in panels (render-only, like fairing shells).
        // A decoupler splitting off several pieces reports each; its skirt leaves once.
        const vessel = this.world.vessels.get(e.vesselId), key = `${e.vesselId}:${e.partUid}`;
        if (vessel && key !== this.lastShroudJettison) {
          this.lastShroudJettison = key;
          this.views.get(e.vesselId)?.shroudPanels(e.partUid, (panel, position, quaternion) =>
            this.effects.fairingPanels.emit(panel, position, quaternion, vessel.state.velocity, 2.5));
        }
      }
      if (e.type === 'fairingJettison') {
        const vessel = this.world.vessels.get(e.vesselId);
        const part = this.views.get(e.vesselId)?.eventPart(e.partUid);
        const fairing = part?.def.modules.find(m => m.type === 'fairing');
        if (vessel && part && fairing?.type === 'fairing') {
          const shellMass = fairingShellMass(part.def, part.tweaks);
          this.views.get(e.vesselId)!.fairingPanels(e.partUid, (panel, position, quaternion) => {
            // Separation speed of each panel from the module's ejection impulse.
            const panelMass = shellMass * (panel.userData.fairingPanel.span as number) / (2 * Math.PI);
            const kick = Math.min(6, Math.max(1, fairing.ejectionImpulse / Math.max(1, panelMass)));
            this.effects.fairingPanels.emit(panel, position, quaternion, vessel.state.velocity, kick);
          });
        }
      }
      if(e.type==='chute' && e.phase==='semi') {
        const vessel=this.world.vessels.get(e.vesselId);
        if(vessel) {
          if(!this.views.get(e.vesselId)?.partPosition(e.partUid,this.effectPosition)) this.effectPosition.copy(vessel.state.position);
          this.effects.deployment(this.effectPosition,vessel.state.velocity);
        }
      }
      if (!this.audio) return;
      if (e.type === 'structuralWarning' && e.vesselId === this.world.activeId) this.audio.structuralCreak(e.loadFraction);
      const source = this.world.vessels.get(e.vesselId);
      const active = this.world.active;
      const eventDistance = source && active ? Math.hypot(
        source.state.position.x - active.state.position.x - this.cam.camera.position.x,
        source.state.position.y - active.state.position.y - this.cam.camera.position.y,
        source.state.position.z - active.state.position.z - this.cam.camera.position.z) : this.cam.distance;
      if (e.type === 'flameout' && e.vesselId === this.world.activeId) this.audio.flameout();
      if (e.type === 'stage' && e.vesselId === this.world.activeId) this.audio.staging();
      if (e.type === 'decouple' && e.vesselId === this.world.activeId) this.audio.decouple(this.world.vessels.get(e.newVesselId)?.state.parts.some(p => p.def.modules.some(m => m.type === 'engine' && m.plume === 'solid')) ? 'solid' : 'decoupler');
      if (e.type === 'structuralFailure') this.audio.explosion(0.3, eventDistance, active?.state.telemetry.staticPressure ?? 0, e.vesselId === this.world.activeId);
      if (e.type === 'partDestroyed') this.audio.explosion(Math.max(1,(this.views.get(e.vesselId)?.eventPart(e.partUid)?.mass ?? 1000)/500), eventDistance, active?.state.telemetry.staticPressure ?? 0, e.vesselId === this.world.activeId);
      if (e.vesselId === this.world.activeId && e.type === 'chute' && (e.phase === 'semi' || e.phase === 'full')) this.audio.chuteDeploy();
      if (e.type === 'docked' && (e.vesselId === this.world.activeId || e.otherId === this.world.activeId)) this.audio.docking();
      this.dockingMode = dockingModeAfterEvent(this.dockingMode, e, this.world.activeId);
      if (e.type === 'undocked' && e.vesselId === this.world.activeId) this.audio.decouple();
    };

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
    performance.measure('wsp:flight:construct', 'wsp:flight:construct:start');
  }

  /** Set (or clear) the navigation target, optionally a specific docking port on a target vessel. */
  setTarget(id: string | null, portUid: number | null = null) {
    if (id === null) {
      if (this.world.targetId) this.world.message('Target cleared');
      this.world.setTarget(null);
      if (this.speedMode === 'target') this.speedReference.select('auto');
      return;
    }
    if (this.world.setTarget(id, portUid)) {
      const port = portUid !== null ? this.world.vessels.get(id)?.state.cache.byUid.get(portUid) : undefined;
      this.world.message(`Target: ${this.world.targetName()}${port ? ` · ${port.def.name}` : ''}`);
    }
  }

  /** Explicit override cycle: Auto -> Surface -> Orbit -> Target (if set) -> Auto. */
  cycleSpeedMode() {
    this.speedReference.cycle(!!this.world.targetId);
  }

  toggleDockingMode() {
    this.dockingMode = !this.dockingMode;
    if (this.dockingMode && this.world.targetKind() === 'vessel') this.speedMode = 'target';
  }

  /** Choose the active vessel's docking port for the approach (null = automatic: the closest free port). */
  setOwnPort(uid: number | null) {
    const p = uid === null ? undefined : this.world.active?.state.cache.byUid.get(uid);
    this.ownPortUid = p ? uid : null;
    if (p) this.world.message(`Docking from ${p.def.name}`, 'info', 2);
  }

  /** "Control from here": re-point the controls, SAS and navball along a command part or out of a docking port. */
  controlFrom(uid: number) {
    const p = this.world.active?.state.cache.byUid.get(uid);
    if (!p || !canControlFrom(p)) return this.world.message('Cannot control from that part', 'warn');
    this.command({ kind: 'control', uid });
    this.world.message(`Controlling from ${p.def.name}`, 'info', 2.5);
  }

  /** Move an astronaut to a free seat in part `uid` of the active vessel (any docked module). */
  transferCrew(astronautId: string, uid: number) {
    const v = this.world.active?.state;
    const to = v?.cache.byUid.get(uid);
    if (!v || !to || freeSeats(to) <= 0) return this.world.message('No free seat there', 'warn');
    this.command({ kind: 'crew', uid, astronautId });
    const name = this.world.crew.find(c => c.id === astronautId)?.name ?? 'Crew';
    this.world.message(`${name} moved to ${to.def.name}`, 'info', 2.5);
  }

  /** Fly a specific vessel within physics range (the station overview / target list), instead of cycling with [ ]. */
  switchToVessel(id: string) {
    if (this.network?.ownId) return;
    if (this.world.switchTo(id)) { this.ownPortUid = null; this.world.message(`Switched to ${this.world.active!.state.name}`); }
  }

  /** Undock the active vessel at a port (default: first docked joint). */
  undock(portUid?: number) {
    if (this.network) return this.network.action('undock', { uid: portUid });
    if (!this.world.undockActive(portUid)) this.world.message('Nothing to undock', 'warn');
  }

  onQuickload: (() => void) | null = null;
  /** Called once when the active vessel no longer exists (destroyed). */
  onActiveLost: (() => void) | null = null;
  private lossFocus: WorldVessel | null = null;
  private lossFocusUt = 0;
  private activeLost = false;

  /** `scene`: where Load resumes (default: this flight; leaving flight passes the scene being left for). */
  quicksave(slot = 'quicksave', scene: SaveScene = 'flight') {
    if (this.network || getTutorial() || game.get().scenarioActive) return;
    try {
      // Periodic autosaves snapshot now and write on idle tasks; a quicksave the player asked for writes immediately.
      const autosave = slot === 'autosave';
      saveWorldToStorage(slot, this.world, undefined, autosave ? { defer: true, scene, onError: e => this.world.message(saveErrorText(e), 'bad') } : { scene });
      if (slot === 'quicksave') this.world.message(`Quicksaved (${bindingLabel('quickload')} to load)`);
    } catch (e) {
      this.world.message(saveErrorText(e), 'bad');
    }
  }

  snapshot(): SavedWorld {
    return serializeWorld(this.world);
  }

  static loadSlot(slot: string) {
    return loadWorldFromStorage(slot)?.data ?? null;
  }

  /** Dev/test scenarios (URL ?scenario=): reposition the active vessel. */
  devScenario(name: string) { return scenarios.devScenario.call(this, this.systems, name); }

  startAssist(id: AssistId) { return assist.startAssist.call(this, this.systems, id); }

  cancelAssist(msg = 'Assist cancelled') { return assist.cancelAssist.call(this, this.systems, msg); }

  toggleSas() {
    if (!this.world.canControl()) return this.world.message('SAS command unavailable — check control source and probe signal', 'warn');
    this.sasOn = !this.sasOn;
    if (this.sasOn && this.sas === 'off') this.sas = 'stabilityAssist';
    if (this.hasBindings('sas')) this.fireGroup('sas', this.sasOn);
  }

  toggleRcs() {
    if (!this.world.canControl()) return;
    if (this.world.active?.state.eva) {
      this.jetpackOn = !this.jetpackOn;
      this.world.message(this.jetpackOn ? `Jetpack on — ${bindingLabel('evaUp')} / ${bindingLabel('evaDown')} up / down` : 'Jetpack off', 'info', 2);
      return;
    }
    this.rcsOn = !this.rcsOn;
    if (this.hasBindings('rcs')) this.fireGroup('rcs', this.rcsOn);
  }

  // ---------- Part actions, action groups and flight settings (authoritative command path) ----------

  /** Queue commands for the active vessel; the World (or multiplayer room) applies them on its next physics step. */
  command(...commands: VesselCommand[]) {
    if (!this.world.canControl() || !this.world.active || this.world.active.state.eva) return;
    this.pendingCommands.push(...commands);
  }
  partAction(uid: number, action: PartActionId, experiment?: string) {
    const part = this.world.active?.state.cache.byUid.get(uid);
    if (!this.world.canControl()) return this.world.message('Part action unavailable — no control source or probe signal', 'warn');
    if (!part || !partActions(part.def).includes(action) || !actionAvailable(part, action)) return this.world.message('Part action unavailable — already activated, expended or unsupported', 'warn');
    this.command({ kind: 'part', uid, action, ...(experiment ? { experiment } : {}) });
  }
  setTweaks(uid: number, tweaks: FlightTweaks, symmetric = true) { this.command({ kind: 'tweak', uid, tweaks, symmetric }); }
  private hasBindings(group: ActionGroupId) {
    const v = this.world.active?.state;
    return !!v && groupBindings(v, group).length > 0;
  }
  /** Fire an action group; `announce` shows a message (number keys). */
  fireGroup(group: ActionGroupId, state?: boolean, announce = false) {
    if (!this.world.canControl() || !this.world.active || this.world.active.state.eva) return;
    if (announce) {
      const n = groupBindings(this.world.active.state, group).length;
      this.world.message(n ? `Action group ${group.slice(6)}` : `Action group ${group.slice(6)} is empty — assign actions in the editor`, n ? 'info' : 'warn', 2);
    }
    this.command({ kind: 'group', group, ...(state === undefined ? {} : { state }) });
  }
  toggleLights() {
    const v = this.world.active?.state;
    if (!v) return;
    const lamps = v.parts.filter(p => p.def.modules.some(m => m.type === 'light'));
    if (!lamps.length && !this.hasBindings('lights')) return;
    const on = !lamps.some(lightOn);
    this.fireGroup('lights', on);
    if (lamps.length) this.world.message(on ? 'Lights on' : 'Lights off', 'info', 2);
  }
  /** Abort: cut the throttle, stop assist programs and fire the Abort group. */
  abort() {
    if (!this.world.canControl() || !this.world.active || this.world.active.state.eva) return;
    this.input.state.throttle = 0;
    if (this.assist) this.cancelAssist('Assist cancelled by abort');
    this.fireGroup('abort');
    this.world.message(this.hasBindings('abort') ? 'ABORT' : 'Abort: throttle cut (no Abort actions assigned)', 'bad', 3);
  }
  onPartPick(fn: (uid: number) => void) { this.partPickListeners.add(fn); return () => { this.partPickListeners.delete(fn); }; }

  private renderOrigin(): Vec3 | null {
    const wv = this.world.active;
    return wv ? this.network?.pose(wv.state.id)?.position ?? wv.state.position : null;
  }
  /** Active-vessel part under a viewport point (CSS px relative to the canvas). */
  pickPart(x: number, y: number): number | null {
    const wv = this.world.active, origin = this.renderOrigin();
    if (!wv || !origin || this.mapMode) return null;
    const el = this.pipeline.renderer.domElement;
    this.raycaster.setFromCamera(new THREE.Vector2((x / el.clientWidth) * 2 - 1, -(y / el.clientHeight) * 2 + 1), this.cam.camera);
    const pose = this.network?.pose(wv.state.id);
    const s = wv.state;
    const r = this.raycaster.ray;
    const hit = pickPartAlongRay(s.parts, s.com, sub(pose?.position ?? s.position, origin), pose?.orientation ?? s.orientation,
      { x: r.origin.x, y: r.origin.y, z: r.origin.z }, { x: r.direction.x, y: r.direction.y, z: r.direction.z });
    return hit?.uid ?? null;
  }
  /** Screen position (CSS px within the canvas) of an active-vessel part, or null when hidden/behind the camera. */
  partScreenPosition(uid: number, vesselId?: string): { x: number; y: number } | null {
    const wv = vesselId ? this.world.vessels.get(vesselId) : this.world.active, origin = this.renderOrigin();
    const p = wv?.state.cache.byUid.get(uid);
    if (!wv || !p || !origin || this.mapMode) return null;
    const pose = this.network?.pose(wv.state.id);
    const w = partWorldPosition(p, wv.state.com, sub(pose?.position ?? wv.state.position, origin), pose?.orientation ?? wv.state.orientation);
    const v = new THREE.Vector3(w.x, w.y, w.z).project(this.cam.camera);
    if (v.z > 1 || v.z < -1) return null;
    const el = this.pipeline.renderer.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
  }
  private readonly screenV = new THREE.Vector3();
  private readonly screenQ = new THREE.Quaternion();
  /**
   * Allocation-free screen position (CSS px) of a part of any vessel (default: the active one), for per-frame
   * overlays such as the docking-port highlight. Returns false when hidden, behind the camera or in map view.
   */
  partScreenInto(uid: number, vesselId: string | undefined, out: { x: number; y: number }): boolean {
    const wv = vesselId ? this.world.vessels.get(vesselId) : this.world.active, act = this.world.active;
    const p = wv?.state.cache.byUid.get(uid);
    if (!wv || !act || !p || this.mapMode) return false;
    const s = wv.state, pose = this.network?.pose(s.id), q = pose?.orientation ?? s.orientation, pos = pose?.position ?? s.position;
    const origin = this.network?.pose(act.state.id)?.position ?? act.state.position;
    const v = this.screenV.set(p.position.x - s.com.x, p.position.y - s.com.y, p.position.z - s.com.z).applyQuaternion(this.screenQ.set(q.x, q.y, q.z, q.w));
    v.x += pos.x - origin.x; v.y += pos.y - origin.y; v.z += pos.z - origin.z;
    v.project(this.cam.camera);
    if (v.z > 1 || v.z < -1) return false;
    const el = this.pipeline.renderer.domElement;
    out.x = ((v.x + 1) / 2) * el.clientWidth; out.y = ((1 - v.y) / 2) * el.clientHeight;
    return true;
  }
  /** Right-click (without dragging the camera) or a touch long-press picks a part. */
  private attachPartPicking(el: HTMLElement) {
    let start: { x: number; y: number; button: number; touch: boolean } | null = null;
    let timer = 0;
    const emit = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const uid = this.pickPart(cx - r.left, cy - r.top);
      if (uid !== null) this.partPickListeners.forEach(fn => fn(uid));
    };
    const down = (e: PointerEvent) => {
      if (this.paused || this.photo.active) return;
      start = { x: e.clientX, y: e.clientY, button: e.button, touch: e.pointerType === 'touch' };
      window.clearTimeout(timer);
      if (start.touch) timer = window.setTimeout(() => { if (start) { emit(start.x, start.y); start = null; } }, 550);
    };
    const move = (e: PointerEvent) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) { start = null; window.clearTimeout(timer); } };
    const up = (e: PointerEvent) => {
      window.clearTimeout(timer);
      if (start && !start.touch && start.button === 2 && e.button === 2) emit(e.clientX, e.clientY);
      start = null;
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('contextmenu', menu);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('contextmenu', menu);
    };
  }

  setSasMode(mode: string) {
    if (!this.world.canControl()) return;
    this.sasOn = true;
    this.sas = mode as SasMode;
  }

  toggleMap() {
    this.mapMode = !this.mapMode;
    this.map.setVisible(this.mapMode);
    this.pipeline.setMapMode(this.mapMode);
    this.mapUi.reset();
    this.flashFade();
    if (this.mapMode) {
      const wv = this.world.active;
      if (wv) {
        const r = this.world.universe.body(wv.body).radius;
        this.mapUi.frameOrbit();
        // Pull back from just above the vessel's body so the switch reads as zooming out, not a cut.
        if (!game.get().settings.reduceMotion) this.map.animateFrom(r * 1.6);
      }
    }
  }

  private fadeEl: HTMLDivElement | null = null;
  /** Brief dip to black that fades out over ~0.35 s (instant under Reduce motion: transitions are off). */
  private flashFade() {
    if (game.get().settings.reduceMotion) return;
    let el = this.fadeEl;
    if (!el) {
      el = this.fadeEl = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', inset: '0', background: '#02060d', pointerEvents: 'none', opacity: '0' });
      el.classList.add('photo-hide');
      this.host.appendChild(el);
    }
    const node = el;
    node.style.transition = 'none';
    node.style.opacity = '0.85';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      node.style.transition = 'opacity 0.35s ease-out';
      node.style.opacity = '0';
    }));
  }

  goEva(astronautId?: string) {
    if (this.paused) return;
    if (this.network) return this.network.action('eva', { astronautId });
    if (this.world.active?.state.eva) return this.world.message('Already on EVA — approach the hatch to board', 'info');
    const host = this.world.active;
    const grounded = !!host && (host.mode === 'prelaunch' || host.state.situation === 'landed' || host.state.situation === 'splashed');
    const eva = this.world.goEva(astronautId);
    if (eva) {
      this.jetpackFor = eva.state.id;
      this.jetpackOn = !grounded;
      this.cancelAssist();
      this.stagePending = false;
      this.input.state.throttle = 0;
      this.sasOn = false;
      this.cam.mode = 'auto';
    }
  }

  boardEva() {
    if (this.paused) return;
    if (this.network) return this.network.action('board');
    if (this.world.boardEva()) {
      this.cancelAssist();
      this.stagePending = false;
      this.input.state.throttle = 0;
    }
  }

  /** Space on EVA: hop (only takes effect with feet on the ground). Never stages anything. */
  evaJump() {
    if (this.paused || !this.world.active?.state.eva) return;
    this.evaJumpPending = true;
  }

  plantFlag() {
    if (this.paused) return;
    if (this.network) this.network.action('flag');
    else this.world.plantFlag();
  }

  changeWarp(delta: number) {
    if (this.warpDriver.target) this.warpDriver.cancel(this.world, 'Warp-to cancelled');
    if (this.network) this.network.changeWarp(delta);
    else this.world.changeWarp(delta);
  }

  cycleCameraMode() {
    const wv = this.world.active;
    const u = this.world.universe;
    const tower = !!wv && towerAvailable(u.body(wv.body).solidSurface, u.surfaceInfo(wv.body, wv.state.position, this.world.ut).heightAboveTerrain, wv.state.cache.boundingRadius);
    const mode = this.cam.cycleMode(!!wv?.state.eva, tower);
    const info = cameraModeInfo(mode, !!wv?.state.eva);
    this.world.message(`Camera: ${info.label} — ${info.hint}`, 'info', 2.5);
  }

  /** Warp to the next maneuver node / apoapsis / periapsis / SOI change. */
  warpTo(id: WarpTargetId) {
    if (this.network || this.paused) return;
    if (this.assist) return this.world.message('Assist is controlling time warp', 'warn');
    const err = this.warpDriver.start(this.world, id);
    if (err) this.world.message(err, 'warn');
    else this.world.message(`Warping to ${this.warpDriver.target!.label}`, 'info', 2);
  }

  stage() {
    this.requestStage();
  }

  /** Seconds left on the launch countdown (null when none is running). */
  countdown: number | null = null;

  /** Alt+L / HUD lock button: refuse staging until unlocked. */
  toggleStageLock() {
    this.stageLocked = !this.stageLocked;
    this.world.message(this.stageLocked ? `Staging locked (${bindingLabel('stageLock')} to unlock)` : 'Staging unlocked', this.stageLocked ? 'warn' : 'info', 2.5);
  }

  /** [ / ]: switch to the previous / next vessel within physics range. */
  switchVessel(direction: 1 | -1) {
    if (this.network?.ownId) return;
    if (this.world.focusNextNearby(direction)) { this.ownPortUid = null; this.world.message(`Switched to ${this.world.active!.state.name}`); }
  }

  /** Open a part's inspector (as a right-click on it would): used by the staging stack icons. */
  selectPart(uid: number) {
    if (this.world.active?.state.cache.byUid.has(uid)) this.partPickListeners.forEach(fn => fn(uid));
  }

  /** Stage now, or start the optional launch countdown when the first stage would release the clamps. */
  private requestStage() {
    const wv = this.world.active;
    if (!wv) return this.world.message('No active vessel to stage', 'warn');
    if (this.stageLocked) {
      this.world.message(`Staging locked (${bindingLabel('stageLock')} to unlock)`, 'warn', 3);
      return;
    }
    const explanation = stageExplanation(wv.state, false, this.world.canControl());
    if (explanation) this.world.message(explanation, 'warn');
    if (!this.world.canControl() || wv.state.eva || wv.state.nextStage < 0) return;
    if (this.countdown !== null) {
      // Stage again during the count: go now.
      this.countdown = null;
      this.stagePending = true;
      return;
    }
    if (game.get().settings.launchCountdown && wv?.mode === 'prelaunch' && !wv.state.eva && !this.network && !getTutorial() && this.world.canControl()) {
      this.countdown = 3;
      this.audio?.uiClick();
      this.world.message('Launch countdown — Space again to go now', 'info', 3);
      return;
    }
    this.stagePending = true;
  }

  private tickCountdown(dt: number) {
    if (this.countdown === null || this.paused) return;
    const wv = this.world.active;
    if (!wv || wv.mode !== 'prelaunch' || !this.world.canControl()) { this.countdown = null; return; }
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    if (this.countdown <= 0) {
      this.countdown = null;
      this.stagePending = true;
    } else if (Math.ceil(this.countdown) !== before) this.audio?.uiClick();
  }

  /**
   * G: raise / lower landing gear and legs. The direction comes from the previous press while the vessel has not yet
   * caught up with it (rapid or paused presses must alternate), else from the vessel: all gear down -> raise, otherwise lower.
   */
  toggleGear() {
    if (!this.world.canControl()) return;
    const wv = this.world.active;
    if (!wv) return;
    const hardware = gearState(wv.state);
    const bound = this.hasBindings('gear');
    if (hardware === undefined && !bound) return;
    const actual = hardware ?? wv.state.groupState?.gear ?? false;
    const wanted = this.gearWanted?.vesselId === wv.state.id && this.gearWanted.down !== actual ? this.gearWanted.down : undefined;
    const down = !(wanted ?? actual);
    this.gearWanted = { vesselId: wv.state.id, down };
    if (hardware !== undefined) this.gearPending = down;
    if (bound) this.fireGroup('gear', down);
    this.world.message(down ? 'Gear down' : 'Gear up');
  }

  subscribe(fn: (t: Telemetry) => void) {
    this.telemetryListeners.add(fn);
    return () => this.telemetryListeners.delete(fn);
  }

  /** Host size (CSS px) from the resize observer: the map reads it every frame without forcing a layout. */
  private readonly viewport = { width: 1, height: 1 };

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.viewport.width = w; this.viewport.height = h;
    this.pipeline.setSize(w, h);
    this.cam.setAspect(w / h);
  }

  private autosaveTimer = 0;
  private graphicsKey = '';
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const cap = game.get().settings.frameRateCap;
    if (cap && now - this.last < 1000 / cap - .5) return;
    prof.beginFrame(now);
    let t0 = prof.now();
    const frameMs = now - this.last;
    const dt = Math.min(0.1, frameMs / 1000);
    this.last = now;
    if (!this.photo.active) this.elapsed += dt;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    if (this.network && this.lastOwnedVessel !== this.network.ownId) {
      this.lastOwnedVessel = this.network.ownId;
      this.input.state.throttle = 0;
      this.stagePending = false;
      this.sasOn = false;
    }
    const settings = game.get().settings;
    this.input.enabled = !this.paused && !this.modalOpen;
    this.cam.baseFov = settings.cameraFov;
    const graphicsKey = graphicsKeyOf(settings);
    if (graphicsKey !== this.graphicsKey) {
      this.graphicsKey = graphicsKey;
      const quality = getQuality(settings.quality);
      this.pipeline.setQuality(quality);
      this.effects.setQuality(quality.particleQuality);
      const size = Math.min(quality.shadowMapSize || 512, maxDrawingEdge(this.pipeline.renderer));
      if (this.sunLight.shadow.mapSize.x !== size) {
        this.sunLight.shadow.mapSize.set(size, size);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.pipeline.updateAdaptive(frameMs, settings.adaptiveQuality, settings.frameRateCap);
    if (!this.paused && settings.autoSaveInterval > 0) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= settings.autoSaveInterval) { this.autosaveTimer = 0; this.quicksave('autosave'); }
    } else if (!settings.autoSaveInterval) this.autosaveTimer = 0;
    this.input.evaMode = !!this.world.active?.state.eva;
    const evaState = this.world.active?.state;
    if (evaState?.eva && this.jetpackFor !== evaState.id) {
      this.jetpackFor = evaState.id;
      this.jetpackOn = evaState.situation !== 'landed' && evaState.situation !== 'splashed' && this.world.active?.mode !== 'prelaunch';
    } else if (!evaState?.eva) this.jetpackFor = null;
    this.input.mouseEnabled = !this.mapMode;
    applyCommsSettings(this.world);
    this.input.update(dt);
    this.tickCountdown(dt);
    if (!this.world.canControl()) {
      this.input.state.throttle = 0;
      this.stagePending = false;
      this.gearPending = undefined;
      this.gearWanted = undefined;
      this.pendingCommands = [];
      // A probe's flight computer keeps flying a node burn it was given while in contact.
      if (this.assist && !this.world.uploadedNode(this.assist.nodeId)) this.cancelAssist('Assist stopped: no signal or command authority');
    }
    const s = this.input.state;
    const wv = this.world.active;
    if (s.brakes !== this.brakesWere) {
      this.brakesWere = s.brakes;
      if (!this.paused && this.hasBindings('brakes')) this.fireGroup('brakes', s.brakes);
    }
    const maneuverDir = this.maneuverDirection();
    if (!this.world.targetId) {
      // Target gone (docked, destroyed, cleared): leave target-relative modes.
      if (this.speedMode === 'target') this.speedReference.select('auto');
      if (this.sas === 'target' || this.sas === 'antiTarget') this.sas = 'stabilityAssist';
    }
    // Node executed or deleted: a maneuver hold with nothing to point at would only damp rotation (and read as
    // "SAS does nothing"), so fall back to holding attitude like the target modes above.
    if (this.sas === 'maneuver' && !this.world.nodes.length) this.sas = 'stabilityAssist';
    if (wv) this.speedReference.updateWorld(this.world, wv);
    const targetState = this.world.targetState();
    // Trim offsets the controls only while SAS is off: SAS would otherwise read it as the pilot steering.
    const trim = this.sasOn || wv?.state.eva ? { pitch: 0, yaw: 0, roll: 0 } : this.input.trim;
    const drivingRover = wv?.state.situation === 'landed' && wv.state.parts.some(p => p.def.modules.some(m => m.type === 'wheel' && !!m.motorTorque));
    const ctrl = neutralInput({
      evaHeading: wv?.state.eva ? { x: this.cam.camera.quaternion.x, y: this.cam.camera.quaternion.y, z: this.cam.camera.quaternion.z, w: this.cam.camera.quaternion.w } : undefined,
      evaJump: !!wv?.state.eva && this.evaJumpPending,
      evaRun: this.input.running,
      evaFaceView: !!wv?.state.eva && this.cam.mode === 'locked',
      pitch: drivingRover ? 0 : s.pitch + trim.pitch,
      wheelThrottle: drivingRover ? -s.pitch : 0,
      yaw: s.yaw + trim.yaw,
      roll: s.roll + trim.roll,
      translateX: s.tx,
      translateY: s.ty,
      translateZ: s.tz,
      throttle: s.throttle,
      sas: this.sasOn ? this.sas : 'off',
      rcs: wv?.state.eva ? this.jetpackOn : this.rcsOn,
      stage: !wv?.state.eva && this.stagePending,
      gear: this.gearPending,
      brakes: s.brakes,
      sasReference: this.speedMode === 'surface' ? 'surface' : this.speedMode === 'target' && targetState ? 'target' : 'orbit',
      target: targetState ?? undefined,
      maneuverDirection: maneuverDir ?? undefined,
      commands: this.pendingCommands.length && !wv?.state.eva ? this.pendingCommands : undefined,
    });
    if (!this.paused) {
      this.stagePending = false;
      this.evaJumpPending = false;
      this.gearPending = undefined;
      this.pendingCommands = [];
    }
    const input = assist.driveAssist.call(this, this.systems, wv, ctrl, dt);
    prof.add('input', t0);
    t0 = prof.now();
    if (this.network) this.network.update(dt, this.paused ? neutralInput() : input);
    else if (!this.paused) {
      if (this.assist) this.warpDriver.target = null;
      else this.warpDriver.drive(this.world, dt);
      this.world.tick(this.warpDriver.rampDt(this.world, dt), input);
    }
    prof.add('sim', t0);
    if (!this.network && wv && !this.world.active && !this.activeLost) {
      this.activeLost = true;
      this.mapMode = false;
      // Keep the short debris replay readable even when the impact happened in physics warp.
      this.warpDriver.cancel(this.world);
      this.world.warp = { mode: 'rails', index: 0 };
      const air = this.world.surfaceVelocity(wv);
      this.lossFocus = { ...wv, state: { ...wv.state, parts: [],
        position: { ...wv.state.position }, velocity: {
          x: wv.state.velocity.x-air.x, y: wv.state.velocity.y-air.y, z: wv.state.velocity.z-air.z,
        } } };
      this.lossFocusUt = this.world.ut;
      this.onActiveLost?.();
    }
    if (!this.world.active && this.lossFocus && !this.paused) {
      const st = this.lossFocus.state;
      const span=this.world.ut-this.lossFocusUt; this.lossFocusUt=this.world.ut;
      st.position.x += st.velocity.x*span; st.position.y += st.velocity.y*span; st.position.z += st.velocity.z*span;
      if (this.effects.debris.focus(this.effectPosition,span)) {
        const k=1-Math.exp(-span/.25);
        st.position.x+=(this.effectPosition.x-st.position.x)*k;
        st.position.y+=(this.effectPosition.y-st.position.y)*k;
        st.position.z+=(this.effectPosition.z-st.position.z)*k;
      }
    }
    const renderVessel = this.world.active ?? this.lossFocus;
    if (renderVessel && this.warmup !== 'done') {
      this.render(renderVessel, dt, false);
      if (this.warmup === 'pending') this.startWarmup(renderVessel);
    } else if (renderVessel) {
      const first = this.framesRendered === 0 ? performance.now() : 0;
      this.render(renderVessel, dt);
      if (first) performance.measure('wsp:flight:firstFrame', { start: first });
      this.framesRendered++;
      if (now >= this.nextPixelRelease && this.sceneReady) {
        this.nextPixelRelease = now + 5000;
        releasePartTexturePixels(this.pipeline.renderer);
      }
    }
    t0 = prof.now();
    this.updateAudio(this.world.active);
    prof.add('audio', t0);

    t0 = prof.now();
    this.telemetryTimer += dt;
    if (this.telemetryTimer > 0.1 && wv) {
      this.telemetryTimer = 0;
      this.updateHatchTarget(wv);
      const t = shareUnchanged(this.telemetry(wv), this.lastTelemetry);
      const hudInput = `${this.input.precisionActive}:${this.input.stageProgress}:${this.input.gamepadConnected}`;
      if (hudInput !== this.lastHudInput || !snapshotEqual(t, this.lastTelemetry)) {
        this.lastHudInput = hudInput;
        this.lastTelemetry = t;
        this.telemetryListeners.forEach((l) => l(t));
      }
    }
    prof.add('telemetry', t0);
    prof.endFrame();
  };

  private startWarmup(wv: WorldVessel) {
    this.warmup = 'compiling';
    const start = performance.now();
    const r = this.pipeline.renderer;
    const finish = () => {
      window.clearTimeout(this.warmupTimer);
      if (this.warmup !== 'compiling') return;
      this.warmup = 'done';
      performance.measure('wsp:flight:shaderWarmup', { start });
    };
    try {
      // Map materials render straight to the canvas; flight materials into the HDR target.
      // Frame the map as opening it would (toggleMap resets the distance on every open anyway).
      if (!this.mapMode) this.map.distance = this.world.universe.body(wv.body).radius * 4;
      this.updateMapScene(wv);
      r.setRenderTarget(null);
      this.map.setWarmup(true);
      const map = compileInSlices(r, [this.map.scene], this.map.camera, this.map.scene, {
        renderTarget: null,
        cancelled: () => this.warmup !== 'compiling',
      }).finally(() => this.map.setWarmup(false));
      // The flight scene has ~90 programs: build them a few ms per frame so the loading screen keeps animating.
      const flight = compileInSlices(r, [this.scene], this.cam.camera, this.scene, {
        renderTarget: this.pipeline.composer.readBuffer,
        cancelled: () => this.warmup !== 'compiling',
      });
      // Off-screen bakes/merges would otherwise compile on their first (mid-flight) step. They draw lightless scenes
      // into render targets, and light counts are part of three's program key: compile against an empty scene.
      const offscreen = compileInSlices(r, [offscreenWarmup], this.cam.camera, new THREE.Scene(), {
        renderTarget: this.pipeline.composer.readBuffer,
        cancelled: () => this.warmup !== 'compiling',
      });
      Promise.all([map, flight, offscreen]).then(finish, finish);
      // Never hold the loading screen on a driver that does not report completion.
      this.warmupTimer = window.setTimeout(finish, 15000);
    } catch {
      finish();
    }
  }

  private maneuverDirection(): Vec3 | null { return navball.maneuverDirection.call(this, this.systems); }

  private render(wv: WorldVessel, dt: number, submit = true) {
    // Draw between the last two fixed physics steps so motion advances evenly at any display rate. The map
    // stays on exact state (its caches are keyed by simulation time); multiplayer has its own pose smoothing.
    if (this.mapMode || this.network || !this.world.active) return this.renderAt(wv, dt, this.world.ut, submit);
    const w = this.world;
    const { renderUt, restore } = w.renderHistory.apply(w.ut, PHYSICS_DT, w.renderAlpha, w.vessels.values(), w.universe.ephem);
    try {
      this.renderAt(wv, dt, renderUt, submit);
    } finally {
      restore();
    }
  }

  private renderAt(wv: WorldVessel, dt: number, t: number, submit: boolean) {
    const photoDt = dt;
    if (this.photo.active) dt = 0;
    const u = this.world.universe;
    const origin = this.network?.pose(wv.state.id)?.position ?? wv.state.position;
    const bodyState = u.ephem.getBodyState(wv.body, t);
    const sunPos = u.ephem.getBodyState(u.sunId, t).position;
    const sunDir = normalize(sub(sunPos, origin));
    const air = sampleAtmosphere(u.body(wv.body).atmosphere, length(sub(origin, bodyState.position)) - u.body(wv.body).radius, u.body(wv.body).surfaceGravity);

    for (const label of this.playerLabels.values()) label.style.display = 'none';
    let t0 = prof.now();
    if (this.mapMode) {
      this.hatchMarker.update(this.world.vessels, origin, this.cam.camera, 0, 0, false);
      this.updateMapScene(wv);
      prof.add('map', t0);
      t0 = prof.now();
      if (submit) this.pipeline.renderMap(this.map.scene, this.map.camera);
      prof.add('render', t0);
      return;
    }

    // Create split-vessel views before any donor is updated/disposed, so they can adopt its visuals.
    for (const v of this.world.vessels.values()) if (!this.views.has(v.state.id)) {
      const view = new VesselView(v.state, this.views.values());
      this.views.set(v.state.id, view);
      this.scene.add(view.root);
    }
    const seen = new Set<string>();
    for (const v of this.world.vessels.values()) {
      seen.add(v.state.id);
      const view = this.views.get(v.state.id)!;
      view.setVessel(v.state);
      const debris = v !== wv && !v.state.parts.some(p => p.def.modules.some(m => m.type === 'command'));
      const distant = debris && length(sub(v.state.position, origin)) > 2000;
      view.setStressOverlay(this.stressOverlay);
      view.update(origin, this.elapsed, air.pressure, this.paused ? 0 : dt, distant);
      const pose = this.network?.pose(v.state.id);
      if (pose) {
        view.root.position.set(pose.position.x - origin.x, pose.position.y - origin.y, pose.position.z - origin.z);
        view.root.quaternion.set(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);
      }
    }
    for (const [id, view] of this.views) if (!seen.has(id)) { view.dispose(); this.views.delete(id); }

    this.flags.update({ active: this.world.active, flags: this.world.flags, universe: this.world.universe, ut: t });
    prof.add('vessels', t0);
    t0 = prof.now();

    // Re-entry plasma on the active vessel.
    const airVel = this.world.surfaceVelocity(wv);
    const airSpeed = length(airVel);
    const flux = stagnationHeatFlux(air.density, airSpeed, Math.max(0.3, wv.state.cache.boundingRadius * 0.4));
    if (airSpeed > 1) {
      const d = normalize(airVel);
      this.reentry.update(flux, new THREE.Vector3(d.x, d.y, d.z), wv.state.cache.boundingRadius, this.elapsed, wv.state, wv.body);
    } else this.reentry.update(0, new THREE.Vector3(0, 1, 0), 1, this.elapsed);
    // No weather/humidity simulation exists: dense Earth air is a conservative visual proxy.
    this.effectPosition.set(airVel.x,airVel.y,airVel.z).normalize();
    this.condensation.update(airSpeed/Math.max(1,air.speedOfSound),wv.body==='earth'?Math.min(1,air.density/.8):0,Math.min(4,wv.state.cache.boundingRadius*.3),this.effectPosition);
    this.reentryHeat = Math.min(1, Math.max(0, (Math.log10(Math.max(flux, 1)) - 4.0) / 1.5));

    // Camera
    if (this.photo.active) this.photo.update(photoDt);
    else this.updateCamera(wv, origin, bodyState, airVel, t, dt);
    const camera = this.cam.camera;
    this.hatchMarker.update(this.world.vessels, origin, camera, this.viewport.width, this.viewport.height, !this.uiHidden && !this.photo.active);
    const groundAltitude = u.surfaceInfo(wv.body, wv.state.position, t).heightAboveTerrain;
    this.effects.update(wv.state, origin, bodyState.position, bodyState.velocity, wv.body, groundAltitude, air.density, this.reentryHeat, airVel, this.paused ? 0 : dt, this.pipeline.renderer.domElement.height, t, u.body(wv.body).surface.colors, u.body(wv.body).surfaceGravity);
    this.effects.rcs(wv.state,this.rcsOn,this.input.state);
    this.surfaceDust.update(wv.state, origin, bodyState.position, groundAltitude, air.density, wv.body === 'earth' ? undefined : u.body(wv.body).surface.colors[1] ?? u.body(wv.body).surface.colors[0], this.sunDirScratch.set(sunDir.x, sunDir.y, sunDir.z), t, this.paused ? 0 : dt);
    prof.add('fx', t0);
    if (this.network) {
      const live = new Set<string>();
      for (const p of this.network.room.players) {
        if (!p.vesselId || p.id === this.network.playerId) continue;
        const pose = this.network.pose(p.vesselId);
        if (!pose) continue;
        live.add(p.id);
        let label = this.playerLabels.get(p.id);
        if (!label) {
          label = document.createElement('div');
          Object.assign(label.style, { position: 'absolute', color: '#9fdfef', fontSize: '12px', textShadow: '0 1px 3px black', transform: 'translate(-50%, -100%)' });
          this.labelHost.appendChild(label);
          this.playerLabels.set(p.id, label);
        }
        const pos = sub(pose.position, origin);
        const projected = new THREE.Vector3(pos.x, pos.y, pos.z).project(camera);
        label.textContent = `${p.name} · ${formatDistance(length(pos))}`;
        label.style.display = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 ? '' : 'none';
        label.style.left = `${(projected.x + 1) * 50}%`;
        label.style.top = `${(1 - projected.y) * 50}%`;
      }
      for (const [id, label] of this.playerLabels) if (!live.has(id)) { label.remove(); this.playerLabels.delete(id); }
    }

    // Sun light: directional, shadow frustum hugging the active vessel.
    const sd = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z);
    // Cover the tower, trench and low-sun ground shadows near the launch complex.
    const nearSite = wv.body === 'earth' && !!this.site && this.site.root.position.length() < 600;
    const r = Math.max(nearSite ? 210 : 10, wv.state.cache.boundingRadius * 2.5);
    this.sunLight.position.copy(sd).multiplyScalar(r * 4);
    this.sunLight.target.position.set(0, 0, 0);
    const sc = this.sunLight.shadow.camera as THREE.OrthographicCamera;
    // Depth range reaches well past the vessel so long low-sun shadows on the ground are not clipped; airless
    // descents need the vessel's shadow on the ground from several km up.
    const far = r * 4 + Math.max(r * 8, wv.body === 'earth' ? 1500 : 6000);
    if (sc.right !== r || sc.far !== far) {
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = far;
      sc.updateProjectionMatrix();
      // Biases scale with the shadow texel size (acne-free without peter-panning at any vessel size).
      const texel = (2 * r) / this.sunLight.shadow.mapSize.x;
      this.sunLight.shadow.normalBias = texel * 1.2;
      this.sunLight.shadow.bias = -0.00002;
    }

    // Ground receivers sample the vessel's shadow map only while the ground is within its depth range (orbit
    // frames skip the per-fragment lookup entirely).
    const shadowReachesGround = groundAltitude < sc.far;
    updateSiteShadow(this.sunLight, this.pipeline.renderer.shadowMap.enabled && shadowReachesGround);
    t0 = prof.now();
    // A lunar flight or distant orbit must not construct and warm hundreds of hidden site meshes.
    // Use the same body-fixed location as LaunchSite; a 50 km margin prepares inbound scenery early.
    if (!this.site && wv.body === 'earth' && launchSiteDistance(u, origin, t) < 250e3) {
      const sq = getQuality(game.get().settings.quality);
      this.site = new LaunchSite(u, { vegetationDensity: sq.siteVegetation, steamParticles: { low: 40, medium: 96, high: 160, ultra: 200 }[sq.particleQuality] });
      this.scene.add(this.site.root);
    }
    if (wv.body === 'earth' && this.site) {
      const pv = this.padVessel;
      pv.state = wv.state; pv.held = wv.mode === 'prelaunch'; pv.firing = wv.mode !== 'prelaunch' || !!wv.holdDown;
      this.site.update(origin, t, camera.position, pv);
    } else this.site?.hide();
    this.planets.update({ t, origin, camera, sunPos, dt, focusBody: wv.body, viewportHeight: this.pipeline.lodViewportHeight, switchViewportHeight: this.pipeline.lodSwitchViewportHeight });
    const eclipse = this.planets.sunVisibility?.(origin, sunPos) ?? 1;
    const tint = this.planets.sunTint?.(origin, sunPos) ?? [1, 1, 1];
    const tmax = Math.max(1e-6, tint[0], tint[1], tint[2]);
    this.sunLight.color.setRGB(tint[0] / tmax, tint[1] / tmax, tint[2] / tmax);
    this.sunLight.intensity = 3.2 * eclipse;
    // Sky fill: brighter in thick air (scattered skylight), dim in space (planetshine + starlight).
    const airFrac = Math.min(1, air.density / 1.0);
    this.effects.lighting(sd, camera, this.sunLight.color, this.sunLight.intensity, airFrac);
    const envBody = u.body(wv.body);
    const envRel = sub(origin, bodyState.position);
    const envDist = Math.max(envBody.radius, length(envRel));
    // Ground bounce from the terrain under the vessel: mid palette albedo on land, the darkest (water) entry over liquid.
    const colors = envBody.surface.colors;
    const terrain = envBody.solidSurface ? u.terrain(wv.body) : null;
    // The surface under the vessel is max(liquid level, terrain): at the liquid level means over liquid.
    const datumAltitude = length(sub(wv.state.position, bodyState.position)) - envBody.radius;
    const liquidLevel = terrain?.liquid?.level ?? 0;
    const overLiquid = !!terrain?.ocean && Math.abs(datumAltitude - groundAltitude - liquidLevel) < 0.01;
    const bounce = envBody.solidSurface ? surfaceBounce({
      albedo: (overLiquid ? colors[0] : colors[1] ?? colors[0]) ?? [0.3, 0.3, 0.3],
      altitude: datumAltitude, radius: envBody.radius, daylight: eclipse,
      sunColor: [this.sunLight.color.r, this.sunLight.color.g, this.sunLight.color.b], airless: !envBody.atmosphere,
    }, this.envBounce) : undefined;
    this.scene.environment = this.skyEnv.update(
      {
        up: this.envUp.set(envRel.x, envRel.y, envRel.z).normalize(),
        sun: sd,
        air: airFrac,
        daylight: eclipse,
        ground: envBody.surface.colors[0] ?? [0.3, 0.3, 0.3],
        skyTint: envBody.atmosphere?.tint,
        bodyAngle: Math.asin(Math.min(1, envBody.radius / envDist)),
        bounce,
      },
      performance.now(),
    );
    this.scene.environmentIntensity = 0.85 + 0.35 * airFrac;
    this.stars.update(camera, this.pipeline.pixelRatio);
    this.glare.update(camera, sd, eclipse);
    prof.add('planets', t0);
    t0 = prof.now();
    // The scene opts out of the renderer's automatic pass (see flightScene): update once, then decide shadows.
    this.scene.updateMatrixWorld();
    if (submit) {
      this.shadowCache.update(this.scene, this.sunLight, this.pipeline.renderer.shadowMap.enabled);
      this.pipeline.render(this.scene, camera);
    }
    prof.add('render', t0);
  }

  /** Map conics/markers for the current frame (also used to build map materials for shader warm-up). */
  private updateMapScene(wv: WorldVessel) {
    const t = this.world.ut;
    const origin = this.network?.pose(wv.state.id)?.position ?? wv.state.position;
    this.updateMapTargets(wv);
    const patches = this.world.mapTrajectory();
    const focus = this.mapUi.focusFrame(wv, origin, patches);
    const relInc = this.predictions.crossings.length ? this.relativeInclination(wv) : NaN;
    const incText = Number.isFinite(relInc) ? `\nRelative inclination ${relInc.toFixed(2)}°` : '';
    const impactOnPath = patches.some(p => p.endReason === 'impact' && p.orbit.body === wv.body && !p.samples);
    this.map.update({
      t,
      focus: focus.position,
      focusId: focus.focusId,
      referenceBody: focus.referenceBody,
      landing: this.mapUi.landing.displayResult ?? undefined,
      comms: this.world.commsSettings.enabled && game.get().settings.commsOverlay ? this.world.comms : undefined,
      vessel: { id: wv.state.id, position: origin, patches, nodes: this.world.nodes },
      markers: [
        ...this.world.mapGravityMarkers(),
        ...this.mapUi.landing.displayMarkers,
        ...(this.world.preciseGravity ? [] : this.predictions.crossings).map(c => ({ key: c.kind, body: wv.body, position: c.position, label: c.kind, color: '#d066ff', time: c.time,
          detail: `${c.kind === 'AN' ? 'Ascending' : 'Descending'} node (target plane)${incText}\nT−${formatDuration(c.time - t)}` })),
        ...(!this.world.preciseGravity && this.predictions.impact && !impactOnPath ? [{ key: 'impact', body: wv.body, position: this.predictions.impact.position, label: 'Impact', color: '#ff6b6b', time: this.predictions.impact.time,
          detail: `Impact (terrain)\nT−${formatDuration(this.predictions.impact.time - t)}\n${formatSpeed(this.predictions.impact.speed)}` }] : []),
      ],
      viewport: this.viewport,
    });
  }

  /** Angle between the active orbit plane and the target's (degrees; NaN without a same-SOI target). */
  private relativeInclination(wv: WorldVessel): number {
    const target = targetOrbitState(this.world, wv);
    if (!target) return NaN;
    const own = this.world.relativeState(wv);
    const a = cross(own.position, own.velocity), b = cross(target.position, target.velocity);
    const la = length(a), lb = length(b);
    return la > 0 && lb > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * 180 / Math.PI : NaN;
  }

  private readonly camUp = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private readonly camVel = new THREE.Vector3();
  private readonly camNormal = new THREE.Vector3();
  private readonly camProbe = { x: 0, y: 0, z: 0 };
  private readonly camPivot = new THREE.Vector3();
  private readonly pivotSmoother = new PivotSmoother();
  private readonly touchdown = new TouchdownKick();

  /** Feed the orbit camera its reference frame, framing size, terrain clearance and rumble for this frame. */
  private updateCamera(wv: WorldVessel, origin: Vec3, bodyState: { position: Vec3; velocity: Vec3 }, airVel: Vec3, t: number, dt: number) {
    const u = this.world.universe;
    const body = u.body(wv.body);
    const st = wv.state;
    const r = sub(origin, bodyState.position);
    const alt = length(r) - body.radius;
    const up = normalize(r);
    const orbVel = sub(st.velocity, bodyState.velocity);
    const n = cross(r, orbVel);
    const nLen = length(n);
    const atmo = body.atmosphere?.height ?? 0;
    const h0 = atmo > 0 ? atmo : Math.max(5000, body.radius * 0.03);
    const flying = st.situation === 'flying' && wv.mode !== 'prelaunch';
    const spaceBlend = flying ? Math.max(0, Math.min(1, (alt - h0) / h0)) : 0;
    const inAir = st.telemetry.dynamicPressure > 200 || alt < h0 * 0.5;
    const vel = inAir ? airVel : orbVel;
    const tel = st.telemetry;
    const agl = Number.isFinite(tel.altitudeAGL) ? tel.altitudeAGL : alt;
    const settings = game.get().settings;
    let rumble = 0;
    const shake = cameraShakeScale(settings);
    // No vibration while paused or under physics warp (a 4× rumble is noise, not feel).
    if (shake > 0 && !this.paused && warpRate(this.world.warp) <= 1) {
      rumble = flightRumble(tel.thrust, st.mass * body.surfaceGravity, agl, tel.dynamicPressure, tel.mach) * shake;
      // Touchdown kick, growing with the vertical speed at contact (a gentle 1.5 m/s landing stays still).
      const touchdown = this.touchdown.update(st.id, st.situation !== 'flying', dot(airVel, up), dt);
      if (touchdown > 0) this.cam.addKick(touchdown * shake);
    }
    const probe = this.camProbe;
    this.cam.drive.yaw = this.input.camera.yaw;
    this.cam.drive.pitch = this.input.camera.pitch;
    this.cam.drive.zoom = this.input.camera.zoom;
    const q = st.orientation;
    // Staging/docking move the COM (the scene origin) inside the vessel: ease the orbit point across instead of jumping.
    const po = this.pivotSmoother.update(st.id, st.com, dt);
    const pw = qRotate(q, po);
    // Liftoff: the auto camera eases back from the pad framing (an automatic camera move, so not with reduced motion).
    const grounded = st.situation !== 'flying' || wv.mode === 'prelaunch';
    if (this.liftoff.update(st.id, grounded, tel.thrust > 0, this.paused ? 0 : dt) && !settings.reduceMotion) this.cam.startLiftoff();
    if (this.cam.mode !== 'tower') this.tower = null;
    const eye = this.cam.mode === 'tower' ? this.towerEye(wv, origin, bodyState.position, t, agl) : null;
    if (this.cam.mode === 'tower' && !eye) {
      this.cam.mode = 'auto';
      this.world.message(`Camera: ${CAMERA_MODE_INFO.auto.label} — ${CAMERA_MODE_INFO.auto.hint}`, 'info', 2.5);
    }
    // Frame the middle of the parts' extent rather than the COM (build frame → scene, no allocation).
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const p of st.parts) {
      const pp = p.position;
      if (pp.x < x0) x0 = pp.x; if (pp.x > x1) x1 = pp.x;
      if (pp.y < y0) y0 = pp.y; if (pp.y > y1) y1 = pp.y;
      if (pp.z < z0) z0 = pp.z; if (pp.z > z1) z1 = pp.z;
    }
    const mid = st.parts.length ? this.camMid.set((x0 + x1) / 2 - st.com.x - po.x, (y0 + y1) / 2 - st.com.y - po.y, (z0 + z1) / 2 - st.com.z - po.z)
      .applyQuaternion(this.camQuat.set(q.x, q.y, q.z, q.w)) : undefined;
    // Lift the vessel out from behind the navball cluster (HUD px scale with the HUD scale setting).
    const hud = settings.hudScale;
    const lensShift = this.uiHidden ? 0 : hudLensShift(this.viewport.height, HUD_TOP_PX * hud, (settings.navballSize + HUD_BOTTOM_EXTRA_PX) * hud);
    this.cam.update({
      pivot: this.camPivot.set(pw.x, pw.y, pw.z),
      up: this.camUp.set(up.x, up.y, up.z),
      vesselQuat: this.camQuat.set(q.x, q.y, q.z, q.w),
      velocity: this.camVel.set(vel.x, vel.y, vel.z),
      orbitNormal: nLen > 1e-6 ? this.camNormal.set(n.x / nLen, n.y / nLen, n.z / nLen) : null,
      spaceBlend,
      vesselId: st.id,
      radius: st.cache.boundingRadius,
      // Terrain sampling only matters when the camera could reach the ground.
      clearance: body.solidSurface && agl < this.cam.distance * 1.5 + 50
        ? (p) => {
            probe.x = origin.x + p.x; probe.y = origin.y + p.y; probe.z = origin.z + p.z;
            return u.surfaceInfo(wv.body, probe, t).heightAboveTerrain;
          }
        : undefined,
      rumble,
      motionEnabled: shake > 0,
      lensShift,
      frameCentre: mid,
      fovBoost: settings.reduceMotion ? 0 : speedFovBoost(tel.dynamicPressure, spaceBlend),
      eye,
      eva: !!st.eva,
    }, dt);
  }

  /** F2 state from the HUD: with the UI hidden the vessel returns to screen centre. */
  uiHidden = false;
  private readonly liftoff = new LiftoffDetector();
  private readonly camEye = new THREE.Vector3();
  private readonly camMid = new THREE.Vector3();
  /** Time spent choosing the last tower eye (ms; telemetry for perf checks). */
  towerPickMs = 0;
  /** Launch-site structure meshes (not instanced vegetation) that can block the tower camera's view. */
  private towerBlockers(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (!this.site?.root.visible) return out;
    this.site.root.updateMatrixWorld();
    this.site.root.traverseVisible(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) return;
      // Skip invisible pick volumes and see-through effects (hover ring, light curtain).
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (mat && mat.visible && !mat.transparent) out.push(o);
    });
    return out;
  }
  /** Tower camera anchor: body-fixed position (m) on the ground near where the mode was chosen. */
  private tower: { id: string; body: string; fixed: Vec3 } | null = null;

  /** Scene-space eye point of the tower camera, or null when it should hand back (far away, other vessel or body). */
  private towerEye(wv: WorldVessel, origin: Vec3, bodyPos: Vec3, t: number, agl: number): THREE.Vector3 | null {
    const u = this.world.universe;
    const st = wv.state, radius = st.cache.boundingRadius;
    let a = this.tower;
    if (!a || a.id !== st.id || a.body !== wv.body) {
      this.tower = null;
      if (!towerAvailable(u.body(wv.body).solidSurface, agl, radius)) return null;
      // Stand off horizontally, starting on the side the camera already looks from and stepping round in 45° bearings
      // until the line of sight to the vessel clears the launch site's structures (a one-off test on mode entry).
      const t0 = performance.now();
      const rel = sub(origin, bodyPos);
      const fixedRel = u.ephem.toBodyFixed(wv.body, rel, t);
      const upF = normalize(fixedRel);
      const c = this.cam.camera.position;
      const look = u.ephem.toBodyFixed(wv.body, { x: c.x, y: c.y, z: c.z }, t);
      let h = sub(look, scale(upF, dot(look, upF)));
      if (length(h) < 1e-6) h = cross(upF, Math.abs(upF.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 });
      h = normalize(h);
      const side = cross(upF, h);
      const place = towerPlacement(radius);
      const rot = u.ephem.bodyRotation(wv.body, t);
      const ground = sub(fixedRel, scale(upF, agl));
      const blockers = this.towerBlockers();
      let first: Vec3 | null = null;
      for (let k = 0; k < 8; k++) {
        const b = (k * Math.PI) / 4;
        const dir = add(scale(h, Math.cos(b)), scale(side, Math.sin(b)));
        const groundDir = normalize(add(ground, scale(dir, place.distance)));
        const info = u.surfaceInfo(wv.body, add(bodyPos, qRotate(rot, scale(groundDir, length(fixedRel)))), t);
        const fixed = scale(groundDir, info.r - info.heightAboveTerrain + place.height);
        first ??= fixed;
        if (!blockers.length) break;
        const e = sub(add(bodyPos, qRotate(rot, fixed)), origin);
        const d = length(e);
        this.raycaster.ray.origin.set(e.x, e.y, e.z);
        this.raycaster.ray.direction.set(-e.x / d, -e.y / d, -e.z / d);
        this.raycaster.near = 0;
        this.raycaster.far = Math.max(0, d - radius * 1.5);
        if (!this.raycaster.intersectObjects(blockers, false).length) { first = fixed; break; }
      }
      this.raycaster.far = Infinity;
      this.towerPickMs = performance.now() - t0;
      a = this.tower = { id: st.id, body: wv.body, fixed: first! };
    }
    const eye = sub(add(bodyPos, qRotate(u.ephem.bodyRotation(wv.body, t), a.fixed)), origin);
    if (length(eye) > towerRevertDistance(radius)) { this.tower = null; return null; }
    return this.camEye.set(eye.x, eye.y, eye.z);
  }

  /** Fleet icons/conics, target highlight and closest-approach markers for the map view. */
  private updateMapTargets(active: WorldVessel) {
    const w = this.world;
    const now = performance.now();
    const extras: ExtraOrbit[] = [];
    for (const v of w.vessels.values()) {
      if (v === active) continue;
      const id = v.state.id;
      let c = this.mapOrbits.get(id);
      const flying = v.state.situation === 'flying' && v.mode !== 'prelaunch' && v.mode !== 'landedRails';
      if (!c || (v.mode === 'rails' ? c.orbit !== v.orbit : now - c.at > 1000)) {
        let orbit: Orbit | undefined;
        try {
          orbit = flying ? w.orbitOf(v) : undefined;
        } catch {
          orbit = undefined;
        }
        c = { orbit, at: now };
        this.mapOrbits.set(id, c);
      }
      extras.push({ id, position: v.state.position, orbit: w.preciseGravity ? undefined : c.orbit });
    }
    for (const id of this.mapOrbits.keys()) if (!w.vessels.has(id)) this.mapOrbits.delete(id);
    this.map.setExtraOrbits(extras);
    if (now - this.objectivesAt > 1000) { this.objectivesAt = now; this.map.setBiomeTargets(biomeObjectives(w.progression)); }
    const kind = w.targetKind();
    this.map.setTarget(kind ? { kind, id: w.targetId! } : null);
    const ca = kind && !w.preciseGravity ? w.closestApproach() : null;
    this.map.setApproach(
      ca
        ? {
            body: ca.body,
            positionA: ca.positionA,
            positionB: ca.positionB,
            label: `Closest ${formatDistance(ca.distance)}`,
            time: ca.time,
            detail: `Closest approach to ${w.targetName()}\nSeparation ${formatDistance(ca.distance)}\nRelative speed ${ca.relativeSpeed.toFixed(1)} m/s\nT−${formatDuration(Math.max(0, ca.time - w.ut))}`,
          }
        : null,
    );
  }

  /** Active and target docking ports for the docking indicator (target port if selected, else the closest pair). */
  private dockingPair(): { mine: PortInfo; theirs: PortInfo } | null { return telemetry.dockingPair.call(this, this.systems); }

  private dockingTelemetry(): DockingTelemetry | null { return telemetry.dockingTelemetry.call(this, this.systems); }

  private targetTelemetry(wv: WorldVessel): Telemetry['target'] { return telemetry.targetTelemetry.call(this, this.systems, wv); }

  private targetOptions(wv: WorldVessel): Telemetry['targetOptions'] { return telemetry.targetOptions.call(this, this.systems, wv); }

  private updateAudio(wv: WorldVessel | null) { return audio.updateAudio.call(this, this.systems, wv); }

  /** Navball frame for the active vessel (called by the HUD every animation frame). */
  navball = (): { frame: NavballFrame; markers: NavballMarker[] } | null => {
    // Same interpolated attitude as the 3D view, so the ball turns smoothly between physics steps.
    const w = this.world;
    const wv = w.active;
    if (!wv || this.network || this.mapMode) return navball.navball.call(this, this.systems);
    const { restore } = w.renderHistory.apply(w.ut, PHYSICS_DT, w.renderAlpha, [wv], w.universe.ephem);
    try {
      return navball.navball.call(this, this.systems);
    } finally {
      restore();
    }
  };

  /** Telemetry rate: the hatch the EVA marker points at (nearest free seat in range), or none. */
  private updateHatchTarget(wv: WorldVessel) {
    const near = wv.state.eva && !this.mapMode ? this.world.nearestHatch() : null;
    // Clear of the altimeter and status lamps (≈ 80 px tall) plus the caption height.
    this.hatchMarker.topInset = (HUD_TOP_PX + 44) * game.get().settings.hudScale;
    this.hatchMarker.setTarget(near?.free && near.distance <= HATCH_MARKER_RANGE
      ? { vesselId: near.vessel.state.id, podUid: near.pod.uid, distance: near.distance, ready: near.distance <= BOARD_RANGE && near.speed < BOARD_SPEED, boardKey: bindingLabel('board') }
      : null);
  }
  private telemetry(wv: WorldVessel): Telemetry { return telemetry.telemetry.call(this, this.systems, wv); }

  /** Gear / brakes / intake-air readouts for the HUD (null fields when the vessel has no such hardware). */
  private groundTelemetry(wv: WorldVessel): Pick<Telemetry, 'gear' | 'brakes' | 'intakeAir'> { return telemetry.groundTelemetry.call(this, this.systems, wv); }

  dispose() {
    this.pipeline.detach(this.scene, this.map.scene);
    window.clearTimeout(this.warmupTimer);
    this.warmup = 'done'; // stops a sliced shader warm-up still in progress
    this.photo.dispose();
    this.network?.close();
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.input.dispose();
    for (const v of this.views.values()) v.dispose();
    this.planets.dispose();
    this.site?.dispose();
    this.map.dispose();
    this.stars.dispose();
    this.glare.dispose();
    this.reentry.dispose();
    this.effects.dispose();
    this.condensation.dispose();
    this.surfaceDust.dispose();
    this.flags.dispose();
    this.unwatchContext?.();
    this.skyEnv.dispose();
    this.scene.environment = null;
    this.hatchMarker.dispose();
    this.labelHost.remove();
    this.fadeEl?.remove();
    this.pipeline.dispose();
    this.pipeline.renderer.domElement.remove();
    // The next scene's renderers need the part texture pixels this one dropped.
    restorePartTexturePixels();
  }
}

/**
 * The flight scene root never moves. Left on automatic updates, its per-frame `updateMatrix()` forces a world-matrix
 * multiply on every descendant, including hundreds of hidden cached terrain chunks. Subtrees that do move still
 * update themselves. The controller updates matrices once per frame before rendering.
 */
function flightScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.matrixAutoUpdate = false;
  scene.matrixWorldAutoUpdate = false;
  return scene;
}
