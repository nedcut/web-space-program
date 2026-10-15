import * as THREE from 'three';
import { type World, type WorldVessel } from '../../game/world';
import type { LaunchSite } from '../../render/site/LaunchSite';
import { cameraShakeScale, game } from '../../game/store';
import { warpRate } from '../../game/timewarp';
import { flightRumble } from '../../audio/design';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import { CAMERA_MODE_INFO, type FlightCamera, PivotSmoother, TouchdownKick } from '../camera';
import { hudLensShift, LiftoffDetector, speedFovBoost, towerAvailable, towerPlacement, towerRevertDistance } from '../cameraFraming';

/** Bottom-HUD and top-HUD extents (CSS px at HUD scale 1) used to frame the vessel in the clear band between them. */
export const HUD_TOP_PX = 64;
const HUD_BOTTOM_EXTRA_PX = 70;

/** Camera reference frames and continuity across liftoff, contact, staging and tower-mode changes. */
export class FlightCameraRig {
  private readonly raycaster = new THREE.Raycaster();
  constructor(private world: World, private cam: FlightCamera, private drive: { yaw: number; pitch: number; zoom: number }) {}

  private readonly camUp = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private readonly camVel = new THREE.Vector3();
  private readonly camNormal = new THREE.Vector3();
  private readonly camProbe = { x: 0, y: 0, z: 0 };
  private readonly camPivot = new THREE.Vector3();
  private readonly pivotSmoother = new PivotSmoother();
  private readonly touchdown = new TouchdownKick();

  /** Feed the orbit camera its reference frame, framing size, terrain clearance and rumble for this frame. */
  update(wv: WorldVessel, origin: Vec3, bodyState: { position: Vec3; velocity: Vec3 }, airVel: Vec3, t: number, dt: number,
    paused: boolean, uiHidden: boolean, viewportHeight: number, site: LaunchSite | null) {
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
    if (shake > 0 && !paused && warpRate(this.world.warp) <= 1) {
      rumble = flightRumble(tel.thrust, st.mass * body.surfaceGravity, agl, tel.dynamicPressure, tel.mach) * shake;
      // Touchdown kick, growing with the vertical speed at contact (a gentle 1.5 m/s landing stays still).
      const touchdown = this.touchdown.update(st.id, st.situation !== 'flying', dot(airVel, up), dt);
      if (touchdown > 0) this.cam.addKick(touchdown * shake);
    }
    const probe = this.camProbe;
    this.cam.drive.yaw = this.drive.yaw;
    this.cam.drive.pitch = this.drive.pitch;
    this.cam.drive.zoom = this.drive.zoom;
    const q = st.orientation;
    // Staging/docking move the COM (the scene origin) inside the vessel: ease the orbit point across instead of jumping.
    const po = this.pivotSmoother.update(st.id, st.com, dt);
    const pw = qRotate(q, po);
    // Liftoff: the auto camera eases back from the pad framing (an automatic camera move, so not with reduced motion).
    const grounded = st.situation !== 'flying' || wv.mode === 'prelaunch';
    if (this.liftoff.update(st.id, grounded, tel.thrust > 0, paused ? 0 : dt) && !settings.reduceMotion) this.cam.startLiftoff();
    if (this.cam.mode !== 'tower') this.tower = null;
    const eye = this.cam.mode === 'tower' ? this.towerEye(wv, origin, bodyState.position, t, agl, site) : null;
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
    const lensShift = uiHidden ? 0 : hudLensShift(viewportHeight, HUD_TOP_PX * hud, (settings.navballSize + HUD_BOTTOM_EXTRA_PX) * hud);
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

  private readonly liftoff = new LiftoffDetector();
  private readonly camEye = new THREE.Vector3();
  private readonly camMid = new THREE.Vector3();
  /** Time spent choosing the last tower eye (ms; telemetry for perf checks). */
  towerPickMs = 0;
  /** Launch-site structure meshes (not instanced vegetation) that can block the tower camera's view. */
  private towerBlockers(site: LaunchSite | null): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (!site?.root.visible) return out;
    site.root.updateMatrixWorld();
    site.root.traverseVisible(o => {
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
  private towerEye(wv: WorldVessel, origin: Vec3, bodyPos: Vec3, t: number, agl: number, site: LaunchSite | null): THREE.Vector3 | null {
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
      const blockers = this.towerBlockers(site);
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

}
