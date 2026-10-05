import { PhotoCamera } from '../../render/core/PhotoCamera';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RenderPipeline, getQuality, type QualityId } from '../../render/core';
import { Starfield } from '../../render/sky/Starfield';
import { SunGlare } from '../../render/sky/SunGlare';
import { LaunchSite, type SiteObjectId } from '../../render/site/LaunchSite';
import { VesselView } from '../../render/vessel/VesselView';
import { createPlanetLayer, type PlanetLayer } from '../../flight/planets';
import { Universe } from '../../game/universe';
import { World } from '../../game/world';
import { PART_CATALOG } from '../../data/parts';
import { STOCK_CRAFTS } from '../../editor/stockCrafts';
import type { CraftDef } from '../../sim/vessel/types';
import type { ScalePresetId } from '../../sim/bodies/scale';
import { qRotate } from '../../util/quat';
import { add, dot, normalize, sub, type Vec3 } from '../../util/vec3';

export interface HubSceneOptions {
  preset: ScalePresetId;
  quality: QualityId;
  /** Universal time the hub starts from; the scene searches forward for golden hour at the pad. */
  ut: number;
  /** Craft to display on the pad (null = empty pad). */
  craft: CraftDef | null;
  /** Called when a building is clicked. */
  onPick?: (id: SiteObjectId) => void;
}

/** Target sun elevation (deg) for the cinematic golden-hour look. */
const GOLDEN_ELEVATION = 8;

/** Sun elevation (deg) at the pad at time t. */
function sunElevation(u: Universe, site: LaunchSite, t: number): number {
  const bs = u.ephem.getBodyState('earth', t).position;
  const q = u.ephem.bodyRotation('earth', t);
  const pad = add(bs, qRotate(q, site.padFixed));
  const up = normalize(qRotate(q, site.padFixed));
  const sun = normalize(sub(u.ephem.getBodyState(u.sunId, t).position, pad));
  return (Math.asin(Math.max(-1, Math.min(1, dot(up, sun)))) * 180) / Math.PI;
}

/**
 * First time after `t0` where the sun passes `elev` degrees at the pad: rising (morning golden hour over the
 * sea to the east — the default, framed backlit with the assembly building) or setting.
 */
export function findGoldenHour(u: Universe, site: LaunchSite, t0: number, elev = GOLDEN_ELEVATION, rising = true): number {
  const step = 120;
  const above = (t: number) => sunElevation(u, site, t) >= elev;
  let prev = above(t0);
  for (let t = t0 + step; t < t0 + 3 * 86400; t += step) {
    const cur = above(t);
    if (cur !== prev && cur === rising) {
      let a = t - step, b = t;
      for (let i = 0; i < 30; i++) {
        const m = (a + b) / 2;
        if (above(m) === rising) b = m;
        else a = m;
      }
      return (a + b) / 2;
    }
    prev = cur;
  }
  return t0;
}

/**
 * Live 3D backdrop for the Space Center: Earth (terrain + atmosphere), the Sun, starfield and the launch
 * complex at golden hour, seen from a slowly orbiting camera. Hovering the assembly building / pad highlights
 * them; clicking calls `onPick`.
 */
