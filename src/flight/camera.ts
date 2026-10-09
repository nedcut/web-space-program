import { game } from '../game/store';
import * as THREE from 'three';
import { liftoffDollyPitch, liftoffDollyScale, LIFTOFF_DOLLY, towerFov } from './cameraFraming';

/**
 * Flight camera: orbits the active vessel. The scene origin is the vessel (floating origin), so the camera
 * only needs a local offset from the vessel's centre of mass.
 *
 * Every frame the controller supplies a {@link CameraFrame} (local vertical, vessel attitude, velocity, orbit
 * normal, terrain clearance). The camera keeps separate *target* and *current* yaw/pitch/distance: input moves
 * the targets and the view eases towards them, which gives mouse/keyboard orbiting weight and inertia without
 * feeling laggy. Zoom limits follow the vessel size and the view never dips below the terrain.
 *
 * Modes:
 * - `auto`    — horizon-level near a body; blends to the orbital plane once well above the atmosphere.
 * - `free`    — inertial: fixed against the stars, ignores the planet.
 * - `orbital` — "up" is the orbit normal, so the orbit plane is the horizon.
 * - `chase`   — trails the direction of travel (surface velocity in air, orbital velocity in space).
 * - `locked`  — rigidly attached to the vessel and rolls with it.
 * - `tower`   — a fixed spot on the ground near the vessel that tracks and zooms as it climbs (the controller
 *               supplies the eye point and hands back to `auto` once the craft is far away).
 */
export type CameraMode = 'auto' | 'free' | 'orbital' | 'chase' | 'locked' | 'tower';

export const CAMERA_MODES: readonly CameraMode[] = ['auto', 'free', 'orbital', 'chase', 'locked', 'tower'];

export const CAMERA_MODE_INFO: Record<CameraMode, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'Horizon-level near the surface, orbit-aligned in space' },
  free: { label: 'Free', hint: 'Fixed against the stars' },
  orbital: { label: 'Orbital', hint: 'Orbit plane is the horizon' },
  chase: { label: 'Chase', hint: 'Follows the direction of travel' },
  locked: { label: 'Locked', hint: 'Attached to the vessel; rolls with it' },
  tower: { label: 'Tower', hint: 'Ground camera near the pad; tracks the climb' },
};

/** Mode cycle order. EVA skips orbital/chase (little meaning on foot); the tower only joins near the ground. */
export function cameraModeCycle(eva: boolean, tower: boolean): readonly CameraMode[] {
  if (eva) return ['auto', 'free', 'locked'];
  return tower ? CAMERA_MODES : CAMERA_MODES.filter(m => m !== 'tower');
}

/** Next mode in the cycle; a mode missing from the cycle (e.g. the tower once it is unavailable) restarts it. */
export function nextCameraMode(current: CameraMode, eva: boolean, tower: boolean): CameraMode {
  const list = cameraModeCycle(eva, tower);
  const i = list.indexOf(current);
  return list[(i + 1) % list.length] ?? 'auto';
}

export interface CameraFrame {
  /** Radial-out unit vector at the vessel (scene space). */
  up: THREE.Vector3;
  /** Vessel attitude (scene space). */
  vesselQuat: THREE.Quaternion;
  /** Velocity used by chase mode (scene space, m/s). */
  velocity?: THREE.Vector3;
  /** Orbit angular-momentum direction (scene space, unit), if meaningful. */
  orbitNormal?: THREE.Vector3 | null;
  /** 0 = near the ground / in the atmosphere, 1 = high in space (auto-mode blend). */
  spaceBlend?: number;
  /** Active vessel identity and bounding radius (zoom limits and automatic framing). */
  vesselId?: string;
  radius?: number;
  /** Height above terrain/sea of a scene-space point (camera collision). */
  clearance?: (scenePoint: THREE.Vector3) => number;
  /** Continuous rumble 0..1 (already zero when reduce-motion is on). */
  rumble?: number;
  /** Suppress an in-progress event immediately when accessibility settings change. */
  motionEnabled?: boolean;
  /** Upward lens shift (fraction of viewport height) that keeps the vessel and plume clear of the bottom HUD. */
  lensShift?: number;
  /** Extra FOV (deg) as a speed cue; 0 with reduced motion. */
  fovBoost?: number;
  /**
   * Middle of the vessel's extent relative to the orbit pivot (scene space). The lens shift frames this point rather
   * than the pivot, so a tall rocket whose COM sits low in the stack is centred as a whole.
   */
  frameCentre?: THREE.Vector3;
  /** Tower mode: the ground eye point (scene space). Without it the tower mode behaves like `auto`. */
  eye?: THREE.Vector3 | null;
  /** Orbit/aim point relative to the scene origin (the vessel COM), e.g. from {@link PivotSmoother}. */
  pivot?: THREE.Vector3;
}

