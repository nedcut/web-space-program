import { applyCommsSettings, game } from '../game/store';
import { MultiplayerClient, type MultiplayerConfig } from '../net/client';
import { getTutorial } from '../tutorial/runtime';
import type { GameMode } from '../sim/science/progression';
import { FlagView } from '../render/vessel/FlagView';
import * as THREE from 'three';
import { RenderPipeline, getQuality, type QualityId } from '../render/core';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Starfield } from '../render/sky/Starfield';
import { SunGlare } from '../render/sky/SunGlare';
import { MapView } from '../render/map/MapView';
import { VesselView } from '../render/vessel/VesselView';
import { ReentryFx } from '../render/vessel/ReentryFx';
import { stagnationHeatFlux } from '../sim/vessel/heating';
import { World, quatFromBasis, type WorldVessel } from '../game/world';
import { Universe } from '../game/universe';
import { PART_CATALOG } from '../data/parts';
import { RESOURCES } from '../data/resources';
import type { CraftDef } from '../sim/vessel/types';
import type { SasMode } from '../sim/vessel/runtime';
import { neutralInput, computeStageDeltaV, freePorts, dockedPorts, gearState, type StageDeltaV, type PortInfo } from '../sim/vessel';
import type { Orbit } from '../sim/orbit/api';
import type { ExtraOrbit } from '../render/map/MapView';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../game/scenarios';
import { formatDistance, formatDuration } from '../ui/format';
import { maneuverToInertialDv } from '../sim/orbit';
import { FlightInput } from './input';
import { FlightCamera } from './camera';
import { warpLabel } from '../game/timewarp';
import type { Telemetry, HudStage, DockingTelemetry } from './hud/Hud';
import type { NavballFrame, NavballMarker } from './hud/navball';
import { add, cross, dot, length, normalize, scale, sub, v3, negate, type Vec3 } from '../util/vec3';
import { qRotate } from '../util/quat';
import { sampleAtmosphere } from '../sim/atmosphere';
import { createPlanetLayer, type PlanetLayer } from './planets';
import { LaunchSite } from '../render/site/LaunchSite';
import { deserializeWorld, serializeWorld, saveWorldToStorage, loadWorldFromStorage, type SavedWorld } from '../game/persistence';
import { createAssist, warpIndexFor, type AssistId } from './assist';
import type { Autopilot } from '../game/autopilot';
import type { GameAudio } from '../audio';
import type { ScalePresetId } from '../sim/bodies/scale';

const RESOURCE_COLORS: Record<string, string> = {
  liquidFuel: '#ffb35c',
  oxidizer: '#5cc8ff',
  monopropellant: '#d0d0d0',
  solidFuel: '#ff7a5c',
  electricCharge: '#ffe14d',
  xenon: '#b48cff',
  ablator: '#a08060',
};

/**
 * Owns the flight scene: world simulation, rendering (flight + map), input, camera.
 * React only hosts the canvas and HUD; this class runs the frame loop.
 */
export class FlightController {
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

    const q = getQuality(quality);
    this.stars = new Starfield({ count: q.stars.count, milkyWay: q.stars.milkyWay, seed: 7 });
    this.scene.add(this.stars.group);
    this.glare = new SunGlare();
    this.scene.add(this.glare.mesh);
    this.scene.add(this.sunLight, this.sunLight.target, this.ambient);
    this.scene.add(this.reentry.object, this.flags.root);
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
    host.appendChild(labelHost);
    this.map = new MapView(universe.bodies, universe.ephem, labelHost);
    this.map.setVisible(false);