export class HubScene {
  private photo: PhotoCamera;
  private universe: Universe;
  private pipeline: RenderPipeline;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1e13);
  private stars: Starfield;
  private glare = new SunGlare();
  private sun = new THREE.DirectionalLight(0xffffff, 3.2);
  private ambient = new THREE.HemisphereLight(0x8899bb, 0x2a2016, 0.15);
  private planets: PlanetLayer;
  private site: LaunchSite;
  private vessel: { world: World; view: VesselView } | null = null;
  private t: number;
  private raf = 0;
  private last = performance.now();
  private elapsed = 0;
  private disposers: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer: THREE.Vector2 | null = null;
  private hovered: SiteObjectId | null = null;
  private warmColor = new THREE.Color(1.0, 0.68, 0.4);
  /** Camera pendulum phase (dev: ?hubPhase=<rad>). */
  private camPhase = 0;
  /** Dev: ?hubCam=az,dist,height,targetX,targetY,targetZ fixes the camera (local pad frame). */
  private devCam: number[] | null = null;

  constructor(private host: HTMLElement, private opts: HubSceneOptions) {
    const q = getQuality(opts.quality);
    this.universe = new Universe(opts.preset);
    this.pipeline = new RenderPipeline({ quality: q, toneMapping: 'aces', exposure: 1.3 });
    const canvas = this.pipeline.renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.appendChild(canvas);
    this.photo = new PhotoCamera(this.pipeline, this.scene, this.camera, () => this.vessel?.view.root.position.clone() ?? this.site.root.position.clone(), () => true, 2000);

    this.stars = new Starfield({ count: q.stars.count, milkyWay: q.stars.milkyWay, seed: 7 });
    this.scene.add(this.stars.group, this.glare.mesh);
    this.scene.add(this.sun, this.sun.target, this.ambient);
    if (q.shadowMapSize > 0) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(q.shadowMapSize * 2, q.shadowMapSize * 2);
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 0.05;
    }
    const pmrem = new THREE.PMREMGenerator(this.pipeline.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.planets = createPlanetLayer(this.scene, this.universe, opts.quality);
    this.site = new LaunchSite(this.universe, { vegetationDensity: q.siteVegetation });
    this.scene.add(this.site.root);
    this.t = findGoldenHour(this.universe, this.site, opts.ut);

    // Dev hook: ?hubCraft=<stock id> shows a stock craft on the pad.
    let craft = opts.craft;
    try {
      const id = new URLSearchParams(location.search).get('hubCraft');
      const sc = id ? STOCK_CRAFTS.find((c) => c.id === id) : undefined;
      if (sc) craft = sc.build();
      const ph = new URLSearchParams(location.search).get('hubPhase');
      if (ph) this.camPhase = +ph;
      const cam = new URLSearchParams(location.search).get('hubCam');
      if (cam) this.devCam = cam.split(',').map(Number);
    } catch {
      /* no location */
    }
    if (craft) {
      try {
        const world = new World(this.universe, PART_CATALOG, this.t);
        const wv = world.launch(craft);
        const view = new VesselView(wv.state);
        this.scene.add(view.root);
        this.vessel = { world, view };
      } catch (e) {
        console.warn('Hub: could not place craft on the pad', e);
        this.vessel = null;
      }
    }

    const onMove = (e: PointerEvent) => {
      if (this.isUi(e.target)) {
        this.pointer = null;
        return;
      }
      const r = host.getBoundingClientRect();
      this.pointer = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onClick = (e: MouseEvent) => {
      if (this.photo.active || this.isUi(e.target) || !this.hovered) return;
      this.opts.onPick?.(this.hovered);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClick);
    this.disposers.push(() => window.removeEventListener('pointermove', onMove), () => window.removeEventListener('click', onClick));

    if (import.meta.env?.DEV) (window as unknown as { __hub?: HubScene }).__hub = this;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  setCraft(craft: CraftDef | null) {
    if (this.vessel) {
      this.vessel.view.dispose();
      this.vessel = null;
    }
    if (!craft) return;
    const world = new World(this.universe, PART_CATALOG, this.t);
    const wv = world.launch(craft);
    const view = new VesselView(wv.state);
    this.scene.add(view.root);
    this.vessel = { world, view };
  }

  /** Debug: sun elevation/azimuth (deg, azimuth from north toward east) at the pad. */
  debugInfo() {
    const u = this.universe;
    const bs = u.ephem.getBodyState('earth', this.t).position;
    const rot = u.ephem.bodyRotation('earth', this.t);
    const origin = add(bs, qRotate(rot, this.site.padFixed));
    const sp = u.ephem.getBodyState(u.sunId, this.t).position;
    const sd = new THREE.Vector3(sp.x - origin.x, sp.y - origin.y, sp.z - origin.z).normalize();
    sd.applyQuaternion(this.site.root.quaternion.clone().invert());
    return { t: this.t, elev: (Math.asin(sd.y) * 180) / Math.PI, az: (Math.atan2(sd.x, -sd.z) * 180) / Math.PI, local: sd.toArray() };
  }

  setOnPick(fn: ((id: SiteObjectId) => void) | undefined) {
    this.opts.onPick = fn;
  }

  private isUi(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el?.closest?.('button, .panel, input, select, a');
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.photo.active) this.elapsed += dt;
    this.render(dt);
  };

  private render(dt: number) {
    const u = this.universe;
    const t = this.t;
    const bs = u.ephem.getBodyState('earth', t).position;
    const rot = u.ephem.bodyRotation('earth', t);
    const origin: Vec3 = add(bs, qRotate(rot, this.site.padFixed));
    const sunPos = u.ephem.getBodyState(u.sunId, t).position;
    this.site.update(origin, t);
    const frame = this.site.root.quaternion;

    // Cinematic camera: slow pendulum orbit on the west/south-west side of the pad, looking east into the
    // rising sun with the assembly building on the left; gentle breathing of distance and height.
    const az = 2.62 + 0.38 * Math.sin(this.elapsed * 0.018 + this.camPhase);
    const dist = 310 + 50 * Math.sin(this.elapsed * 0.045);
    const height = 26 + 10 * Math.sin(this.elapsed * 0.031 + 1);
    const local = new THREE.Vector3(Math.cos(az) * dist, height, Math.sin(az) * dist);
    const target = new THREE.Vector3(40, 30, -70);
    if (this.devCam) {
      const [a, d, h, tx, ty, tz] = this.devCam;
      local.set(Math.cos(a) * d, h, Math.sin(a) * d);
      target.set(tx, ty, tz);
    }
    if (!this.photo.active) {
    this.camera.position.copy(local).applyQuaternion(frame).add(this.site.root.position);
    this.camera.up.set(0, 1, 0).applyQuaternion(frame);
    this.camera.lookAt(target.applyQuaternion(frame).add(this.site.root.position));
    } else this.photo.update(dt);
    this.camera.near = 1;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    if (this.vessel) this.vessel.view.update(origin, this.elapsed, 101325, this.photo.active ? 0 : dt);

    // Sun light with a shadow frustum covering the pad area.
    const sd = new THREE.Vector3(sunPos.x - origin.x, sunPos.y - origin.y, sunPos.z - origin.z).normalize();
    const r = 190;
    this.sun.position.copy(sd).multiplyScalar(1500).add(this.site.root.position);
    this.sun.target.position.copy(this.site.root.position);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 3000;
    sc.updateProjectionMatrix();

    this.planets.update({ t, origin, camera: this.camera, sunPos, dt, focusBody: 'earth', viewportHeight: this.pipeline.drawingBufferHeight });
    const camSim = add(origin, { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z });
    const eclipse = this.planets.sunVisibility?.(camSim, sunPos) ?? 1;
    const tint = this.planets.sunTint?.(camSim, sunPos) ?? [1, 1, 1];
    const tmax = Math.max(1e-6, tint[0], tint[1], tint[2]);
    // Sun elevation at the pad drives an artistic golden-hour grade and the sky-fill strength.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame);
    const elev = Math.asin(THREE.MathUtils.clamp(up.dot(sd), -1, 1)) * THREE.MathUtils.RAD2DEG;
    const warm = 1 - THREE.MathUtils.smoothstep(elev, 4, 30);
    const day = THREE.MathUtils.smoothstep(elev, -6, 20);
    this.sun.color.setRGB(tint[0] / tmax, tint[1] / tmax, tint[2] / tmax).lerp(this.warmColor, warm * 0.6);
    this.sun.intensity = 6 * Math.min(1, eclipse * 1.6);
    this.ambient.color.setRGB(0.5, 0.6, 0.85);
    this.ambient.groundColor.setRGB(0.2, 0.15, 0.1);
    this.ambient.intensity = 0.05 + 0.15 * day;
    this.scene.environmentIntensity = 0.06 + 0.3 * day;
    this.stars.update(this.camera);
    this.glare.update(this.camera, sd, eclipse, tint);

    // Hover picking.
    let hit: SiteObjectId | null = null;
    if (this.pointer && !this.photo.active) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.site.pickables, false);
      hit = (hits[0]?.object.userData.siteId as SiteObjectId | undefined) ?? null;
    }
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.site.setHighlight(hit);
      this.host.style.cursor = hit ? 'pointer' : '';
      document.body.style.cursor = hit ? 'pointer' : '';
    }

    this.pipeline.render(this.scene, this.camera);
  }

  dispose() {
    this.photo.dispose();
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    document.body.style.cursor = '';
    this.vessel?.view.dispose();
    this.site.dispose();
    this.planets.dispose();
    this.pipeline.dispose();
    this.pipeline.renderer.domElement.remove();
  }
}