/**
 * Keeps the camera's orbit point continuous when the centre of mass jumps inside the vessel (staging, docking,
 * a dropped part): the jump is fed in as an offset in the vessel's build frame — "where the old COM was on the
 * vessel" — which then settles back onto the new COM along a critically damped curve (no snap, no overshoot).
 */
export class PivotSmoother {
  /** Settle time constant, s (≈ 95 % settled after 4.7 τ). */
  static readonly TAU = 0.3;
  private id: string | undefined;
  private com = { x: 0, y: 0, z: 0 };
  /** Offset of the pivot from the COM (build frame) and its rate. */
  readonly offset = { x: 0, y: 0, z: 0 };
  private rate = { x: 0, y: 0, z: 0 };

  /** Advance with the active vessel's id and build-frame COM; returns the build-frame offset. */
  update(id: string, com: { x: number; y: number; z: number }, dt: number) {
    const o = this.offset, r = this.rate;
    if (id !== this.id) {
      this.id = id;
      o.x = o.y = o.z = r.x = r.y = r.z = 0;
    } else {
      o.x += this.com.x - com.x; o.y += this.com.y - com.y; o.z += this.com.z - com.z;
    }
    this.com.x = com.x; this.com.y = com.y; this.com.z = com.z;
    const w = 1 / PivotSmoother.TAU;
    // Exact step of the critically damped oscillator x'' = −2ωx' − ω²x.
    const e = Math.exp(-w * dt);
    for (const k of ['x', 'y', 'z'] as const) {
      const x = o[k], v = r[k];
      o[k] = (x + (v + w * x) * dt) * e;
      r[k] = (v - (v + w * x) * w * dt) * e;
      if (Math.abs(o[k]) < 1e-6 && Math.abs(r[k]) < 1e-6) o[k] = r[k] = 0;
    }
    return o;
  }
}

/** Ease time constants (s). Short enough to feel direct, long enough to hide mouse/wheel quantisation. */
const ORBIT_TAU = 0.07;
const ZOOM_TAU = 0.14;
/** The automatic reframe when staging shrinks the vessel eases slower than the wheel: a glide, not a snap-zoom. */
const REFRAME_TAU = 0.6;
const CHASE_TAU = 0.35;
const MIN_PITCH = -1.5;
const MAX_PITCH = 1.5;

const Y = new THREE.Vector3(0, 1, 0);
/** Lens shift and FOV cue ease time constants (s): slow enough that a HUD toggle or max-Q never jolts the view. */
const SHIFT_TAU = 0.4;
const FOV_TAU = 0.8;
/** Largest correction (fraction of viewport height) for the vessel centre sitting off the pivot. */
const CENTRE_SHIFT_MAX = 0.2;
const _camUp = new THREE.Vector3();
const _camFwd = new THREE.Vector3();

/** Camera distance that comfortably frames a vessel of bounding radius `r` (60° FOV). */
export function framingDistance(r: number) {
  return Math.max(4, r * 3.2);
}

export function zoomLimits(r: number): { min: number; max: number } {
  const radius = Math.max(0.5, r);
  return { min: Math.max(1.6, radius * 1.15), max: Math.max(5000, radius * 400) };
}

