import { FlightFx, isBurstEvent } from '../render/fx/FlightFx';

import { PhotoCamera } from '../render/core/PhotoCamera';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameAudio } from '../audio';
import { PART_CATALOG } from '../data/parts';
import type { Autopilot } from '../game/autopilot';
import { flightPredictions } from '../game/flightData';
import { deserializeWorld, loadWorldFromStorage, saveWorldToStorage, serializeWorld, type SavedWorld } from '../game/persistence';
import { applyCommsSettings, game } from '../game/store';
import { Universe } from '../game/universe';
import { PHYSICS_DT, World, type WorldVessel } from '../game/world';
import { MultiplayerClient, type MultiplayerConfig } from '../net/client';
import { RenderPipeline, getQuality, type QualityId } from '../render/core';
import type { ExtraOrbit } from '../render/map/MapView';
import { MapView } from '../render/map/MapView';
import { LaunchSite } from '../render/site/LaunchSite';
import { Starfield } from '../render/sky/Starfield';
import { SunGlare } from '../render/sky/SunGlare';
import { FlagView } from '../render/vessel/FlagView';
import { ReentryFx } from '../render/vessel/ReentryFx';
import { VesselView } from '../render/vessel/VesselView';
import { sampleAtmosphere } from '../sim/atmosphere';
import type { ScalePresetId } from '../sim/bodies/scale';
import type { Orbit } from '../sim/orbit/api';
import type { GameMode } from '../sim/science/progression';
import { gearState, neutralInput, type PortInfo } from '../sim/vessel';
import { stagnationHeatFlux } from '../sim/vessel/heating';
import type { SasMode } from '../sim/vessel/runtime';
import type { CraftDef } from '../sim/vessel/types';
import { getTutorial } from '../tutorial/runtime';
import { formatDistance, formatDuration } from '../ui/format';
import { snapshotEqual } from '../util/snapshotEqual';
import { cross, length, normalize, sub, type Vec3 } from '../util/vec3';
import { type AssistId } from './assist';
import { CAMERA_MODE_INFO, FlightCamera } from './camera';
import * as assist from './controller/assist';
import * as audio from './controller/audio';
import type { FlightControllerInternals } from './controller/internals';
import * as navball from './controller/navball';
import * as scenarios from './controller/scenarios';
import * as telemetry from './controller/telemetry';
import type { DockingTelemetry, Telemetry } from './hud/Hud';
import type { NavballFrame, NavballMarker } from './hud/navball';
import { FlightInput } from './input';
import { createPlanetLayer, type PlanetLayer } from './planets';