    this.disposers.push(this.cam.attach(canvas, () => !this.mapMode));
    this.disposers.push(this.map.attachControls(canvas, () => this.mapMinDistance(), () => this.mapMode));
    this.disposers.push(this.attachMapPicking(canvas));
    this.disposers.push(
      this.input.onAction((a) => {
        // While paused (pause menu, vessel lost) only the menu toggle and quickload are live.
        if (this.paused && a !== 'menu' && a !== 'quickload') return;
        switch (a) {
          case 'stage': this.stagePending = true; break;
          case 'eva': this.goEva(); break;
          case 'board': this.boardEva(); break;
          case 'plantFlag': this.plantFlag(); break;
          case 'toggleSas': this.toggleSas(); break;
          case 'toggleRcs': this.rcsOn = !this.rcsOn; break;
          case 'toggleGear': this.toggleGear(); break;
          case 'map': this.toggleMap(); break;
          case 'warpUp': this.changeWarp(1); break;
          case 'warpDown': this.changeWarp(-1); break;
          case 'warpStop': if (this.network) this.network.send({ v: 1, type: 'warp', rate: 1 }); else this.world.warp = { mode: 'rails', index: 0 }; break;
          case 'menu': this.onExit?.(); break;
          case 'focusNext': if (!this.network?.ownId && this.world.focusNextNearby()) this.world.message(`Switched to ${this.world.active!.state.name}`); break;
          case 'quicksave': this.quicksave(); break;
          case 'quickload': if (!this.network) this.onQuickload?.(); break;
          case 'toggleCamMode': this.cam.mode = this.cam.mode === 'auto' ? (this.world.active?.state.eva ? 'free' : 'chase') : this.cam.mode === 'chase' ? 'free' : 'auto'; break;
        }
      }),
    );
    this.world.onEvent = (e) => {
      if (!this.audio) return;
      if (e.type === 'stage') this.audio.staging();
      if (e.type === 'decouple') this.audio.decouple();
      if (e.type === 'partDestroyed') this.audio.explosion(1);
      if (e.type === 'chute') this.audio.chuteDeploy();
      if (e.type === 'docked' || e.type === 'undocked') this.audio.decouple();
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
    if (this.network || getTutorial()) return;
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
  devScenario(name: string) {
    if (this.network) return;
    const wv = this.world.active;
    if (!wv) return;
    if (name === 'rendezvous') {
      placeInCircularOrbit(this.world, wv, 'earth', 90000);
      if (this.craft && spawnRendezvousTarget(this.world, this.craft, 100)) {
        this.speedMode = 'target';
        this.dockingMode = true;
        this.sasOn = true;
        this.sas = 'target';
        this.world.message('Rendezvous: target 100 m ahead. R = RCS, I/K J/L H/N translate.', 'info', 8);
      }
      return;
    }
    const u = this.world.universe;
    const t = this.world.ut;
    const bodyId = name === 'moon' ? 'moon' : 'earth';
    const b = u.body(bodyId);
    const bs = u.ephem.getBodyState(bodyId, t);
    const up = normalize(sub(wv.state.position, u.ephem.getBodyState(wv.body, t).position));
    const pole = qRotate(u.ephem.bodyRotation(bodyId, t), v3(0, 0, 1));
    const east = normalize(cross(pole, up));
    let alt = 0;
    let vel = v3();
    if (name === 'reentry') { alt = 30000; vel = add(scale(east, 2300), scale(up, -150)); }
    if (name === 'orbit') { alt = 90000; vel = scale(east, Math.sqrt(b.gm / (b.radius + 90000))); }
    if (name === 'moon') { alt = 20000; vel = scale(east, Math.sqrt(b.gm / (b.radius + 20000))); }
    wv.mode = 'physics';
    wv.fixed = undefined;
    wv.body = bodyId;
    wv.state.position = add(bs.position, scale(up, b.radius + alt));
    wv.state.velocity = add(bs.velocity, vel);
    wv.state.situation = 'flying';
    // Point retrograde-ish for re-entry, prograde otherwise.
    const fwd = name === 'reentry' ? normalize(scale(vel, -1)) : normalize(vel);
    const side = normalize(cross(fwd, up));
    wv.state.orientation = quatFromBasis(side, fwd, cross(side, fwd));
    wv.state.angularVelocity = v3();
  }

  startAssist(id: AssistId) {
    if (this.network) return;
    if (!this.world.active || this.world.active.state.eva || !this.world.canControl()) return;
    try {
      this.assist = createAssist(id, this.world);
      this.world.message(`Assist: ${this.assist.name}`);
    } catch (e) {
      this.world.message((e as Error).message, 'warn');
    }
  }

  cancelAssist(msg = 'Assist cancelled') {
    if (!this.assist) return;
    this.assist = null;
    if (this.assistWarped) this.world.warp = { mode: 'rails', index: 0 };
    this.assistWarped = false;
    this.world.message(msg, 'warn');
  }

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
      this.cam.distance = 6;
    }
  }

  boardEva() {
    if (this.paused) return;
    if (this.network) return this.network.action('board');
    if (this.world.boardEva()) {
      this.cancelAssist();
      this.stagePending = false;
      this.input.state.throttle = 0;
      this.cam.distance = Math.max(10, this.world.active!.state.cache.boundingRadius * 3);
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

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    if (this.network && this.lastOwnedVessel !== this.network.ownId) {
      this.lastOwnedVessel = this.network.ownId;
      this.input.state.throttle = 0;
      this.stagePending = false;
      this.sasOn = false;
    }
    this.input.evaMode = !!this.world.active?.state.eva;
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
    let input = ctrl;
    if (this.assist && wv && !this.paused) {
      // Any manual attitude/throttle input cancels the assist (pilot override).
      if (s.pitch || s.yaw || s.roll) this.cancelAssist('Assist cancelled: manual control');
      else {
        const step = this.assist.update(this.world);
        input = { ...step.input, stage: step.input.stage || ctrl.stage };
        this.input.state.throttle = step.input.throttle;
        if (this.assist.error) this.cancelAssist(`Assist stopped: ${this.assist.error}`);
        else if (this.assist.done) {
          this.world.message(`${this.assist.name}: complete`);
          this.assist = null;
          this.input.state.throttle = 0;
        } else if (step.coastUntil !== undefined) {
          const idx = warpIndexFor(step.coastUntil - this.world.ut, dt);
          this.world.warp = { mode: 'rails', index: idx };
          this.assistWarped = idx > 0;
        } else if (this.assistWarped) {
          this.world.warp = { mode: 'rails', index: 0 };
          this.assistWarped = false;
        }
      }
    }
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
      this.telemetryListeners.forEach((l) => l(t));
    }
  };

  private maneuverDirection(): Vec3 | null {
    const wv = this.world.active;
    const node = this.world.nodes[0];
    if (!wv || !node) return null;
    const rs = this.world.relativeState(wv);
    const dv = maneuverToInertialDv(rs, node);
    return length(dv) > 0 ? normalize(dv) : null;
  }

  private render(wv: WorldVessel, dt: number) {
    const u = this.world.universe;
    const t = this.world.ut;
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
        comms: this.world.commsSettings.enabled && game.get().settings.commsOverlay ? this.world.comms : undefined,
        vessel: { position: origin, patches: this.world.trajectory(), nodes: this.world.nodes },
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
      view.update(origin, this.elapsed, air.pressure, dt);
      const pose = this.network?.pose(v.state.id);
      if (pose) {
        view.root.position.set(pose.position.x - origin.x, pose.position.y - origin.y, pose.position.z - origin.z);
        view.root.quaternion.set(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);
      }
    }
    for (const [id, view] of this.views) if (!seen.has(id)) (view.dispose(), this.views.delete(id));

    this.flags.update(this.world);

    // Re-entry plasma on the active vessel.
    const airVel = this.world.surfaceVelocity(wv);
    const airSpeed = length(airVel);
    const flux = stagnationHeatFlux(air.density, airSpeed, Math.max(0.3, wv.state.cache.boundingRadius * 0.4));
    if (airSpeed > 1) {
      const d = normalize(airVel);
      this.reentry.update(flux, new THREE.Vector3(d.x, d.y, d.z), wv.state.cache.boundingRadius, this.elapsed);
    } else this.reentry.update(0, new THREE.Vector3(0, 1, 0), 1, this.elapsed);
    this.reentryHeat = Math.min(1, Math.max(0, (Math.log10(Math.max(flux, 1)) - 4.0) / 1.5));

    // Camera
    const up = normalize(sub(origin, bodyState.position));
    const q = wv.state.orientation;
    this.cam.update(new THREE.Vector3(up.x, up.y, up.z), new THREE.Quaternion(q.x, q.y, q.z, q.w), dt);
    const camera = this.cam.camera;
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
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = r * 8;
    sc.updateProjectionMatrix();

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
      extras.push({ id, position: v.state.position, orbit: c.orbit });
    }
    for (const id of this.mapOrbits.keys()) if (!w.vessels.has(id)) this.mapOrbits.delete(id);
    this.map.setExtraOrbits(extras);
    const kind = w.targetKind();
    this.map.setTarget(kind ? { kind, id: w.targetId! } : null);
    const ca = kind ? w.closestApproach() : null;
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
  private dockingPair(): { mine: PortInfo; theirs: PortInfo } | null {
    const w = this.world;
    const act = w.active;
    if (!act || !w.targetId || w.targetKind() !== 'vessel') return null;
    const theirsAll = freePorts(w.vessels.get(w.targetId)!.state);
    const mineAll = freePorts(act.state);
    if (!theirsAll.length || !mineAll.length) return null;
    const dist = (a: PortInfo, b: PortInfo) => length(sub(a.pos, b.pos)) + (a.mod.size === b.mod.size ? 0 : 1e9);
    let best: { mine: PortInfo; theirs: PortInfo } | null = null;
    const theirs = w.targetPortUid !== null ? theirsAll.filter((p) => p.part.uid === w.targetPortUid) : theirsAll;
    for (const t of theirs.length ? theirs : theirsAll)
      for (const m of mineAll) if (!best || dist(m, t) < dist(best.mine, best.theirs)) best = { mine: m, theirs: t };
    return best;
  }

  private dockingTelemetry(): DockingTelemetry | null {
    const pair = this.dockingPair();
    if (!pair) return null;
    const { mine, theirs } = pair;
    const q = this.world.active!.state.orientation;
    const fwd = mine.dir;
    const right = qRotate(q, qRotate(mine.part.rotation, v3(1, 0, 0)));
    const up = qRotate(q, qRotate(mine.part.rotation, v3(0, 0, 1)));
    const rel = sub(theirs.pos, mine.pos);
    const rv = sub(theirs.vel, mine.vel);
    const facing = negate(theirs.dir);
    return {
      myPort: mine.part.def.name,
      targetPort: theirs.part.def.name,
      sizeMatch: mine.mod.size === theirs.mod.size,
      x: dot(rel, right),
      y: dot(rel, up),
      z: dot(rel, fwd),
      vx: dot(rv, right),
      vy: dot(rv, up),
      vz: dot(rv, fwd),
      angle: (Math.acos(Math.max(-1, Math.min(1, dot(fwd, facing)))) * 180) / Math.PI,
      tiltX: dot(facing, right),
      tiltY: dot(facing, up),
      captureRange: Math.min(mine.mod.captureRange, theirs.mod.captureRange),
      captureSpeed: Math.min(mine.mod.captureSpeed, theirs.mod.captureSpeed),
      captureAngle: (Math.min(mine.mod.captureAngle, theirs.mod.captureAngle) * 180) / Math.PI,
    };
  }

  private targetTelemetry(wv: WorldVessel): Telemetry['target'] {
    const w = this.world;
    const kind = w.targetKind();
    const ts = w.targetState();
    if (!kind || !ts) return null;
    const rel = sub(ts.position, wv.state.position);
    const rv = sub(wv.state.velocity, ts.velocity);
    const d = length(rel);
    const ca = w.closestApproach();
    const tv = kind === 'vessel' ? w.vessels.get(w.targetId!)!.state : null;
    return {
      id: w.targetId!,
      name: w.targetName() ?? '',
      kind,
      distance: kind === 'body' ? d - w.universe.body(w.targetId!).radius : d,
      relSpeed: length(rv),
      closing: d > 0 ? dot(rv, rel) / d : 0,
      portUid: w.targetPortUid,
      ports: tv ? freePorts(tv).map((p) => ({ uid: p.part.uid, name: p.part.def.name })) : [],
      approach: ca ? { distance: ca.distance, time: ca.time - w.ut, relSpeed: ca.relativeSpeed } : null,
    };
  }

  private targetOptions(wv: WorldVessel): Telemetry['targetOptions'] {
    const w = this.world;
    const out: Telemetry['targetOptions'] = [];
    for (const v of w.vessels.values()) {
      if (v === wv) continue;
      out.push({ id: v.state.id, name: v.state.name, kind: 'vessel', distance: length(sub(v.state.position, wv.state.position)) });
    }
    out.sort((a, b) => a.distance - b.distance);
    const cur = w.universe.body(wv.body);
    const bodies: Telemetry['targetOptions'] = [];
    for (const b of w.universe.bodies.values()) {
      if (b.id === cur.id) continue;
      if (b.parent === cur.id || b.id === cur.parent || (cur.parent && b.parent === cur.parent)) {
        const bp = w.universe.ephem.getBodyState(b.id, w.ut).position;
        bodies.push({ id: b.id, name: b.name, kind: 'body', distance: length(sub(bp, wv.state.position)) - b.radius });
      }
    }
    bodies.sort((a, b) => a.distance - b.distance);
    return [...out.slice(0, 12), ...bodies];
  }

  private updateAudio(wv: WorldVessel | null) {
    if (!this.audio || !wv) return;
    const st = wv.state;
    let vac = 0;
    const byType = new Map<string, { thrust: number; count: number }>();
    for (const p of st.parts) {
      const eng = p.def.modules.find((m) => m.type === 'engine');
      if (!eng || eng.type !== 'engine') continue;
      vac += eng.maxThrustVac;
      if (p.engine && p.engine.thrust > 0) {
        const e = byType.get(eng.plume) ?? { thrust: 0, count: 0 };
        e.thrust += p.engine.thrust;
        e.count++;
        byType.set(eng.plume, e);
      }
    }
    const tm = st.telemetry;
    this.audio.update({
      engines: [...byType.entries()].map(([type, e]) => ({ type: type as 'kerolox', thrustFraction: vac > 0 ? e.thrust / vac : 0, count: e.count })),
      ambientPressure: tm.staticPressure,
      airspeed: length(this.world.surfaceVelocity(wv)),
      mach: tm.mach,
      dynamicPressure: tm.dynamicPressure,
      rcsActive: this.rcsOn && (this.input.state.tx || this.input.state.ty || this.input.state.tz) ? 1 : 0,
      reentryHeat: this.reentryHeat,
      inMapView: this.mapMode,
      timeWarp: this.world.warp.mode === 'rails' ? [1, 5, 10, 50, 100, 1000, 10000, 100000, 1000000][this.world.warp.index] : 1,
      cameraDistance: this.cam.distance,
    });
  }

  /** Navball frame for the active vessel (called by the HUD every animation frame). */
  navball = (): { frame: NavballFrame; markers: NavballMarker[] } | null => {
    const wv = this.world.active;
    if (!wv) return null;
    const rs = this.world.relativeState(wv);
    const up = normalize(rs.position);
    const pole = qRotate(this.world.universe.ephem.bodyRotation(wv.body, this.world.ut), v3(0, 0, 1));
    let east = cross(pole, up);
    if (length(east) < 1e-9) east = cross(v3(1, 0, 0), up);
    east = normalize(east);
    const north = cross(up, east);
    const q = wv.state.orientation;
    const forward = qRotate(q, v3(0, 1, 0));
    const top = qRotate(q, v3(0, 0, 1));
    const ts = this.world.targetState();
    const targetMode = this.speedMode === 'target' && !!ts;
    const vel = this.speedMode === 'surface' ? this.world.surfaceVelocity(wv) : targetMode ? sub(wv.state.velocity, ts!.velocity) : rs.velocity;
    const markers: NavballMarker[] = [];
    if (ts) {
      const toT = sub(ts.position, wv.state.position);
      if (length(toT) > 1e-6) {
        const d = normalize(toT);
        markers.push({ kind: 'target', dir: d }, { kind: 'antiTarget', dir: negate(d) });
      }
    }
    if (length(vel) > (targetMode ? 0.005 : 0.5)) {
      const pro = normalize(vel);
      markers.push({ kind: 'prograde', dir: pro }, { kind: 'retrograde', dir: negate(pro) });
      const h = cross(rs.position, rs.velocity);
      if (length(h) > 0) {
        const n = normalize(h);
        const radOut = normalize(cross(normalize(rs.velocity), n));
        markers.push({ kind: 'normal', dir: n }, { kind: 'antinormal', dir: negate(n) });
        markers.push({ kind: 'radialOut', dir: negate(radOut) }, { kind: 'radialIn', dir: radOut });
      }
    }
    const md = this.maneuverDirection();
    if (md) markers.push({ kind: 'maneuver', dir: md });
    return { frame: { east, north, up, forward, top }, markers };
  };

  private telemetry(wv: WorldVessel): Telemetry {
    const w = this.world;
    const u = w.universe;
    const b = u.body(wv.body);
    const info = u.surfaceInfo(wv.body, wv.state.position, w.ut);
    const orb = w.orbitSummary(wv);
    const rs = w.relativeState(wv);
    const st = wv.state;
    const target = this.targetTelemetry(wv);
    const speed = this.speedMode === 'surface' ? length(w.surfaceVelocity(wv)) : this.speedMode === 'target' && target ? target.relSpeed : length(rs.velocity);

    // Resources (totals across vessel).
    const totals = new Map<string, { amount: number; max: number }>();
    for (const p of st.parts) {
      for (const [id, max] of Object.entries(p.maxResources)) {
        const e = totals.get(id) ?? { amount: 0, max: 0 };
        e.amount += p.resources[id as keyof typeof p.resources] ?? 0;
        e.max += max ?? 0;
        totals.set(id, e);
      }
    }
    const pressure = st.telemetry.staticPressure;
    let dvs: StageDeltaV[] = [];
    try {
      dvs = computeStageDeltaV(st, pressure, b.surfaceGravity);
    } catch {
      dvs = [];
    }
    const stageMap = new Map<number, HudStage>();
    for (const p of st.parts) {
      // Engines that are already burning are listed as the current ("burning") stage so its Δv stays visible.
      const burning = p.activated && !!p.engine?.ignited;
      if (p.stage === undefined || (p.activated && !burning)) continue;
      const types = p.def.modules.map((m) => m.type);
      const icon: HudStage['parts'][number]['icon'] = types.includes('engine') ? 'engine' : types.includes('decoupler') ? 'decoupler' : types.includes('parachute') ? 'chute' : 'other';
      const idx = burning ? st.nextStage + 1 : p.stage;
      const s = stageMap.get(idx) ?? { index: idx, parts: [], deltaV: 0 };
      s.parts.push({ uid: p.uid, name: p.def.name, icon, active: p.activated });
      stageMap.set(idx, s);
    }
    const stages = [...stageMap.values()].sort((a, b2) => b2.index - a.index);
    stages.forEach((s) => {
      const d = dvs.find((x) => x.stage === s.index);
      s.deltaV = d?.dv ?? 0;
    });

    const warp = w.warp;
    return {
      crew: w.crewFor(st),
      noControl: !w.canControl(st) || (!!this.network && this.network.ownId !== st.id),
      eva: st.eva ? { fuel: st.parts[0].resources.monopropellant ?? 0, canBoard: !!w.boardingTarget(), landed: st.situation === 'landed' } : null,
      ut: w.ut,
      bodyName: b.name,
      altitudeAsl: info.altitude,
      altitudeTerrain: info.heightAboveTerrain,
      speedMode: this.speedMode,
      speed,
      verticalSpeed: w.verticalSpeed(wv),
      apoapsis: orb.ap,
      periapsis: orb.pe,
      timeToAp: orb.timeToAp,
      timeToPe: orb.timeToPe,
      throttle: this.input.state.throttle,
      gForce: st.telemetry.gForce,
      mach: st.telemetry.airDensity > 0 ? st.telemetry.mach : 0,
      dynamicPressure: st.telemetry.dynamicPressure,
      warp: 1,
      warpLabel: warpLabel(warp) + (warp.mode === 'physics' && warp.index > 0 ? ' phys' : ''),
      physicsWarp: warp.mode === 'physics' && warp.index > 0,
      sasOn: this.sasOn,
      sasMode: this.sas,
      rcsOn: this.rcsOn,
      ...this.groundTelemetry(wv),
      stage: st.nextStage,
      stages,
      resources: [...totals.entries()]
        .filter(([id, e]) => e.max > 0 && id !== 'intakeAir')
        .map(([id, e]) => ({ id, name: RESOURCES[id as keyof typeof RESOURCES]?.name ?? id, amount: e.amount, max: e.max, color: RESOURCE_COLORS[id] ?? '#aaa' })),
      messages: w.messages.map((m) => ({ id: m.id, text: m.text, level: m.level })),
      mapMode: this.mapMode,
      onSurface: wv.mode === 'prelaunch' || st.situation === 'landed' || st.situation === 'splashed',
      assist: this.assist ? { name: this.assist.name, status: this.assist.status } : null,
      target,
      targetOptions: this.targetOptions(wv),
      dockingMode: this.dockingMode,
      docking: this.dockingMode ? this.dockingTelemetry() : null,
      dockedPorts: dockedPorts(st).map((p) => ({ uid: p.uid, name: p.def.name })),
    };
  }

  /** Gear / brakes / intake-air readouts for the HUD (null fields when the vessel has no such hardware). */
  private groundTelemetry(wv: WorldVessel): Pick<Telemetry, 'gear' | 'brakes' | 'intakeAir'> {
    const st = wv.state;
    let gear: Telemetry['gear'] = null;
    let wheels = false;
    for (const p of st.parts) {
      if (p.wheel) {
        wheels = true;
        const g = p.wheel.deploy >= 1 ? 'down' : p.wheel.deploy <= 0 ? 'up' : 'moving';
        gear = gear === null || gear === g ? g : 'moving';
      } else if (p.leg) {
        const g = p.leg.deployed ? 'down' : 'up';
        gear = gear === null || gear === g ? g : 'moving';
      }
    }
    const air = st.telemetry.intakeAirRatio;
    return { gear, brakes: wheels ? this.input.state.brakes : null, intakeAir: Number.isFinite(air) ? air : null };
  }

  dispose() {
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
    this.flags.dispose();
    this.scene.environment?.dispose();
    this.labelHost.remove();
    this.pipeline.dispose();
    this.pipeline.renderer.forceContextLoss();
    this.pipeline.renderer.domElement.remove();
  }
}

// Silence unused import warnings for helpers kept for upcoming features.
void add; void dot; void scale;