/** Exponential ease factor for a time constant. */
const ease = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class FlightCamera {
  readonly camera: THREE.PerspectiveCamera;
  private _mode: CameraMode = 'auto';
  private cYaw = Math.PI * 0.75;
  private cPitch = 0.15;
  private cDist = 25;
  private tYaw = this.cYaw;
  private tPitch = this.cPitch;
  private tDist = this.cDist;
  /** Mouse fling (rad/s), decays after release. */
  private yawVel = 0;
  private pitchVel = 0;
  minDistance = 3;
  maxDistance = 5000;
  private dragging = false;
  private lx = 0;
  private ly = 0;
  private lastMove = 0;
  private smoothedUp = new THREE.Vector3(0, 0, 1);
  private upInitialised = false;
  private horizonBasis: THREE.Quaternion | null = null;
  private basis = new THREE.Quaternion();
  /** Chase-mode heading of the velocity in the horizon basis (smoothed). */
  private chaseYaw = 0;
  private chasePitch = 0;
  private chaseInit = false;
  /** Direction to keep on screen across a mode change (scene space). */
  private remap: THREE.Vector3 | null = null;
  private upTau = 0.25;
  private vesselId: string | undefined;
  private radius = 0;
  private time = 0;
  private kick = 0;
  /** Current (eased) lens shift and FOV cue; the first frame snaps. */
  private shift = 0;
  private shiftInit = false;
  private fovCue = 0;
  /** Seconds since liftoff while the liftoff dolly runs, else -1. */
  private dollyT = -1;
  /** FOV (deg) from the settings; the camera adds the speed cue or the tower zoom on top. */
  baseFov: number;
  /** Keyboard / gamepad orbit input (-1..1 per axis), applied as a rate. */
  readonly drive = { yaw: 0, pitch: 0, zoom: 0 };
  /** Last applied terrain push (m), exposed for tests/telemetry. */
  terrainPush = 0;

  constructor(fov = 60) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 1e13);
    this.baseFov = fov;
  }

  get mode() { return this._mode; }
  set mode(m: CameraMode) {
    if (m === this._mode) return;
    const prev = this._mode;
    // Keep the current view direction on screen; only the reference frame changes.
    if (this.horizonBasis || this._mode === 'locked') this.remap = this.camera.position.clone().normalize();
    this._mode = m;
    this.upTau = 0.3;
    if (m === 'chase') this.chaseInit = false;
    // A cut to or from the tower must not inherit the other camera's up vector ease.
    if (m === 'tower' || prev === 'tower') this.upInitialised = false;
  }

  /** Cycle to the next mode (EVA skips orbital/chase; `tower` only when a ground camera is available). */
  cycleMode(eva = false, tower = false) {
    this.mode = nextCameraMode(this._mode, eva, tower);
    return this.mode;
  }

  /** Start the liftoff dolly: the view backs out and drops slightly over the first seconds of the climb. */
  startLiftoff() { this.dollyT = 0; }

  /** Drop the lens shift (photo mode composes its own frame). */
  clearLensShift() {
    this.shift = 0;
    this.camera.clearViewOffset();
  }

  // Direct assignment snaps (scripts, scenario setup); interactive input eases via the targets.
  get yaw() { return this.cYaw; }
  set yaw(v: number) { this.cYaw = this.tYaw = v; this.yawVel = 0; }
  get pitch() { return this.cPitch; }
  set pitch(v: number) { this.cPitch = this.tPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, v)); this.pitchVel = 0; }
  get distance() { return this.cDist; }
  set distance(v: number) { this.cDist = this.tDist = v; this.distanceSet = true; }
  private distanceSet = false;
  get targetDistance() { return this.tDist; }

  /** Ease to a new distance (vessel switch, staging, EVA); `tau` = ease time constant, s. */
  zoomTo(d: number, tau = ZOOM_TAU) {
    this.tDist = Math.max(this.minDistance, Math.min(this.maxDistance, d));
    this.zoomTau = tau;
  }
  private zoomTau = ZOOM_TAU;

  /** Short decaying camera kick (staging, decoupling). */
  addKick(amount: number) {
    this.kick = Math.min(2.25, this.kick + amount);
  }

  update(f: CameraFrame, dt: number) {
    this.time += dt;
    this.applySize(f.vesselId, f.radius);

    // Input → targets.
    const rate = 1.8; // rad/s at full keyboard deflection
    this.tYaw += this.drive.yaw * rate * dt;
    this.tPitch += this.drive.pitch * rate * dt;
    if (this.drive.zoom) { this.tDist *= Math.exp(this.drive.zoom * 1.6 * dt); this.zoomTau = ZOOM_TAU; this.dollyT = -1; }
    if (!this.dragging) {
      this.tYaw += this.yawVel * dt;
      this.tPitch += this.pitchVel * dt;
      const decay = Math.exp(-dt / 0.18);
      this.yawVel *= decay;
      this.pitchVel *= decay;
      if (Math.abs(this.yawVel) < 1e-3) this.yawVel = 0;
      if (Math.abs(this.pitchVel) < 1e-3) this.pitchVel = 0;
    }
    this.tPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.tPitch));
    this.tDist = Math.max(this.minDistance, Math.min(this.maxDistance, this.tDist));

    // Reference frame.
    const up = this.referenceUp(f);
    if (this._mode === 'locked') {
      this.basis.copy(f.vesselQuat);
    } else {
      if (!this.horizonBasis) this.horizonBasis = new THREE.Quaternion().setFromUnitVectors(Y, up);
      else if (this._mode !== 'free') {
        // Parallel transport: rotate last frame's basis by the minimal rotation taking the previous up to the
        // new one. Avoids the singularity of building it from a fixed axis each frame.
        const prevUp = Y.clone().applyQuaternion(this.horizonBasis);
        this.horizonBasis.premultiply(new THREE.Quaternion().setFromUnitVectors(prevUp, up)).normalize();
      }
      this.basis.copy(this.horizonBasis);
    }
    const basisUp = Y.clone().applyQuaternion(this.basis);

    // Chase: the orbit angles become offsets from "behind the velocity vector".
    let baseYaw = 0;
    let basePitch = 0;
    if (this._mode === 'chase') {
      const v = f.velocity && f.velocity.lengthSq() > 1 ? f.velocity.clone() : Y.clone().applyQuaternion(f.vesselQuat);
      const local = v.normalize().applyQuaternion(this.basis.clone().invert());
      const yaw = Math.atan2(-local.z, -local.x);
      const pitch = -Math.asin(Math.max(-1, Math.min(1, local.y))) * 0.6;
      if (!this.chaseInit) {
        // Start from the current view and swing round behind the vessel at the chase rate (no snap).
        const view = (this.remap ?? this.camera.position.clone().normalize()).clone().applyQuaternion(this.basis.clone().invert());
        this.chaseYaw = this.camera.position.lengthSq() > 0 ? Math.atan2(view.z, view.x) : yaw;
        this.chasePitch = 0;
        this.cYaw = this.tYaw = 0;
        this.cPitch = this.tPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.asin(Math.max(-1, Math.min(1, view.y)))));
        this.yawVel = this.pitchVel = 0;
        this.remap = null;
        this.chaseInit = true;
      }
      const k = ease(dt, CHASE_TAU);
      this.chaseYaw += wrapAngle(yaw - this.chaseYaw) * k;
      this.chasePitch += (pitch - this.chasePitch) * k;
      baseYaw = this.chaseYaw;
      basePitch = this.chasePitch;
    }

    if (this.remap) {
      const local = this.remap.clone().applyQuaternion(this.basis.clone().invert());
      this.cYaw = this.tYaw = Math.atan2(local.z, local.x) - baseYaw;
      this.cPitch = this.tPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.asin(Math.max(-1, Math.min(1, local.y))) - basePitch));
      this.yawVel = this.pitchVel = 0;
      this.remap = null;
    }

    // Liftoff dolly: scale distance and offset pitch by this frame's step of the curve, so player input still adds on top.
    if (this.dollyT >= 0) {
      if (this._mode !== 'auto' && this._mode !== 'chase') this.dollyT = -1;
      else {
        const t0 = this.dollyT, t1 = t0 + dt;
        const r = liftoffDollyScale(t1) / liftoffDollyScale(t0);
        const dp = liftoffDollyPitch(t1) - liftoffDollyPitch(t0);
        this.tDist = Math.min(this.maxDistance, this.tDist * r);
        this.cDist = Math.min(this.maxDistance, this.cDist * r);
        this.tPitch = Math.max(MIN_PITCH, this.tPitch + dp);
        this.cPitch = Math.max(MIN_PITCH, this.cPitch + dp);
        this.dollyT = t1 >= LIFTOFF_DOLLY.duration ? -1 : t1;
      }
    }

    // Ease current → target. Yaw targets accumulate freely; ease along the shortest arc.
    const ko = ease(dt, ORBIT_TAU);
    this.cYaw += (this.tYaw - this.cYaw) * ko;
    this.cPitch += (this.tPitch - this.cPitch) * ko;
    this.cDist = Math.exp(Math.log(this.cDist) + (Math.log(this.tDist) - Math.log(this.cDist)) * ease(dt, this.zoomTau));

    const yaw = this.cYaw + baseYaw;
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.cPitch + basePitch));
    const cp = Math.cos(pitch);
    const offset = new THREE.Vector3(Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp)
      .multiplyScalar(this.cDist)
      .applyQuaternion(this.basis);

    // Terrain collision: lift the camera along the local vertical, never through the ground.
    this.terrainPush = 0;
    if (f.clearance) {
      const minClear = Math.max(0.6, this.cDist * 0.01);
      const h = f.clearance(f.pivot ? offset.clone().add(f.pivot) : offset);
      if (Number.isFinite(h) && h < minClear) {
        this.terrainPush = minClear - h;
        offset.addScaledVector(f.up, this.terrainPush);
      }
    }

    // Camera "up": follows the basis with a short ease so mode switches and SOI changes do not snap.
    if (!this.upInitialised) { this.smoothedUp.copy(basisUp); this.upInitialised = true; }
    this.upTau = Math.max(this._mode === 'locked' ? 0.02 : 0.25, this.upTau - dt * 0.5);
    this.smoothedUp.lerp(basisUp, ease(dt, this.upTau)).normalize();

    const px = f.pivot?.x ?? 0, py = f.pivot?.y ?? 0, pz = f.pivot?.z ?? 0;
    const tower = this._mode === 'tower' ? f.eye ?? null : null;
    if (tower) {
      // Fixed ground eye looking at the vessel, horizon level; the zoom keeps the climbing craft a readable size.
      this.camera.position.copy(tower);
      this.camera.up.copy(f.up);
    } else {
      this.camera.position.copy(offset);
      this.camera.position.x += px; this.camera.position.y += py; this.camera.position.z += pz;
      this.camera.up.copy(this.smoothedUp);
    }
    this.camera.lookAt(px, py, pz);

    // Speed FOV cue (eased) and the tower's tracking zoom.
    const cueTarget = f.motionEnabled === false ? 0 : f.fovBoost ?? 0;
    this.fovCue += (cueTarget - this.fovCue) * ease(dt, FOV_TAU);
    this.camera.fov = tower
      ? towerFov(this.baseFov, this.radius, Math.hypot(this.camera.position.x - px, this.camera.position.y - py, this.camera.position.z - pz))
      : this.baseFov + this.fovCue;

    // A directional impulse plus damped vibration: the first event frame always reads as a punch.
    if (f.motionEnabled === false) this.kick = 0;
    const shake = f.motionEnabled === false ? 0 : f.rumble ?? 0;
    if (shake > 1e-3 || this.kick > 1e-3) {
      const t = this.time;
      this.camera.rotateX(this.kick * .025 + Math.sin(t*37.1)*shake*.014);
      this.camera.rotateY(this.kick * -.012 + Math.sin(t*43.3)*shake*.012);
      this.camera.translateY(this.kick * .28 + Math.sin(t*43.3)*shake*.08);
      this.camera.translateX(this.kick * -.18);
    }
    this.kick *= Math.exp(-dt / .32);

    this.camera.near = Math.max(0.05, (tower ? Math.min(this.cDist, this.camera.position.length()) : this.cDist) * 0.005);
    // Lens shift: an off-centre projection window, so the orbit geometry and controls are unchanged while the
    // vessel sits higher on screen. The view object is created once and then edited in place (no per-frame allocation).
    let centreShift = 0;
    if (f.frameCentre) {
      // Screen-space drop (fraction of viewport height) of the vessel centre below the pivot, before any shake.
      const c = this.camera.position, q = this.camera.quaternion, k = f.frameCentre;
      const u = _camUp.set(0, 1, 0).applyQuaternion(q), w = _camFwd.set(0, 0, -1).applyQuaternion(q);
      const pdx = px - c.x, pdy = py - c.y, pdz = pz - c.z;
      const cdx = pdx + k.x, cdy = pdy + k.y, cdz = pdz + k.z;
      const pz0 = pdx * w.x + pdy * w.y + pdz * w.z, cz0 = cdx * w.x + cdy * w.y + cdz * w.z;
      if (pz0 > 1e-3 && cz0 > 1e-3) {
        const yp = (pdx * u.x + pdy * u.y + pdz * u.z) / pz0, yc = (cdx * u.x + cdy * u.y + cdz * u.z) / cz0;
        const drop = (yp - yc) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
        centreShift = Math.max(-CENTRE_SHIFT_MAX, Math.min(CENTRE_SHIFT_MAX, drop));
      }
    }
    const shiftTarget = Math.max(-CENTRE_SHIFT_MAX, Math.min(0.45, (f.lensShift ?? 0) + centreShift));
    this.shift = !this.shiftInit ? shiftTarget : this.shift + (shiftTarget - this.shift) * ease(dt, SHIFT_TAU);
    this.shiftInit = true;
    const view = this.camera.view;
    if (Math.abs(this.shift) > 1e-4) {
      if (!view) this.camera.setViewOffset(1, 1, 0, this.shift, 1, 1);
      else { view.enabled = true; view.offsetY = this.shift; }
    } else if (view) view.enabled = false;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Desired "up" of the horizon basis for the current mode. */
  private referenceUp(f: CameraFrame): THREE.Vector3 {
    const radial = f.up.clone().normalize();
    const normal = f.orbitNormal && f.orbitNormal.lengthSq() > 0.5 ? f.orbitNormal.clone().normalize() : null;
    if (this._mode === 'orbital') return normal ?? radial;
    if (this._mode === 'auto' && normal) {
      const s = Math.max(0, Math.min(1, f.spaceBlend ?? 0));
      if (s <= 0) return radial;
      const blended = radial.clone().multiplyScalar(1 - s).addScaledVector(normal, s);
      return blended.lengthSq() > 1e-6 ? blended.normalize() : normal;
    }
    return radial;
  }

  /** Zoom limits from vessel size and automatic framing on vessel switches / staging. */
  private applySize(id: string | undefined, r: number | undefined) {
    if (r === undefined || !(r > 0)) return;
    const lim = zoomLimits(r);
    this.minDistance = lim.min;
    this.maxDistance = lim.max;
    if (id !== this.vesselId) {
      const first = this.vesselId === undefined;
      this.vesselId = id;
      this.radius = r;
      const d = framingDistance(r);
      if (!first) this.zoomTo(d);
      else if (!this.distanceSet) this.cDist = this.tDist = Math.max(lim.min, Math.min(lim.max, d));
      return;
    }
    // Same vessel changed size (staging, docking): keep the same apparent size if it was framed closely.
    if (Math.abs(r - this.radius) > this.radius * 0.2) {
      if (this.tDist < this.radius * 8) this.zoomTo(this.tDist * (r / this.radius), REFRAME_TAU);
      this.radius = r;
    }
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  attach(el: HTMLElement, enabled: () => boolean = () => true) {
    const down = (e: PointerEvent) => {
      if (!enabled()) return;
      if (e.button !== 2 && e.button !== 0) return;
      if (game.get().settings.mouseFlight && e.button === 0) return;
      this.dragging = true;
      this.yawVel = this.pitchVel = 0;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.lastMove = performance.now();
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging || !enabled()) { this.dragging = false; return; }
      const dx = (e.clientX - this.lx) * 0.005;
      const dy = (e.clientY - this.ly) * 0.005;
      this.tYaw += dx;
      this.tPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.tPitch + dy));
      const now = performance.now();
      const span = Math.max(8, now - this.lastMove) / 1000;
      // Release velocity estimate for a gentle fling (capped so a jerky mouse cannot spin the view).
      this.yawVel = Math.max(-3, Math.min(3, this.yawVel * 0.5 + (dx / span) * 0.5));
      this.pitchVel = Math.max(-3, Math.min(3, this.pitchVel * 0.5 + (dy / span) * 0.5));
      this.lastMove = now;
      this.lx = e.clientX;
      this.ly = e.clientY;
    };
    const up = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // Holding still before release means "stop here", not "fling".
      if (performance.now() - this.lastMove > 60) this.yawVel = this.pitchVel = 0;
      else { this.yawVel *= 0.35; this.pitchVel *= 0.35; }
    };
    const wheel = (e: WheelEvent) => {
      if (!enabled()) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.tDist = Math.max(this.minDistance, Math.min(this.maxDistance, this.tDist * Math.exp(delta * 0.0012)));
      this.zoomTau = ZOOM_TAU;
      this.dollyT = -1;
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
    };
  }
}

/**
 * Camera kick for a hard touchdown: remembers the descent rate while flying and, on the frame the vessel
 * reaches the ground, returns a kick that grows from 0 at 1.5 m/s to the maximum at 9 m/s.
 */
export class TouchdownKick {
  private id: string | undefined;
  private grounded = true;
  private sink = 0;
  /** `verticalSpeed` is the surface-relative vertical speed (m/s, negative = descending). */
  update(id: string, grounded: boolean, verticalSpeed: number, _dt: number): number {
    if (id !== this.id) { this.id = id; this.grounded = grounded; this.sink = 0; return 0; }
    let kick = 0;
    if (!grounded) this.sink = Math.max(0, -verticalSpeed);
    else if (!this.grounded) kick = Math.max(0, Math.min(1, (this.sink - 1.5) / 7.5));
    this.grounded = grounded;
    return kick;
  }
}