/**
 * Owns the flight scene: world simulation, rendering (flight + map), input, camera.
 * React only hosts the canvas and HUD; this class runs the frame loop.
 */
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
  readonly scene = new THREE.Scene();
  readonly cam = new FlightCamera();
  readonly map: MapView;
  mapMode = false;
  paused = false;
  readonly photo: PhotoCamera;
  private photoWasPaused = false;
  assist: Autopilot | null = null;
  private assistWarped = false;
  sas: SasMode = 'off';
  sasOn = false;
  rcsOn = false;
  speedMode: Telemetry['speedMode'] = 'surface';
  /** Docking mode: HUD shows the port alignment indicator for the targeted docking port. */
  dockingMode = false;
  private craft: CraftDef | null;
  /** Map conics of non-active vessels, refreshed at most once per second while in physics. */
  private mapOrbits = new Map<string, { orbit?: Orbit; at: number }>();
  private stagePending = false;
  /** Gear command from G (applied once, then left to the vessel state). */
  private gearPending: boolean | undefined = undefined;
  private views = new Map<string, VesselView>();
  private stars: Starfield;
  private glare: SunGlare;
  private sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  private ambient = new THREE.HemisphereLight(0x8899bb, 0x221a10, 0.12);
  private planets: PlanetLayer;
  private site: LaunchSite;
  private flags = new FlagView();
  private effects: FlightFx;
  private readonly effectPosition = new THREE.Vector3();
  private reentry = new ReentryFx();
  private reentryHeat = 0;
  private labelHost: HTMLDivElement;
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
  private startedAt = performance.now();

  /**
   * True once the scene has rendered a few frames and the focused planet's terrain has finished its initial
   * build (or after a timeout on slow machines). Drives the flight loading overlay.
   */
  get sceneReady(): boolean {
    if (this.framesRendered < 3) return false;
    if (performance.now() - this.startedAt > 20000) return true;
    const body = this.world.active?.body;
    return !body || (this.planets.isIdle?.(body) ?? true);
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
    this.input = new FlightInput();

    this.pipeline = new RenderPipeline({ quality: getQuality(quality), toneMapping: 'aces', exposure: 1 });
    const canvas = this.pipeline.renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.appendChild(canvas);
    this.photo = new PhotoCamera(this.pipeline, this.scene, this.cam.camera, () => new THREE.Vector3(), active => {
      if (active) { if (this.network || !this.world.active) return false; this.photoWasPaused = this.paused; this.paused = true; this.mapMode = false; this.map.setVisible(false); }
      else this.paused = this.photoWasPaused;
      return true;
    });

    const q = getQuality(quality);
    this.stars = new Starfield({ count: q.stars.count, milkyWay: q.stars.milkyWay, seed: 7 });
    this.scene.add(this.stars.group);
    this.glare = new SunGlare();
    this.scene.add(this.glare.mesh);
    this.scene.add(this.sunLight, this.sunLight.target, this.ambient);
    this.effects = new FlightFx(quality);
    this.scene.add(this.effects.root, this.reentry.object, this.flags.root);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;

    // Image-based fill light so sunlit-from-behind vessels aren't pitch black. Scaled by air density each frame.
    const pmrem = new THREE.PMREMGenerator(this.pipeline.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.planets = createPlanetLayer(this.scene, universe, quality);
    this.site = new LaunchSite(universe);
    this.scene.add(this.site.root);

    const labelHost = (this.labelHost = document.createElement('div'));
    Object.assign(labelHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    labelHost.classList.add('photo-hide');
    host.appendChild(labelHost);
    this.map = new MapView(universe.bodies, universe.ephem, labelHost, q, universe);
    this.map.setVisible(false);

    this.disposers.push(this.cam.attach(canvas, () => !this.mapMode && !this.paused));
    this.disposers.push(this.map.attachControls(canvas, () => this.mapMinDistance(), () => this.mapMode && !this.paused));
    this.disposers.push(this.attachMapPicking(canvas));
    this.disposers.push(
      this.input.onAction((a) => {
        if (this.photo.active) return;
        // While paused (pause menu, vessel lost) only the menu toggle and quickload are live.
        if (this.paused && a !== 'menu' && a !== 'quickload') return;
        switch (a) {
          case 'stage': this.stagePending = true; break;
          case 'eva': this.goEva(); break;
          case 'board': this.boardEva(); break;
          case 'plantFlag': this.plantFlag(); break;
          case 'toggleSas': this.toggleSas(); break;
          case 'toggleRcs': this.rcsOn = !this.rcsOn; break;
          case 'stressOverlay': this.stressOverlay = !this.stressOverlay; this.world.message(this.stressOverlay ? 'Stress overlay: green = low, yellow = near limit, red = overloaded' : 'Stress overlay off'); break;
          case 'toggleGear': this.toggleGear(); break;
          case 'map': this.toggleMap(); break;
          case 'warpUp': this.changeWarp(1); break;
          case 'warpDown': this.changeWarp(-1); break;
          case 'warpStop': if (this.network) this.network.send({ v: 1, type: 'warp', rate: 1 }); else this.world.warp = { mode: 'rails', index: 0 }; break;
          case 'menu': this.onExit?.(); break;
          case 'focusNext': if (!this.network?.ownId && this.world.focusNextNearby()) this.world.message(`Switched to ${this.world.active!.state.name}`); break;
          case 'quicksave': this.quicksave(); break;
          case 'quickload': if (!this.network) this.onQuickload?.(); break;
          case 'toggleCamMode': this.world.message(`Camera: ${CAMERA_MODE_INFO[this.cam.cycleMode(!!this.world.active?.state.eva)].label} — ${CAMERA_MODE_INFO[this.cam.mode].hint}`, 'info', 2.5); break;
        }
      }),
    );
    this.world.onEvent = (e) => {
      if (e.vesselId === this.world.activeId && !game.get().settings.reduceMotion) {
        if (e.type === 'stage') this.cam.addKick(0.35);
        else if (e.type === 'decouple' || e.type === 'structuralFailure') this.cam.addKick(0.6);
      }
      if (isBurstEvent(e)) {
        const vessel = this.world.vessels.get(e.vesselId) ?? this.world.active;
        if (vessel) {
          if (!this.views.get(e.vesselId)?.partPosition(e.partUid, this.effectPosition)) this.effectPosition.copy(vessel.state.position);
          this.effects.burst(this.effectPosition, e.type !== 'partDestroyed', vessel.state.velocity);
        }
      }
      if (!this.audio) return;
      if (e.type === 'stage') this.audio.staging();
      if (e.type === 'decouple') this.audio.decouple();
      if (e.type === 'structuralFailure') this.audio.explosion(0.3);
      if (e.type === 'partDestroyed') this.audio.explosion(1);
      if (e.type === 'chute' && (e.phase === 'semi' || e.phase === 'full')) this.audio.chuteDeploy();
      if (e.type === 'docked') this.audio.docking();
      if (e.type === 'undocked') this.audio.decouple();
    };

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Click (not drag) on a map icon selects it as the navigation target. */
  private attachMapPicking(el: HTMLElement) {
    let sx = 0;
    let sy = 0;
    let down = false;
    const pd = (e: PointerEvent) => {
      down = true;
      sx = e.clientX;
      sy = e.clientY;
    };
    const pu = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (!this.mapMode || Math.hypot(e.clientX - sx, e.clientY - sy) > 5) return;
      const r = el.getBoundingClientRect();
      if (this.map.pickManeuver(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)) return;
      const hit = this.map.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (hit && hit.id !== this.world.activeId) this.setTarget(hit.id);
    };
    el.addEventListener('pointerdown', pd);
    el.addEventListener('pointerup', pu);
    return () => {
      el.removeEventListener('pointerdown', pd);
      el.removeEventListener('pointerup', pu);
    };
  }

  /** Set (or clear) the navigation target, optionally a specific docking port on a target vessel. */
  setTarget(id: string | null, portUid: number | null = null) {
    if (id === null) {
      if (this.world.targetId) this.world.message('Target cleared');
      this.world.setTarget(null);
      if (this.speedMode === 'target') this.speedMode = 'orbit';
      return;
    }
    if (this.world.setTarget(id, portUid)) {
      const port = portUid !== null ? this.world.vessels.get(id)?.state.cache.byUid.get(portUid) : undefined;
      this.world.message(`Target: ${this.world.targetName()}${port ? ` · ${port.def.name}` : ''}`);
    }
  }

  /** Speed display: surface -> orbit -> target (when a target is set) -> surface. */
  cycleSpeedMode() {
    this.speedMode = this.speedMode === 'surface' ? 'orbit' : this.speedMode === 'orbit' && this.world.targetId ? 'target' : 'surface';
  }

  toggleDockingMode() {
    this.dockingMode = !this.dockingMode;
    if (this.dockingMode && this.world.targetKind() === 'vessel') this.speedMode = 'target';
  }

  /** Undock the active vessel at a port (default: first docked joint). */
  undock(portUid?: number) {
    if (this.network) return this.network.action('undock', { uid: portUid });
    if (!this.world.undockActive(portUid)) this.world.message('Nothing to undock', 'warn');
  }

  private mapMinDistance() {
    const wv = this.world.active;
    return wv ? this.world.universe.body(wv.body).radius * 1.05 : 1e5;
  }

  onQuickload: (() => void) | null = null;
  /** Called once when the active vessel no longer exists (destroyed). */
  onActiveLost: (() => void) | null = null;
  private activeLost = false;

  quicksave(slot = 'quicksave') {
    if (this.network || getTutorial() || game.get().scenarioActive) return;
    try {
      saveWorldToStorage(slot, this.world);
      if (slot === 'quicksave') this.world.message('Quicksaved (F9 to load)');
    } catch (e) {
      this.world.message(`Save failed: ${(e as Error).message}`, 'bad');
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
    if (!this.world.canControl()) return;
    this.sasOn = !this.sasOn;
    if (this.sasOn && this.sas === 'off') this.sas = 'stabilityAssist';
  }

  setSasMode(mode: string) {
    if (!this.world.canControl()) return;
    this.sasOn = true;
    this.sas = mode as SasMode;
  }

  toggleMap() {
    this.mapMode = !this.mapMode;
    this.map.setVisible(this.mapMode);
    if (this.mapMode) {
      const wv = this.world.active;
      if (wv) this.map.distance = this.world.universe.body(wv.body).radius * 4;
    }
  }

  goEva(astronautId?: string) {
    if (this.paused) return;
    if (this.network) return this.network.action('eva', { astronautId });
    if (this.world.goEva(astronautId)) {
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

  plantFlag() {
    if (this.paused) return;
    if (this.network) this.network.action('flag');
    else this.world.plantFlag();
  }

  changeWarp(delta: number) {
    if (this.network) this.network.changeWarp(delta);
    else this.world.changeWarp(delta);
  }

  stage() {
    if (!this.world.canControl()) return;
    this.stagePending = true;
  }

  /** G: raise / lower landing gear and legs. */
  toggleGear() {
    if (!this.world.canControl()) return;
    const wv = this.world.active;
    if (!wv) return;
    const cur = gearState(wv.state);
    if (cur === undefined) return;
    this.gearPending = !cur;
    this.world.message(this.gearPending ? 'Gear down' : 'Gear up');
  }

  subscribe(fn: (t: Telemetry) => void) {
    this.telemetryListeners.add(fn);
    return () => this.telemetryListeners.delete(fn);
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.pipeline.setSize(w, h);
    this.cam.setAspect(w / h);
  }

  private autosaveTimer = 0;
  private graphicsKey = '';
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
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
    this.input.enabled = !this.paused;
    if (!this.photo.active) this.cam.camera.fov = settings.cameraFov;
    const graphicsKey = JSON.stringify([settings.quality, settings.shadows, settings.bloom, settings.renderScale]);
    if (graphicsKey !== this.graphicsKey) {
      this.graphicsKey = graphicsKey;
      const quality = getQuality(settings.quality);
      this.pipeline.setQuality(quality);
      this.effects.setQuality(settings.quality);
      const size = quality.shadowMapSize || 512;
      if (this.sunLight.shadow.mapSize.x !== size) {
        this.sunLight.shadow.mapSize.set(size, size);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.pipeline.updateAdaptive(frameMs, settings.adaptiveQuality);
    if (!this.paused && settings.autoSaveInterval > 0) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= settings.autoSaveInterval) { this.autosaveTimer = 0; this.quicksave('autosave'); }
    } else if (!settings.autoSaveInterval) this.autosaveTimer = 0;
    this.input.evaMode = !!this.world.active?.state.eva;
    this.input.mouseEnabled = !this.mapMode;
    applyCommsSettings(this.world);
    this.input.update(dt);
    if (!this.world.canControl()) {
      this.input.state.throttle = 0;
      this.stagePending = false;
      this.gearPending = undefined;
      if (this.assist) this.cancelAssist('Assist stopped: no signal or command authority');
    }
    const s = this.input.state;
    const wv = this.world.active;
    const maneuverDir = this.maneuverDirection();
    if (!this.world.targetId) {
      // Target gone (docked, destroyed, cleared): leave target-relative modes.
      if (this.speedMode === 'target') this.speedMode = 'orbit';
      if (this.sas === 'target' || this.sas === 'antiTarget') this.sas = 'stabilityAssist';
    }
    const targetState = this.world.targetState();
    const drivingRover = wv?.state.situation === 'landed' && wv.state.parts.some(p => p.def.modules.some(m => m.type === 'wheel' && !!m.motorTorque));
    const ctrl = neutralInput({
      evaHeading: wv?.state.eva ? { x: this.cam.camera.quaternion.x, y: this.cam.camera.quaternion.y, z: this.cam.camera.quaternion.z, w: this.cam.camera.quaternion.w } : undefined,
      evaJump: !!wv?.state.eva && this.stagePending,
      evaRun: this.input.running,
      pitch: drivingRover ? 0 : s.pitch,
      wheelThrottle: drivingRover ? -s.pitch : 0,
      yaw: s.yaw,
      roll: s.roll,
      translateX: s.tx,
      translateY: s.ty,
      translateZ: s.tz,
      throttle: s.throttle,
      sas: this.sasOn ? this.sas : 'off',
      rcs: this.rcsOn,
      stage: !wv?.state.eva && this.stagePending,
      gear: this.gearPending,
      brakes: s.brakes,
      sasReference: this.speedMode === 'surface' ? 'surface' : this.speedMode === 'target' && targetState ? 'target' : 'orbit',
      target: targetState ?? undefined,
      maneuverDirection: maneuverDir ?? undefined,
    });
    if (!this.paused) {
      this.stagePending = false;
      this.gearPending = undefined;
    }
    const input = assist.driveAssist.call(this, this.systems, wv, ctrl, dt);
    if (this.network) this.network.update(dt, this.paused ? neutralInput() : input);
    else if (!this.paused) this.world.tick(dt, input);
    if (!this.network && wv && !this.world.active && !this.activeLost) {
      this.activeLost = true;
      this.onActiveLost?.();
    }
    const renderVessel = this.world.active;
    if (renderVessel) {
      this.render(renderVessel, dt);
      this.framesRendered++;
    }
    this.updateAudio(wv);

    this.telemetryTimer += dt;
    if (this.telemetryTimer > 0.1 && wv) {
      this.telemetryTimer = 0;
      const t = this.telemetry(wv);
      const hudInput = `${this.input.precisionActive}:${this.input.stageProgress}:${this.input.gamepadConnected}`;
      if (hudInput !== this.lastHudInput || !snapshotEqual(t, this.lastTelemetry)) {
        this.lastHudInput = hudInput;
        this.lastTelemetry = t;
        this.telemetryListeners.forEach((l) => l(t));
      }
    }
  };

  private maneuverDirection(): Vec3 | null { return navball.maneuverDirection.call(this, this.systems); }

  private render(wv: WorldVessel, dt: number) {
    // Draw between the last two fixed physics steps so motion advances evenly at any display rate. The map
    // stays on exact state (its caches are keyed by simulation time); multiplayer has its own pose smoothing.
    if (this.mapMode || this.network) return this.renderAt(wv, dt, this.world.ut);
    const w = this.world;
    const { renderUt, restore } = w.renderHistory.apply(w.ut, PHYSICS_DT, w.renderAlpha, w.vessels.values(), w.universe.ephem);
    try {
      this.renderAt(wv, dt, renderUt);
    } finally {
      restore();
    }
  }

  private renderAt(wv: WorldVessel, dt: number, t: number) {
    const photoDt = dt;
    if (this.photo.active) dt = 0;
    const u = this.world.universe;
    const origin = this.network?.pose(wv.state.id)?.position ?? wv.state.position;
    const bodyState = u.ephem.getBodyState(wv.body, t);
    const sunPos = u.ephem.getBodyState(u.sunId, t).position;
    const sunDir = normalize(sub(sunPos, origin));
    const air = sampleAtmosphere(u.body(wv.body).atmosphere, length(sub(origin, bodyState.position)) - u.body(wv.body).radius, u.body(wv.body).surfaceGravity);

    for (const label of this.playerLabels.values()) label.style.display = 'none';
    if (this.mapMode) {
      this.updateMapTargets(wv);
      this.map.update({
        t,
        focus: origin,
        focusId: `vessel:${wv.state.id}`,
        referenceBody: wv.body,
        comms: this.world.commsSettings.enabled && game.get().settings.commsOverlay ? this.world.comms : undefined,
        vessel: { position: origin, patches: this.world.mapTrajectory(), nodes: this.world.nodes },
        markers: [
          ...this.world.mapGravityMarkers(),
          ...(this.world.preciseGravity ? [] : this.predictions.crossings).map(c => ({ body: wv.body, position: c.position, label: `${c.kind} T−${formatDuration(c.time - t)}`, color: '#d066ff' })),
          ...(!this.world.preciseGravity && this.predictions.impact ? [{ body: wv.body, position: this.predictions.impact.position, label: `Impact T−${formatDuration(this.predictions.impact.time - t)}`, color: '#ff6b6b' }] : []),
        ],
        viewport: { width: this.host.clientWidth, height: this.host.clientHeight },
      });
      this.pipeline.renderer.setRenderTarget(null);
      this.pipeline.renderer.render(this.map.scene, this.map.camera);
      return;
    }

    // Vessels
    const seen = new Set<string>();
    for (const v of this.world.vessels.values()) {
      seen.add(v.state.id);
      let view = this.views.get(v.state.id);
      if (!view) {
        view = new VesselView(v.state);
        this.views.set(v.state.id, view);
        this.scene.add(view.root);
      }
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

    // Re-entry plasma on the active vessel.
    const airVel = this.world.surfaceVelocity(wv);
    const airSpeed = length(airVel);
    const flux = stagnationHeatFlux(air.density, airSpeed, Math.max(0.3, wv.state.cache.boundingRadius * 0.4));
    if (airSpeed > 1) {
      const d = normalize(airVel);
      this.reentry.update(flux, new THREE.Vector3(d.x, d.y, d.z), wv.state.cache.boundingRadius, this.elapsed, wv.state, wv.body);
    } else this.reentry.update(0, new THREE.Vector3(0, 1, 0), 1, this.elapsed);
    this.reentryHeat = Math.min(1, Math.max(0, (Math.log10(Math.max(flux, 1)) - 4.0) / 1.5));

    // Camera
    if (this.photo.active) this.photo.update(photoDt);
    else this.updateCamera(wv, origin, bodyState, airVel, t, dt);
    const camera = this.cam.camera;
    this.effects.update(wv.state, origin, bodyState.position, bodyState.velocity, wv.body, u.surfaceInfo(wv.body, wv.state.position, t).heightAboveTerrain, air.density, this.reentryHeat, airVel, this.paused ? 0 : dt, this.pipeline.renderer.domElement.height, t, u.body(wv.body).surface.colors);
    if (!this.paused) this.effects.shake(camera, game.get().settings.reduceMotion);
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
    const r = Math.max(10, wv.state.cache.boundingRadius * 2.5);
    this.sunLight.position.copy(sd).multiplyScalar(r * 4);
    this.sunLight.target.position.set(0, 0, 0);
    const sc = this.sunLight.shadow.camera as THREE.OrthographicCamera;
    if (sc.right !== r) {
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = r * 8;
      sc.updateProjectionMatrix();
    }

    if (wv.body === 'earth') this.site.update(origin, t);
    else this.site.hide();
    this.planets.update({ t, origin, camera, sunPos, dt, focusBody: wv.body, viewportHeight: this.pipeline.renderer.domElement.height });
    const eclipse = this.planets.sunVisibility?.(origin, sunPos) ?? 1;
    const tint = this.planets.sunTint?.(origin, sunPos) ?? [1, 1, 1];
    const tmax = Math.max(1e-6, tint[0], tint[1], tint[2]);
    this.sunLight.color.setRGB(tint[0] / tmax, tint[1] / tmax, tint[2] / tmax);
    this.sunLight.intensity = 3.2 * eclipse;
    // Sky fill: brighter in thick air (scattered skylight), dim in space (planetshine + starlight).
    const airFrac = Math.min(1, air.density / 1.0);
    this.scene.environmentIntensity = 0.12 + 0.5 * airFrac * eclipse;
    this.stars.update(camera);
    this.glare.update(camera, sd, eclipse);
    this.pipeline.render(this.scene, camera);
  }

  private readonly camUp = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private readonly camVel = new THREE.Vector3();
  private readonly camNormal = new THREE.Vector3();
  private readonly camProbe = { x: 0, y: 0, z: 0 };

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
    if (!settings.reduceMotion && !this.paused) {
      const weight = Math.max(1, st.mass * body.surfaceGravity);
      const launch = Math.min(1, tel.thrust / (weight * 1.5)) * Math.exp(-Math.max(0, agl) / 250);
      const transonic = Math.exp(-(((tel.mach - 1) / 0.25) ** 2));
      const buffet = Math.min(1, tel.dynamicPressure / 40000) * (0.35 + 0.65 * transonic);
      rumble = Math.min(0.8, launch * 0.7 + buffet * 0.5);
    }
    const probe = this.camProbe;
    this.cam.drive.yaw = this.input.camera.yaw;
    this.cam.drive.pitch = this.input.camera.pitch;
    this.cam.drive.zoom = this.input.camera.zoom;
    const q = st.orientation;
    this.cam.update({
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
      groundFraming: flying ? 0 : 1,
    }, dt);
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
    const kind = w.targetKind();
    this.map.setTarget(kind ? { kind, id: w.targetId! } : null);
    const ca = kind && !w.preciseGravity ? w.closestApproach() : null;
    this.map.setApproach(
      ca
        ? {
            body: ca.body,
            positionA: ca.positionA,
            positionB: ca.positionB,
            label: `Closest approach ${formatDistance(ca.distance)} · in ${formatDuration(Math.max(0, ca.time - w.ut))} · ${ca.relativeSpeed.toFixed(1)} m/s`,
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
  navball = (): { frame: NavballFrame; markers: NavballMarker[] } | null => { return navball.navball.call(this, this.systems); };

  private telemetry(wv: WorldVessel): Telemetry { return telemetry.telemetry.call(this, this.systems, wv); }

  /** Gear / brakes / intake-air readouts for the HUD (null fields when the vessel has no such hardware). */
  private groundTelemetry(wv: WorldVessel): Pick<Telemetry, 'gear' | 'brakes' | 'intakeAir'> { return telemetry.groundTelemetry.call(this, this.systems, wv); }

  dispose() {
    this.photo.dispose();
    this.network?.close();
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.input.dispose();
    for (const v of this.views.values()) v.dispose();
    this.planets.dispose();
    this.site.dispose();
    this.map.dispose();
    this.stars.dispose();
    this.glare.dispose();
    this.reentry.dispose();
    this.effects.dispose();
    this.flags.dispose();
    this.scene.environment?.dispose();
    this.labelHost.remove();
    this.pipeline.dispose();
    this.pipeline.renderer.forceContextLoss();
    this.pipeline.renderer.domElement.remove();
  }
}
