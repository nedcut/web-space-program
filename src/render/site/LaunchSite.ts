import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../../sim/terrain/api';
import { latLonToUnit, LAUNCH_SITE, RUNWAY } from '../../sim/terrain';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { Vec3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import { terrainCutout } from '../planet/cutout';
import * as TX from './textures';
import { withAerialPerspective } from './aerial';
import { clearSiteShadow } from './shadows';
import { livePlanetUniforms } from '../planet/uniforms';
import { coastalTreeGeometry, smoothSphereNormals } from '../planet/scatter/geometry';
import { packBand } from './vegetationBands';
import { PadEquipment, CLAMP } from './padEquipment';
import { PadSteam } from './padSteam';
import type { VesselState } from '../../sim/vessel/runtime';
import { instancedVariant } from '../core/materialVariants';
import { paintSurface, SiteTextureArray, siteSurfaceUniforms, withSiteSurfaces, type SiteLayer, type SiteSurface, type SiteSurfaceUniforms } from './siteSurfaces';

/** What LaunchSite needs from the game Universe (structural, keeps render → game imports out). */
export interface SiteUniverse {
  body(id: string): { radius: number };
  terrain(id: string): Terrain;
  readonly ephem: Pick<Ephemeris, 'getBodyState' | 'bodyRotation'>;
}

export type SiteObjectId = 'pad' | 'vab';

/** Layout constants (local pad frame, metres: +X east, +Y up, +Z south). */
export const SITE_LAYOUT = {
  /** Pad deck rounded-square half size and corner radius (also the terrain cutout). */
  padHalf: 21,
  padCorner: 7,
  /** Flame hole half size (square, centred on the pad). */
  holeHalf: 5,
  /** Flame trench: runs from the hole toward −Z (north), open beyond the deck to `trenchEnd`. */
  trenchHalf: 5,
  trenchEnd: -62,
  trenchDepth: 11,
  /** Service tower centre and footprint half size. */
  tower: { x: -17, z: 0, half: 3, height: 45 },
  /** Assembly building centre (≈1.2 km from the pad). */
  vab: { x: 700, z: -980, w: 150, d: 110, h: 120 },
  apronRadius: 62,
} as const;

const HIDE_DISTANCE = 200e3;
const BODY = 'earth';

/** Cheap visibility test before allocating the launch complex's geometry and textures. */
export function launchSiteDistance(universe: SiteUniverse, origin: Vec3, t: number): number {
  const up = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
  const terrain = universe.terrain(BODY);
  const radius = universe.body(BODY).radius + Math.max(0, terrain.heightAt(up.x, up.y, up.z));
  const fixed = { x: up.x * radius, y: up.y * radius, z: up.z * radius };
  const offset = qRotate(universe.ephem.bodyRotation(BODY, t), fixed);
  const center = universe.ephem.getBodyState(BODY, t).position;
  return Math.hypot(center.x + offset.x - origin.x, center.y + offset.y - origin.y, center.z + offset.z - origin.z);
}


type Key =
  | 'sign' | 'concrete' | 'soot' | 'deck' | 'steel' | 'accent' | 'hazard' | 'grate' | 'white' | 'darkMetal' | 'cable'
  | 'cladding' | 'vabClad' | 'door' | 'windows' | 'apron' | 'crawler' | 'road' | 'roofDark' | 'lamp' | 'beacon' | 'runway'
  | 'logo' | 'flag' | 'runway09' | 'runway27';

interface BatchDef {
  /** Per-vertex look (texture layer, tint, roughness/metalness, emission); `deck` uses its own material. */
  surface: SiteSurface;
  /** Box-projected UV tile size in metres (u, v); null = keep geometry UVs. */
  tile: [number, number] | null;
  cast: boolean;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Rounded rectangle outline (CCW in the XZ plane seen from +Y), `n` points per corner arc. */
function roundedRect(hx: number, hz: number, r: number, n = 10): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [hx - r, -hz + r, -Math.PI / 2],
    [hx - r, hz - r, 0],
    [-hx + r, hz - r, Math.PI / 2],
    [-hx + r, -hz + r, Math.PI],
  ];
  // Increasing angle in the (x, z) plane, corner by corner.
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

function toNonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.index) return g;
  const n = g.toNonIndexed();
  g.dispose();
  return n;
}

/** Box-projected UVs from object-space position/normal. */
function projectUV(g: THREE.BufferGeometry, tu: number, tv: number) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = -p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i) * -Math.sign(n.getX(i)); v = p.getY(i); }
    else { u = p.getX(i) * Math.sign(n.getZ(i)); v = p.getY(i); }
    uv[i * 2] = u / tu;
    uv[i * 2 + 1] = v / tv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Square-section beam between two points. */
function strut(a: THREE.Vector3, b: THREE.Vector3, s: number, s2 = s): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(s, len, s2);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Box spanning y0..y1 (centre x,z). */
function boxY(w: number, d: number, x: number, z: number, y0: number, y1: number): THREE.BufferGeometry {
  return box(w, y1 - y0, d, x, (y0 + y1) / 2, z);
}

/** Single quad (two triangles) from 4 corners in CCW order (as seen from the front). */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = [a, b, c, a, c, d].flatMap((p) => [p.x, p.y, p.z]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Procedural launch complex on Earth at LAUNCH_SITE: pad with flame trench and deflector, lattice service
 * tower with umbilical arms, lightning masts, water tower, propellant tanks, support buildings, roads, a huge
 * assembly building ≈1.2 km away, tracking dish and perimeter lights.
 *
 * Geometry is built once in a local tangent frame at the pad (metres, float32-safe) and merged per material
 * (≈25 draw calls). Each frame `update()` places the root with the floating origin and the body rotation, and
 * drives the terrain cutout so the pad deck / trench replace the terrain surface exactly.
 */
export interface LaunchSiteOptions {
  /** Fraction of scrub/pine instances to keep (quality presets thin vegetation on Low). Default 1. */
  vegetationDensity?: number;
  /** Steam puffs in the pad's deluge cloud (0 = none). Default 96. */
  steamParticles?: number;
}

/** The active vessel, for the pad equipment and the deluge steam (flight only). */
export interface PadVessel {
  state: VesselState;
  /** Held by the hold-down clamps (prelaunch). */
  held: boolean;
  /** The launch stage has fired (engines spooling against the clamps, or flying). */
  firing: boolean;
}

export class LaunchSite {
  readonly root = new THREE.Group();
  /** Invisible pick volumes (userData.siteId: SiteObjectId) for hub interaction. */
  readonly pickables: THREE.Object3D[] = [];
  /** Body-fixed pad surface point (deck top), metres. Matches World.launch. */
  readonly padFixed: Vec3;
  private readonly qLocal = new THREE.Quaternion();
  private readonly R0: number;
  private readonly E: Vec3;
  private readonly U: Vec3;
  private readonly S: Vec3;
  private readonly terrain: Terrain;
  private batches = new Map<Key, BatchDef>();
  /** Geometry awaiting `flush`: shadow casters, ground-hugging non-casters, and the pad deck. */
  private pendingGeos = { cast: [] as THREE.BufferGeometry[], ground: [] as THREE.BufferGeometry[], deck: [] as THREE.BufferGeometry[] };
  private surfaceTextures: SiteTextureArray | null = null;
  private surfaceUniforms: SiteSurfaceUniforms | null = null;
  /** The merged site material (also used by the animated dish and pad equipment). */
  private siteMat: THREE.MeshStandardMaterial | null = null;
  private deckMat: THREE.Material | null = null;
  private disposables: { dispose(): void }[] = [];
  private dish: THREE.Group | null = null;
  private readonly planetUniforms = livePlanetUniforms(BODY);
  private readonly sunUp = new THREE.Vector3();
  private night = { value: 0 };
  /**
   * Per cell: all instances (root-local matrices/colours/positions) and one mesh per detail level whose instance
   * buffer holds only the instances inside that level's distance band (rewritten when the camera moves ≥ 20 m).
   */
  private vegetationLods: { levels: { mesh: THREE.InstancedMesh; min: number; max: number }[]; matrices: Float32Array; colors: Float32Array; xyz: Float32Array }[] = [];
  private readonly vegCamera = new THREE.Vector3(Infinity, 0, 0);
  private readonly lodCenter = new THREE.Vector3();
  private wind = { value: 0 };
  private highlightRing: THREE.Mesh | null = null;
  private equipment: PadEquipment | null = null;
  private steam: PadSteam | null = null;
  private steamT = NaN;
  private readonly vesselLocal = new THREE.Vector3();
  private highlighted: SiteObjectId | null = null;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  constructor(private universe: SiteUniverse, private options: LaunchSiteOptions = {}) {
    this.root.name = 'launchSite';
    this.root.matrixAutoUpdate = true;
    const body = universe.body(BODY);
    this.terrain = universe.terrain(BODY);
    const up = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
    const h0 = Math.max(0, this.terrain.heightAt(up.x, up.y, up.z));
    this.R0 = body.radius + h0;
    this.U = { x: up.x, y: up.y, z: up.z };
    // Same basis as World.launch: +X east, +Y up, +Z = X × Y (south).
    const el = Math.hypot(up.x, up.y);
    this.E = { x: -up.y / el, y: up.x / el, z: 0 };
    const E = this.E, U = this.U;
    this.S = { x: E.y * U.z - E.z * U.y, y: E.z * U.x - E.x * U.z, z: E.x * U.y - E.y * U.x };
    this.padFixed = { x: up.x * this.R0, y: up.y * this.R0, z: up.z * this.R0 };
    const m = new THREE.Matrix4().makeBasis(V(E.x, E.y, E.z), V(U.x, U.y, U.z), V(this.S.x, this.S.y, this.S.z));
    this.qLocal.setFromRotationMatrix(m);

    if (typeof document === 'undefined') return; // headless: no textures/canvas
    this.createBatches();
    this.buildPad();
    this.buildTower();
    this.buildMastsAndTanks();
    this.buildBuildings();
    this.buildVab();
    this.buildRoads();
    this.buildRunway();
    this.buildDish();
    this.buildLights();
    this.buildVegetation();
    this.buildPickables();
    this.flush();
    this.buildPadEquipment();
    // Mesh-local transforms are immutable; the dish animates its parent group. Avoid composing
    // hundreds of unchanged local matrices on every frame (world transforms still follow Earth).
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) { o.updateMatrix(); o.matrixAutoUpdate = false; }
    });
  }

  // ------------------------------------------------------------------ terrain queries

  /** Ground height (local Y, m) under local (x, z): curvature + terrain, relative to the pad deck. */
  groundY(x: number, z: number): number {
    const { E, S, U, R0 } = this;
    const px = U.x * R0 + E.x * x + S.x * z;
    const py = U.y * R0 + E.y * x + S.y * z;
    const pz = U.z * R0 + E.z * x + S.z * z;
    const l = Math.hypot(px, py, pz);
    const dx = px / l, dy = py / l, dz = pz / l;
    let h = this.terrain.heightAt(dx, dy, dz);
    if (this.terrain.ocean) h = Math.max(0, h);
    const r = this.universe.body(BODY).radius + h;
    return (dx * r - U.x * R0) * U.x + (dy * r - U.y * R0) * U.y + (dz * r - U.z * R0) * U.z;
  }

  /**
   * Object frame on the ground at (x, z) with heading `yaw` (rotation about +Y; object +Z faces
   * (sin yaw, cos yaw)). Base height = max of ground samples over the footprint; Y = local vertical.
   */
  frameAt(x: number, z: number, yaw = 0, hx = 0, hz = 0): THREE.Matrix4 {
    if (hx > 0 || hz > 0) this.keepCircles.push([x, z, Math.hypot(hx, hz) + 6]);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let base = -Infinity;
    for (const [fx, fz] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lx = fx * hx, lz = fz * hz;
      base = Math.max(base, this.groundY(x + c * lx + s * lz, z - s * lx + c * lz));
    }
    const up = V(x, base + this.R0, z).normalize();
    const X = V(c, 0, -s);
    X.addScaledVector(up, -X.dot(up)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, up);
    return new THREE.Matrix4().makeBasis(X, up, Z).setPosition(x, base, z);
  }

  // ------------------------------------------------------------------ batching

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private createBatches() {
    const t = <T extends THREE.Texture>(x: T) => this.track(x);
    const std = (p: THREE.MeshStandardMaterialParameters) => {
      const mat = withAerialPerspective(new THREE.MeshStandardMaterial(p), BODY);
      const aerial = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        aerial(shader, renderer);
        shader.uniforms.uSiteNight = this.night;
        shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform float uSiteNight;\nvoid main() {');
        // A bounded warm work-light wash on the pad: no dynamic lights or extra shadow passes.
        shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying vec3 vSiteLocal;\nvoid main() {')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvSiteLocal = transformed;\n#ifdef USE_INSTANCING\nvSiteLocal = (instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
        shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'varying vec3 vSiteLocal;\nvoid main() {')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float pool = exp(-dot(vSiteLocal.xz, vSiteLocal.xz) / 3400.0);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.65, 0.43, 0.22) * pool * uSiteNight * 0.8;`);
      };
      mat.customProgramCacheKey = () => 'site-worklight-v1';
      return this.track(mat);
    };
    const canvas = (x: THREE.Texture) => { this.track(x); return x.image as HTMLCanvasElement; };
    const layers: Record<SiteLayer, HTMLCanvasElement> = {
      concrete: canvas(TX.concreteTexture(3)),
      apron: canvas(TX.concreteTexture(9, '#a6a39b')),
      soot: canvas(TX.sootTexture()),
      cladding: canvas(TX.claddingTexture()),
      door: canvas(TX.vabDoorTexture()),
      windows: canvas(TX.windowsTexture()),
      windowLight: canvas(TX.windowLightTexture()),
      crawler: canvas(TX.roadTexture(true)),
      road: canvas(TX.roadTexture(false)),
      runway: canvas(TX.runwayTexture()),
      signs: canvas(TX.facilitySignsTexture()),
      logo: canvas(TX.logoTexture()),
      flag: canvas(TX.flagTexture()),
      runway09: canvas(TX.runwayEndTexture('09')),
      runway27: canvas(TX.runwayEndTexture('27')),
      grating: canvas(TX.gratingTexture()),
    };
    this.surfaceTextures = this.track(new SiteTextureArray(layers));
    this.surfaceUniforms = siteSurfaceUniforms(this.surfaceTextures.texture);
    this.siteMat = withSiteSurfaces(std({ color: 0xffffff, roughness: 1, metalness: 1 }), this.surfaceUniforms);
    this.deckMat = std({ map: t(TX.padDeckTexture(SITE_LAYOUT.holeHalf, SITE_LAYOUT.trenchHalf)), color: 0xc4c2bc, roughness: 0.85, metalness: 0 });
    const def = (layer: SiteLayer | null, color: number, roughness: number, metalness: number, tile: [number, number] | null, cast = true, extra: Partial<SiteSurface> = {}): BatchDef =>
      ({ surface: { layer, color, roughness, metalness, ...extra }, tile, cast });
    const B: Record<Key, BatchDef> = {
      sign: def('signs', 0xffffff, 0.75, 0, null, false),
      concrete: def('concrete', 0xbdb9b1, 0.88, 0, [8, 8]),
      soot: def('soot', 0xffffff, 0.95, 0, [8, 8], false),
      deck: def(null, 0xffffff, 1, 0, null, false),
      steel: def(null, 0x8f969d, 0.5, 0.75, null),
      accent: def(null, 0x1f5f8a, 0.5, 0.45, null),
      hazard: def(null, 0xd9a72a, 0.55, 0.2, null),
      grate: def('grating', 0xffffff, 0.75, 0.6, [2, 2]),
      white: def(null, 0xe4e4df, 0.62, 0.05, null),
      darkMetal: def(null, 0x4a4643, 0.62, 0.6, null, false),
      cable: def(null, 0x2a2b2e, 0.6, 0.4, null, false),
      cladding: def('cladding', 0xe1ddd0, 0.76, 0.12, [4, 8]),
      vabClad: def('cladding', 0xe1ddd0, 0.76, 0.12, [4, 8], true, { vab: true }),
      door: def('door', 0xffffff, 0.5, 0.5, null, true, { vab: true }),
      windows: def('windows', 0xffffff, 0.4, 0.2, [12, 4], true, { emissive: 1 }),
      apron: def('apron', 0xb4b2ac, 0.9, 0, [8, 8], false),
      crawler: def('crawler', 0xffffff, 0.92, 0, null, false),
      road: def('road', 0xffffff, 0.85, 0, null, false),
      roofDark: def('apron', 0x5d6066, 0.9, 0.1, [6, 6]),
      lamp: def(null, 0x202020, 0.6, 0, null, false, { emissive: 2 }),
      beacon: def(null, 0x200404, 0.6, 0, null, false, { emissive: 3 }),
      runway: def('runway', 0xffffff, 0.9, 0, null, false),
      logo: def('logo', 0xffffff, 0.7, 0.1, null, false, { vab: true }),
      flag: def('flag', 0xffffff, 0.7, 0.1, null, false, { vab: true }),
      runway09: def('runway09', 0xffffff, 0.85, 0, null, false),
      runway27: def('runway27', 0xffffff, 0.85, 0, null, false),
    };
    for (const k of Object.keys(B) as Key[]) this.batches.set(k, B[k]);
  }

  /**
   * Add geometry (object space) to a batch, optionally transformed by `m` (object → local pad frame). `ao` darkens
   * vertices near the object's base (object-space y below ~3.5 m) by up to that fraction: ground contact and
   * splash grime on walls, baked into the vertex tint.
   */
  private add(key: Key, g: THREE.BufferGeometry, m?: THREE.Matrix4, ao = 0) {
    const b = this.batches.get(key)!;
    let geo = toNonIndexed(g);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (b.tile) projectUV(geo, b.tile[0], b.tile[1]);
    else if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    // Keep only the attributes every batch member shares.
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    geo.clearGroups();
    let shade: Float32Array | null = null;
    if (ao > 0) {
      const p = geo.getAttribute('position');
      shade = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) shade[i] = 1 - ao * (1 - THREE.MathUtils.smoothstep(p.getY(i), -0.5, 3.5));
    }
    if (m) geo = geo.applyMatrix4(m);
    if (key === 'deck') { this.pendingGeos.deck.push(geo); return; }
    paintSurface(geo, b.surface);
    if (shade) {
      const c = geo.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * shade[i], c.getY(i) * shade[i], c.getZ(i) * shade[i]);
    }
    (b.cast ? this.pendingGeos.cast : this.pendingGeos.ground).push(geo);
  }

  private addAll(key: Key, gs: THREE.BufferGeometry[], m?: THREE.Matrix4) {
    for (const g of gs) this.add(key, g, m);
  }

  /** Surface attributes for geometry that is drawn with the site material outside the static batches. */
  private painted(key: Key, g: THREE.BufferGeometry): THREE.BufferGeometry {
    const geo = toNonIndexed(g);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    paintSurface(geo, this.batches.get(key)!.surface);
    return geo;
  }

  private flush() {
    const fill = (renderer: THREE.WebGLRenderer) => this.surfaceTextures?.fill(renderer);
    for (const [name, list, mat, cast] of [
      ['main', this.pendingGeos.cast, this.siteMat!, true],
      ['ground', this.pendingGeos.ground, this.siteMat!, false],
      ['deck', this.pendingGeos.deck, this.deckMat!, false],
    ] as const) {
      if (!list.length) continue;
      const merged = this.track(mergeGeometries(list, false)!);
      list.forEach((g) => g.dispose());
      list.length = 0;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `site:${name}`;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      // The layered texture is filled from the canvases on first draw (it needs the renderer).
      if (mat === this.siteMat) mesh.onBeforeRender = fill;
      this.root.add(mesh);
    }
  }

  // ------------------------------------------------------------------ pad, trench, deflector

  private buildPad() {
    const L = SITE_LAYOUT;
    const H = L.holeHalf, T = L.trenchHalf, D = -L.trenchDepth;
    // Deck top (y = 0, flush with the terrain at the pad centre) with the flame hole.
    const shape = new THREE.Shape();
    // Shape coordinates: (x, ys) with ys = −z (rotateX(−π/2) maps (x, ys, 0) → (x, 0, −ys)).
    const outline = roundedRect(L.padHalf + 0.3, L.padHalf + 0.3, L.padCorner + 0.3, 12);
    outline.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    const hole = new THREE.Path();
    hole.moveTo(-H, -H); hole.lineTo(-H, H); hole.lineTo(H, H); hole.lineTo(H, -H); hole.closePath();
    shape.holes.push(hole);
    const deck = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
    {
      const p = deck.getAttribute('position');
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uv[i * 2] = p.getX(i) / 48 + 0.5;
        uv[i * 2 + 1] = 0.5 - p.getZ(i) / 48;
      }
      deck.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      deck.computeVertexNormals();
    }
    this.add('deck', deck);

    // Raised curb around the deck edge: hides the terrain cutout boundary and gives the pad a crisp edge.
    const inner = roundedRect(L.padHalf - 0.6, L.padHalf - 0.6, L.padCorner - 0.6, 12);
    const outer = roundedRect(L.padHalf + 0.6, L.padHalf + 0.6, L.padCorner + 0.6, 12);
    const top = 0.22, bot = -0.6;
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      const a = inner[i], b = inner[j], c = outer[j], d = outer[i];
      // Orientation: the outline walks clockwise in (x,z) as seen from +Y... compute normals and fix winding.
      this.add('concrete', this.facing(V(a[0], top, a[1]), V(b[0], top, b[1]), V(c[0], top, c[1]), V(d[0], top, d[1]), V(0, 1, 0)));
      this.add('concrete', this.facing(V(d[0], bot, d[1]), V(c[0], bot, c[1]), V(c[0], top, c[1]), V(d[0], top, d[1]), V(d[0], 0, d[1])));
      this.add('concrete', this.facing(V(a[0], bot, a[1]), V(b[0], bot, b[1]), V(b[0], top, b[1]), V(a[0], top, a[1]), V(-a[0], 0, -a[1])));
    }
    // Hazard paint strip on the inner curb face top.
    for (let i = 0; i < inner.length; i += 2) {
      const j = (i + 1) % inner.length;
      // 1.5 cm proud of the curb face (coplanar paint z-fights).
      const ka = 1 - 0.015 / Math.hypot(inner[i][0], inner[i][1]), kb = 1 - 0.015 / Math.hypot(inner[j][0], inner[j][1]);
      const a = [inner[i][0] * ka, inner[i][1] * ka], b = [inner[j][0] * kb, inner[j][1] * kb];
      this.add('hazard', this.facing(V(a[0], 0.0, a[1]), V(b[0], 0.0, b[1]), V(b[0], top + 0.005, b[1]), V(a[0], top + 0.005, a[1]), V(-a[0], 0, -a[1])));
    }

    // Flame trench (soot concrete). Floor: flat under the deflector, then a ramp up to the exit.
    const zS = H, zN = L.trenchEnd, zRamp = -8, zDeck = -L.padHalf;
    const floorAt = (z: number) => (z > zRamp ? D : D + ((zRamp - z) / (zRamp - zN)) * 8);
    const up = V(0, 1, 0);
    this.add('soot', this.facing(V(-T, D, zS), V(T, D, zS), V(T, D, zRamp), V(-T, D, zRamp), up));
    this.add('soot', this.facing(V(-T, D, zRamp), V(T, D, zRamp), V(T, floorAt(zN), zN), V(-T, floorAt(zN), zN), up));
    // Side walls: segments with different tops (hole: 0, under deck: −1.5, open: up to the coping, whose inner
    // face continues the wall; overlapping it drew z-fighting stripes along the trench).
    const COPING_BOTTOM = -0.6;
    const segs: [number, number, number][] = [
      [zS, -H, 0],
      [-H, zDeck, -1.5],
      [zDeck, zN, COPING_BOTTOM],
    ];
    for (const sx of [-1, 1]) {
      for (const [z0, z1, yt] of segs) {
        const steps = 6;
        for (let k = 0; k < steps; k++) {
          const za = z0 + ((z1 - z0) * k) / steps, zb = z0 + ((z1 - z0) * (k + 1)) / steps;
          this.add('soot', this.facing(V(sx * T, floorAt(za), za), V(sx * T, floorAt(zb), zb), V(sx * T, yt, zb), V(sx * T, yt, za), V(-sx, 0, 0)));
        }
      }
    }
    // Ceiling under the deck, hole north lintel face, south end wall, exit end wall.
    this.add('soot', this.facing(V(-T, -1.5, -H), V(T, -1.5, -H), V(T, -1.5, zDeck), V(-T, -1.5, zDeck), V(0, -1, 0)));
    this.add('soot', this.facing(V(-T, -1.5, -H), V(T, -1.5, -H), V(T, 0, -H), V(-T, 0, -H), V(0, 0, 1)));
    this.add('soot', this.facing(V(-T, D, zS), V(T, D, zS), V(T, 0, zS), V(-T, 0, zS), V(0, 0, -1)));
    this.add('soot', this.facing(V(-T, floorAt(zN), zN), V(T, floorAt(zN), zN), V(T, COPING_BOTTOM, zN), V(-T, COPING_BOTTOM, zN), V(0, 0, 1)));
    // Lintel at the deck edge over the trench mouth (hangs just below the ceiling so the two never coincide).
    this.add('concrete', boxY(2 * T + 0.2, 1.2, 0, zDeck - 0.1, -1.56, 0.21));
    // Coping along the open trench (covers the cutout boundary).
    const cz0 = zDeck - 0.4, cz1 = zN - 2.2;
    for (const sx of [-1, 1]) this.add('concrete', boxY(2.2, cz0 - cz1, sx * (T + 1.1), (cz0 + cz1) / 2, COPING_BOTTOM, 0.15));
    this.add('concrete', boxY(2 * T + 4.4, 2.2, 0, zN - 1.1, COPING_BOTTOM, 0.15));
    // Guard rails along the open trench.
    for (const sx of [-1, 1]) {
      const x = sx * (T + 1.6);
      this.add('hazard', box(0.08, 0.08, cz0 - cz1, x, 1.15, (cz0 + cz1) / 2));
      this.add('hazard', box(0.06, 0.06, cz0 - cz1, x, 0.65, (cz0 + cz1) / 2));
      for (let z = cz0; z >= cz1; z -= 2.5) this.add('hazard', box(0.07, 1.0, 0.07, x, 0.65, z));
    }

    // Flame deflector: concave steel ramp under the hole turning the exhaust north (−Z).
    const ds = new THREE.Shape();
    // Shape (X_s = −z, Y_s = y), extruded along +X.
    ds.moveTo(-H, -1.6);
    ds.quadraticCurveTo(-H + 1.0, D + 1.0, H + 3, D + 0.05);
    ds.lineTo(-H, D + 0.05);
    ds.closePath();
    const dg = new THREE.ExtrudeGeometry(ds, { depth: 2 * T - 0.1, bevelEnabled: false, curveSegments: 16 });
    const dm = new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)).setPosition(-T + 0.05, 0, 0);
    this.add('darkMetal', dg, dm);
    // Water deluge pipes along the hole rim.
    for (const sx of [-1, 1]) this.add('steel', new THREE.CylinderGeometry(0.18, 0.18, 2 * H, 8).rotateX(Math.PI / 2).translate(sx * (H - 0.3), -0.45, 0));

    // Hold-down clamp pedestals at the hole corners (the clamp arms are `PadEquipment`): base plate, column,
    // hinge yoke and an actuator housing on the outboard face.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * CLAMP.corner, z = sz * CLAMP.corner, hy = CLAMP.hingeY;
      this.add('accent', boxY(2.2, 2.2, x, z, 0, 0.22));
      this.add('steel', boxY(1.3, 1.3, x + sx * 0.35, z + sz * 0.35, 0.22, hy - 0.35));
      for (const s of [-1, 1]) {
        // Yoke cheeks either side of the arm's hinge drum (the arm swings in the pedestal's diagonal plane).
        const ox = -sz * s * 0.75 / Math.SQRT2, oz = sx * s * 0.75 / Math.SQRT2;
        this.add('steel', boxY(0.35, 0.35, x + ox, z + oz, hy - 0.5, hy + 0.55));
      }
      this.add('darkMetal', boxY(0.7, 0.7, x + sx * 0.95, z + sz * 0.95, 0.22, 1.6));
      this.add('hazard', boxY(1.36, 1.36, x + sx * 0.35, z + sz * 0.35, hy - 0.62, hy - 0.4));
    }
    // Ground-level cable trays / service boxes on the deck (west side, toward the tower).
    this.add('grate', boxY(6, 1.2, -10.5, 4.5, 0, 0.5));
    this.add('steel', boxY(1.4, 1.0, -12.5, -4.5, 0, 1.6));
    this.add('steel', boxY(1.4, 1.0, -12.5, -6.2, 0, 1.6));
    this.add('accent', boxY(1.8, 1.2, -9.0, -8.0, 0, 1.0));
    // Exit apron at the trench end (blast-scoured concrete fan beyond the end wall).
    this.groundShape('soot', [[-9, zN - 2.2], [9, zN - 2.2], [16, zN - 22], [-16, zN - 22]], 0.06);
  }

  /** Quad with winding chosen so its normal points along `dir` (horizontal components only matter for walls). */
  private facing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, dir: THREE.Vector3): THREE.BufferGeometry {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    return n.dot(dir) >= 0 ? quad(a, b, c, d) : quad(d, c, b, a);
  }

  /** Flat polygon on the ground (local x,z points), `off` metres above the terrain, with box-projected UVs. */
  private groundShape(key: Key, pts: [number, number][], off: number, holes: [number, number][][] = []) {
    {
      let cx = 0, cz = 0;
      for (const [x, z] of pts) { cx += x / pts.length; cz += z / pts.length; }
      let r = 0;
      for (const [x, z] of pts) r = Math.max(r, Math.hypot(x - cx, z - cz));
      this.keepCircles.push([cx, cz, r + 6]);
    }
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2);
    // Drape onto the curved ground.
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, this.groundY(p.getX(i), p.getZ(i)) + off);
    g.computeVertexNormals();
    // ShapeGeometry winding depends on the outline orientation; make sure it faces up.
    const n = g.getAttribute('normal');
    if (n.count && n.getY(0) < 0) {
      const idx = g.index!;
      for (let i = 0; i < idx.count; i += 3) {
        const t = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, t);
      }
      g.computeVertexNormals();
    }
    this.add(key, g);
  }

  // ------------------------------------------------------------------ service tower

  private buildTower() {
    const { x: tx, z: tz, half: h, height: H } = SITE_LAYOUT.tower;
    const steel: THREE.BufferGeometry[] = [];
    const accent: THREE.BufferGeometry[] = [];
    const grate: THREE.BufferGeometry[] = [];
    const hazard: THREE.BufferGeometry[] = [];
    // Plinth
    this.add('concrete', boxY(2 * h + 1.6, 2 * h + 1.6, tx, tz, 0, 0.5));
    const corners: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (const [cx, cz] of corners) steel.push(boxY(0.55, 0.55, tx + cx, tz + cz, 0.5, H));
    const bay = 3;
    for (let y = 0.5; y < H - 0.1; y += bay) {
      const y1 = Math.min(H, y + bay);
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
        const A0 = V(tx + ax, y, tz + az), B0 = V(tx + bx, y, tz + bz);
        const A1 = V(tx + ax, y1, tz + az), B1 = V(tx + bx, y1, tz + bz);
        steel.push(strut(A1, B1, 0.3));
        steel.push(strut(A0, B1, 0.18));
        steel.push(strut(B0, A1, 0.18));
      }
    }
    // Platforms every 9 m with handrails.
    for (let y = 9.5; y < H; y += 9) {
      this.add('lamp', box(1.8, 0.12, 0.25, tx + h + 0.6, y + 2.4, tz));
      const w = 2 * h + 2.4;
      grate.push(boxY(w, w, tx, tz, y - 0.25, y));
      const r = w / 2 - 0.1;
      for (const [ax, az, bx, bz] of [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]]) {
        hazard.push(strut(V(tx + ax, y + 1.1, tz + az), V(tx + bx, y + 1.1, tz + bz), 0.07));
        hazard.push(strut(V(tx + ax, y + 0.55, tz + az), V(tx + bx, y + 0.55, tz + bz), 0.05));
      }
      for (const [ax, az] of [[-r, -r], [r, -r], [r, r], [-r, r]]) hazard.push(boxY(0.07, 0.07, tx + ax, tz + az, y, y + 1.1));
    }
    // Elevator shaft (west side, clad) and top machine room.
    this.add('cladding', boxY(2.2, 2.6, tx - h - 1.3, tz, 0.5, H + 2.5));
    accent.push(boxY(2 * h + 1.2, 2 * h + 1.2, tx, tz, H, H + 3));
    for (let y = 9.5; y < H; y += 9) accent.push(boxY(2.4, 2.8, tx - h - 1.3, tz, y - 0.3, y + 0.3));
    steel.push(boxY(2 * h + 1.6, 2 * h + 1.6, tx, tz, H + 3, H + 3.4));
    // Lightning rod on top.
    steel.push(new THREE.CylinderGeometry(0.08, 0.2, 10, 6).translate(tx, H + 8.4, tz));

    // Swing-arm hinge brackets on the tower face (the arms themselves are `PadEquipment`).
    for (const y of [8.5, 20, 33]) {
      steel.push(box(0.5, 3.4, 1.6, tx + h + 0.25, y, tz));
      accent.push(box(0.6, 0.3, 2.0, tx + h + 0.3, y + 1.6, tz));
      accent.push(box(0.6, 0.3, 2.0, tx + h + 0.3, y - 1.6, tz));
    }
    this.addAll('steel', steel);
    this.addAll('accent', accent);
    this.addAll('grate', grate);
    this.addAll('hazard', hazard);
  }

  // ------------------------------------------------------------------ masts, water tower, tanks, pipes

  private buildMastsAndTanks() {
    const mastH = 70;
    const masts: [number, number][] = [30, 150, 250].map((a) => {
      const r = (a * Math.PI) / 180;
      return [48 * Math.cos(r), 48 * Math.sin(r)];
    });
    const tops: THREE.Vector3[] = [];
    for (const [x, z] of masts) {
      const m = this.frameAt(x, z, 0, 2.5, 2.5);
      this.add('concrete', boxY(5, 5, 0, 0, -1.5, 1.2), m);
      this.add('steel', new THREE.CylinderGeometry(0.35, 0.9, mastH, 10).translate(0, 1.2 + mastH / 2, 0), m);
      this.add('steel', new THREE.CylinderGeometry(0.05, 0.12, 6, 5).translate(0, 1.2 + mastH + 3, 0), m);
      this.add('white', new THREE.CylinderGeometry(0.95, 0.95, 4, 10).translate(0, 1.2 + mastH - 6, 0), m);
      const top = V(0, 1.2 + mastH, 0).applyMatrix4(m);
      tops.push(top);
      this.add('beacon', new THREE.SphereGeometry(0.3, 8, 6).translate(0, 1.2 + mastH + 0.4, 0), m);
    }
    // Catenary wires between the mast tops and down to ground anchors.
    const wire = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        pts.push(a.clone().lerp(b, t).add(V(0, -sag * 4 * t * (1 - t), 0)));
      }
      this.add('cable', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.09, 4, false));
    };
    for (let i = 0; i < 3; i++) wire(tops[i], tops[(i + 1) % 3], 9);
    for (let i = 0; i < 3; i++) {
      const [x, z] = masts[i];
      const d = Math.hypot(x, z);
      for (const da of [-0.35, 0.35]) {
        const a = Math.atan2(z, x) + da;
        const ax = Math.cos(a) * (d + 40), az = Math.sin(a) * (d + 40);
        const gy = this.groundY(ax, az);
        this.add('concrete', boxY(1.4, 1.4, ax, az, gy - 1, gy + 0.6));
        wire(tops[i], V(ax, gy + 0.5, az), 2);
      }
    }

    // Water tower (sound-suppression deluge supply).
    {
      const m = this.frameAt(78, 58, 0.3, 9, 9);
      const legs = 6, Rl = 6.5, Hl = 30;
      for (let i = 0; i < legs; i++) {
        const a = (i / legs) * Math.PI * 2;
        const bx = Math.cos(a) * Rl, bz = Math.sin(a) * Rl;
        this.add('steel', strut(V(bx * 1.15, 0, bz * 1.15), V(bx * 0.8, Hl + 2, bz * 0.8), 0.6), m);
        this.add('concrete', boxY(1.8, 1.8, bx * 1.15, bz * 1.15, -1.5, 0.5), m);
        const a2 = ((i + 1) / legs) * Math.PI * 2;
        for (const y of [10, 20]) {
          const s = 1.15 - (0.35 * y) / (Hl + 2);
          this.add('steel', strut(V(bx * s, y, bz * s), V(Math.cos(a2) * Rl * s, y, Math.sin(a2) * Rl * s), 0.25), m);
        }
      }
      this.add('steel', new THREE.CylinderGeometry(0.9, 0.9, Hl + 4, 10).translate(0, (Hl + 4) / 2, 0), m);
      this.add('white', new THREE.SphereGeometry(8.5, 28, 16).translate(0, Hl + 8, 0), m);
      this.add('accent', new THREE.CylinderGeometry(8.62, 8.62, 2.2, 28, 1, true).translate(0, Hl + 8, 0), m);
      this.add('steel', new THREE.CylinderGeometry(9.2, 9.2, 0.3, 28).translate(0, Hl + 3.6, 0), m);
      this.add('beacon', new THREE.SphereGeometry(0.35, 8, 6).translate(0, Hl + 16.7, 0), m);
    }
    // Pipe from the water tower to the pad.
    this.pipe([[72, 52], [52, 38]], 0.7, 1.2);

    // Cryogenic propellant spheres + gas bottle farm.
    for (const [x, z, r] of [[-82, 62, 8], [96, -74, 7]] as const) {
      const m = this.frameAt(x, z, 0, r, r);
      this.add('concrete', new THREE.CylinderGeometry(r * 0.75, r * 0.85, 2, 20).translate(0, -0.5, 0), m);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.add('steel', boxY(0.7, 0.7, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, 0.5, r + 1.2), m);
      }
      this.add('white', new THREE.SphereGeometry(r, 28, 18).translate(0, r + 2.4, 0), m);
      this.add('steel', new THREE.CylinderGeometry(r * 0.25, r * 0.25, 1.2, 12).translate(0, 2 * r + 2.8, 0), m);
      // Access stair tower
      this.add('grate', boxY(2.2, 2.2, r + 1.6, 0, 0, 2 * r + 2.5), m);
      this.add('hazard', boxY(2.4, 2.4, r + 1.6, 0, 2 * r + 2.5, 2 * r + 3.6), m);
    }
    this.pipe([[-76, 56], [-52, 38]], 0.45, 0.9);
    this.pipe([[90, -68], [54, -40]], 0.45, 0.9);
    {
      const m = this.frameAt(-62, 100, 0.2, 10, 10);
      this.add('concrete', boxY(18, 22, 0, 0, -1.5, 0.25), m);
      for (let i = 0; i < 6; i++) {
        const z = -8 + i * 3.2;
        this.add('white', new THREE.CylinderGeometry(1.2, 1.2, 14, 14).rotateZ(Math.PI / 2).translate(0, 2.4, z), m);
        for (const x of [-5, 5]) this.add('steel', boxY(0.6, 2.6, x, z, 0.25, 1.6), m);
      }
    }
  }

  /** Ground pipeline on short supports along a polyline (local x,z). */
  private pipe(pts: [number, number][], r: number, h: number) {
    // Valve pit where the line dives underground toward the pad.
    const [ex, ez] = pts[pts.length - 1];
    const ey = this.groundY(ex, ez);
    this.add('concrete', boxY(2.6, 2.6, ex, ez, ey - 0.5, ey + h + r + 0.4));
    this.add('hazard', boxY(0.9, 0.9, ex, ez, ey + h + r + 0.4, ey + h + r + 0.9));
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const a = V(ax, this.groundY(ax, az) + h, az), b = V(bx, this.groundY(bx, bz) + h, bz);
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(r, r, len, 10);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      this.add('steel', g.translate(mid.x, mid.y, mid.z));
      const n = Math.max(1, Math.floor(len / 8));
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        const gy = this.groundY(p.x, p.z);
        this.add('concrete', boxY(0.5, r * 2 + 0.6, p.x, p.z, gy - 0.5, p.y - r));
      }
    }
  }

  // ------------------------------------------------------------------ support buildings

  /** Rectangular building: façade batch on the walls, flat roof with parapet. */
  private building(x: number, z: number, yaw: number, w: number, h: number, d: number, wall: Key, roof: Key = 'roofDark') {
    const m = this.frameAt(x, z, yaw, w / 2, d / 2);
    const hw = w / 2, hd = d / 2, y0 = -1.5;
    const up = V(0, 1, 0);
    // Each wall in two bands so the base occlusion stays at the foot of the wall.
    for (const [ya, yb] of [[y0, 3.5], [3.5, h]]) {
      this.add(wall, this.facing(V(-hw, ya, hd), V(hw, ya, hd), V(hw, yb, hd), V(-hw, yb, hd), V(0, 0, 1)), m, 0.4);
      this.add(wall, this.facing(V(hw, ya, -hd), V(-hw, ya, -hd), V(-hw, yb, -hd), V(hw, yb, -hd), V(0, 0, -1)), m, 0.4);
      this.add(wall, this.facing(V(hw, ya, hd), V(hw, ya, -hd), V(hw, yb, -hd), V(hw, yb, hd), V(1, 0, 0)), m, 0.4);
      this.add(wall, this.facing(V(-hw, ya, -hd), V(-hw, ya, hd), V(-hw, yb, hd), V(-hw, yb, -hd), V(-1, 0, 0)), m, 0.4);
    }
    this.add(roof, this.facing(V(-hw, h, hd), V(hw, h, hd), V(hw, h, -hd), V(-hw, h, -hd), up), m);
    // Horizontal spandrels, corner piers and roof plant give the façades readable scale.
    for (let y = 4; y < h; y += 4) {
      for (const side of [-1, 1]) this.add('white', box(w + 0.3, 0.22, 0.3, 0, y, side * hd), m);
    }
    for (const side of [-1, 1]) {
      for (let x = -hw; x <= hw; x += 6) this.add('white', box(0.25, h, 0.4, x, h / 2, side * hd), m);
      this.add('accent', box(w + 0.6, 0.8, 0.5, 0, h - 0.4, side * hd), m);
    }
    for (let x = -hw + 5; x < hw - 3; x += 12) {
      this.add('steel', box(3, 1.5, 3, x, h + 0.75, 0), m);
      this.add('grate', box(2.7, 0.1, 2.7, x, h + 1.55, 0), m);
    }
    if (wall === 'cladding') {
      this.add('door', box(w * 0.55, h * 0.72, 0.3, 0, h * 0.36, hd + 0.2), m);
      this.add('accent', box(w * 0.6, 0.3, 2.5, 0, h * 0.75, hd + 1), m);
    }
    this.sign(m, Math.min(w * 0.3, 10), h - 2.3, hd + 0.45, wall === 'windows' ? 0 : 1);
    // Parapet
    for (const [px, pz, pw, pd] of [[0, hd - 0.2, w, 0.4], [0, -hd + 0.2, w, 0.4], [hw - 0.2, 0, 0.4, d], [-hw + 0.2, 0, 0.4, d]]) {
      this.add('concrete', boxY(pw, pd, px, pz, h, h + 1.0), m);
    }
    return m;
  }

  private sign(m: THREE.Matrix4, w: number, y: number, z: number, index: number) {
    const g = new THREE.PlaneGeometry(w, w / 2).translate(0, y, z);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + (index % 2) * 0.5, uv.getY(i) * 0.5 + (1 - Math.floor(index / 2)) * 0.5);
    this.add('sign', g, m);
  }

  private buildBuildings() {
    // Launch control blockhouse (low, heavy concrete, few windows).
    {
      const m = this.frameAt(150, 95, -0.5, 16, 10);
      this.add('concrete', boxY(32, 20, 0, 0, -1.5, 6), m, 0.35);
      this.add('concrete', boxY(28, 16, 0, 0, 6, 7.5), m);
      this.add('roofDark', boxY(26, 14, 0, 0, 7.5, 7.7), m);
      this.add('windows', this.facing(V(-12, 2.5, 10.02), V(12, 2.5, 10.02), V(12, 5, 10.02), V(-12, 5, 10.02), V(0, 0, 1)), m);
      this.sign(m, 5, 4, 10.08, 2);
      this.add('steel', boxY(3, 3, -9, -4, 7.7, 9.5), m);
      this.add('steel', new THREE.CylinderGeometry(0.1, 0.1, 12, 5).translate(10, 13.5, -5), m);
      this.add('white', new THREE.SphereGeometry(1.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(6, 7.7, -4), m);
    }
    // Operations offices and a hangar-workshop near the pad road.
    this.building(205, 150, -0.55, 46, 12, 18, 'windows');
    this.building(250, 105, -0.55, 30, 9, 22, 'cladding');
    this.building(-150, -150, -0.4, 36, 8, 20, 'cladding');
    this.building(-195, -118, -0.4, 22, 6, 14, 'windows');
    // Rooftop HVAC
    for (const [x, z] of [[205, 150], [-150, -150]] as const) {
      const m = this.frameAt(x, z, 0, 5, 5);
      this.add('steel', boxY(4, 3, -6, 0, 12.2, 14), m);
      this.add('steel', boxY(3, 3, 5, 2, 12.2, 13.5), m);
    }
    // Parking / service aprons around them.
    this.groundRect('apron', 205, 150, -0.55, 70, 44, 0.05);
    this.groundRect('apron', 150, 95, -0.5, 50, 36, 0.05);
    this.groundRect('apron', -168, -136, -0.4, 80, 50, 0.05);
  }

  /** Flat ground rectangle centred at (x,z) with heading `yaw`. */
  private groundRect(key: Key, x: number, z: number, yaw: number, w: number, d: number, off: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pts: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]);
    this.groundShape(key, pts, off);
  }

  // ------------------------------------------------------------------ assembly building

  private buildVab() {
    const { x, z, w, d, h } = SITE_LAYOUT.vab;
    const yaw = Math.atan2(-x, -z); // +Z' faces the pad
    const m = this.frameAt(x, z, yaw, w / 2 + 50, d / 2);
    const hw = w / 2, hd = d / 2;
    // Main high bay + low bay annex (cladding), blue parapet band and corner pilasters.
    this.add('vabClad', boxY(w, d, 0, 0, -1.5, h), m, 0.3);
    this.add('vabClad', boxY(54, d - 20, -hw - 27, -10, -1.5, 48), m, 0.3);
    this.add('accent', boxY(w + 0.8, d + 0.8, 0, 0, h - 7, h + 0.6), m);
    this.add('accent', boxY(54.8, d - 19.2, -hw - 27, -10, 44, 48.6), m);
    for (const [cx, cz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) this.add('accent', boxY(3, 3, cx, cz, -1.5, h - 7), m);
    // Giant door with frame.
    const doorW = 46, doorH = 104, doorX = 18;
    this.add('door', box(doorW, doorH, 1.0, doorX, doorH / 2, hd + 0.2), m);
    this.add('accent', boxY(3.2, 2.4, doorX - doorW / 2 - 1.6, hd + 0.4, -0.5, doorH + 3), m);
    this.add('accent', boxY(3.2, 2.4, doorX + doorW / 2 + 1.6, hd + 0.4, -0.5, doorH + 3), m);
    this.add('accent', boxY(doorW + 6.4, 2.4, doorX, hd + 0.4, doorH, doorH + 4), m);
    // Broad horizontal façade courses read at overview distance; fine ribs remain in the texture.
    for (let y = 20; y < h - 8; y += 20) {
      this.add('white', box(w + 0.6, 0.7, 0.6, 0, y, -hd), m);
      for (const side of [-1, 1]) this.add('white', box(0.6, 0.7, d, side * hw, y, 0), m);
    }
    this.add('roofDark', box(w - 2, 0.3, d - 2, 0, h + 0.8, 0), m);
    // Door slot above the main door (narrow vertical panel).
    this.add('door', box(10, h - doorH - 12, 0.8, doorX, doorH + 4 + (h - doorH - 12) / 2, hd + 0.15), m);
    // Low bay entrance canopy + windows
    const fz = hd - 20 + 0.03;
    this.add('windows', this.facing(V(-hw - 52, 3, fz), V(-hw - 2, 3, fz), V(-hw - 2, 15, fz), V(-hw - 52, 15, fz), V(0, 0, 1)), m);
    this.add('concrete', boxY(20, 6, -hw - 27, fz + 3, 5.5, 6.2), m);
    // Roof machinery
    for (const [rx, rz, rw, rd] of [[-40, -20, 14, 8], [30, 25, 10, 10], [45, -30, 8, 16], [-10, 10, 6, 6]]) this.add('steel', boxY(rw, rd, rx, rz, h + 0.6, h + 4), m);
    this.add('beacon', new THREE.SphereGeometry(0.6, 8, 6).translate(hw - 2, h + 1.4, hd - 2), m);
    this.add('beacon', new THREE.SphereGeometry(0.6, 8, 6).translate(-hw + 2, h + 1.4, -hd + 2), m);
    // Front apron + crawler hardstand.
    this.vabFrame = m;
    const apronPts: [number, number][] = [[-hw - 60, hd - 10], [hw + 20, hd - 10], [hw + 20, hd + 150], [-hw - 60, hd + 150]];
    this.groundShape('apron', apronPts.map(([lx, lz]) => {
      const v = V(lx, 0, lz).applyMatrix4(m);
      return [v.x, v.z] as [number, number];
    }), 0.05);

    // Painted wordmark + flag decals (alpha-cut layers of the site material).
    const decal = (key: 'logo' | 'flag', ww: number, hh: number, lx: number, ly: number, lz: number, rotY: number) => {
      const om = new THREE.Matrix4().makeRotationY(rotY).setPosition(lx, ly, lz);
      this.add(key, new THREE.PlaneGeometry(ww, hh), om.premultiply(m));
    };
    decal('logo', 52, 26, -36, 84, hd + 0.08, 0);
    decal('flag', 40, 25, -36, 44, hd + 0.08, 0);
    decal('logo', 70, 35, hw + 0.08, 80, 0, Math.PI / 2);
    decal('flag', 44, 27.5, -30, 76, -hd - 0.08, Math.PI);
  }
  private vabFrame = new THREE.Matrix4();

  // ------------------------------------------------------------------ roads and aprons

  /** Road strip along a polyline; `tex` across width (u 0..1), v along (tile metres). */
  private road(key: Key, pts: [number, number][], width: number, off: number, tile: number) {
    this.keepRoads.push({ pts, half: width / 2 + 5 });
    const dense: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 15));
      for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    dense.push(pts[pts.length - 1]);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < dense.length; i++) {
      const [x, z] = dense[i];
      const [px, pz] = dense[Math.max(0, i - 1)], [nx, nz] = dense[Math.min(dense.length - 1, i + 1)];
      let tx = nx - px, tz = nz - pz;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      if (i > 0) dist += Math.hypot(x - dense[i - 1][0], z - dense[i - 1][1]);
      // Left = up × tangent (x,z) → (tz, −tx)... choose so that u=0 is on the left when walking forward.
      const lx = tz, lz = -tx;
      for (const side of [0, 1]) {
        const o = (side === 0 ? 1 : -1) * width / 2;
        const vx = x + lx * o, vz = z + lz * o;
        pos.push(vx, this.groundY(vx, vz) + off, vz);
        uv.push(side, dist / tile);
      }
      if (i > 0) {
        const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.getAttribute('normal').getY(0) < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    this.add(key, g);
  }

  private buildRoads() {
    const L = SITE_LAYOUT;
    // Pad apron: circle with the pad (hole) and a notch for the open trench.
    const R = L.apronRadius, n = 96;
    const tA = Math.asin(6.6 / R);
    const outline: [number, number][] = [];
    // Start just east of the trench notch (at −Z) and go around.
    const a0 = -Math.PI / 2 + tA, a1 = -Math.PI / 2 + 2 * Math.PI - tA;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      outline.push([Math.cos(a) * R, Math.sin(a) * R]);
    }
    outline.push([-6.6, -L.padHalf - 0.25], [6.6, -L.padHalf - 0.25]);
    const hole = roundedRect(L.padHalf - 0.1, L.padHalf - 0.1, L.padCorner - 0.1, 10);
    this.groundShape('apron', outline, 0.05, [hole]);

    // Crawlerway from the assembly building door to the pad apron.
    const vm = this.vabFrame;
    const door = V(18, 0, SITE_LAYOUT.vab.d / 2 + 150).applyMatrix4(vm);
    const dirPad = V(-door.x, 0, -door.z).normalize();
    const padEnd = dirPad.clone().multiplyScalar(-(R - 4));
    this.road('crawler', [[door.x - dirPad.x * 6, door.z - dirPad.z * 6], [padEnd.x, padEnd.z]], 34, 0.09, 24);
    // Perimeter service road around the pad and spurs.
    const ring: [number, number][] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      ring.push([Math.cos(a) * 135, Math.sin(a) * 135]);
    }
    this.road('road', ring, 8, 0.13, 24);
    this.road('road', [[95, 95], [150, 70], [205, 125]], 8, 0.14, 24);
    this.road('road', [[-96, -93], [-140, -120]], 8, 0.14, 24);
    this.road('road', [[120, -64], [240, -180], [310, -232]], 8, 0.14, 24);
    this.road('road', [[205, 172], [260, 400], [300, 700]], 8, 0.13, 24);
    this.road('road', [[133, 25], [62, 8]], 6, 0.14, 24);
  }

  // ------------------------------------------------------------------ runway

  /**
   * 2.5 km x 60 m east–west runway on the plateau (RUNWAY, matches World.launch 'runway'): asphalt strip with
   * edge stripes and dashed centreline, painted end zones (threshold keys, 09 / 27 designators, touchdown
   * bars), paved shoulders, a taxiway to the service road and edge lights.
   */
  private buildRunway() {
    const R = RUNWAY;
    const hl = R.length / 2;
    const ax = R.x - R.dirX * hl, az = R.z - R.dirZ * hl;
    const bx = R.x + R.dirX * hl, bz = R.z + R.dirZ * hl;
    // Shoulders (blast pads past both ends), then the runway itself on top.
    this.road('apron', [[ax - R.dirX * 60, az - R.dirZ * 60], [bx + R.dirX * 60, bz + R.dirZ * 60]], R.width + 16, 0.03, 30);
    this.road('runway', [[ax, az], [bx, bz]], R.width, 0.06, 60);
    // Taxiway from the service road to the runway's north edge.
    const tx = R.x + 300, tz = R.z - R.width / 2 - 2;
    this.road('road', [[300, 700], [tx, tz - 40], [tx, tz]], 18, 0.14, 24);
    // End-zone markings (alpha-cut layers, one per designator).
    const end = (cx: number, cz: number, dx: number, dz: number, label: string) => {
      const len = 120, n = 6;
      const lx = dz, lz = -dx; // left of the direction of travel
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const v = i / n;
        for (const u of [0, 1]) {
          const o = (u - 0.5) * R.width;
          const x = cx + dx * v * len - lx * o, z = cz + dz * v * len - lz * o;
          pos.push(x, this.groundY(x, z) + 0.09, z);
          uv.push(u, v);
        }
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (g.getAttribute('normal').getY(0) < 0) {
        for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
        g.setIndex(idx);
        g.computeVertexNormals();
      }
      this.add(label === '09' ? 'runway09' : 'runway27', g);
    };
    end(ax, az, R.dirX, R.dirZ, '09');
    end(bx, bz, -R.dirX, -R.dirZ, '27');
    // Edge lights every 60 m (small white posts) and red/green end bars.
    for (let d = 0; d <= R.length; d += 60) {
      for (const side of [-1, 1]) {
        const x = ax + R.dirX * d + R.dirZ * side * (R.width / 2 + 2), z = az + R.dirZ * d - R.dirX * side * (R.width / 2 + 2);
        const m = this.frameAt(x, z);
        this.add('lamp', new THREE.CylinderGeometry(0.15, 0.15, 0.25, 6).translate(0, 0.45, 0), m);
        this.add('steel', new THREE.CylinderGeometry(0.05, 0.05, 0.35, 5).translate(0, 0.17, 0), m);
      }
    }
  }

  // ------------------------------------------------------------------ tracking dish

  private buildDish() {
    const x = 330, z = -240;
    const m = this.frameAt(x, z, 0, 4, 4);
    this.add('concrete', new THREE.CylinderGeometry(3.2, 3.8, 9.5, 16).translate(0, 3.25, 0), m);
    this.add('apron', new THREE.CylinderGeometry(7, 7, 0.4, 24).translate(0, 0.0, 0), m);
    this.groundRect('apron', x, z, 0, 30, 30, 0.05);
    const dish = new THREE.Group();
    dish.name = 'site:dish';
    dish.position.setFromMatrixPosition(m).add(V(0, 8, 0));
    // Azimuth turntable + yoke
    const yokeParts = [box(6, 1.2, 6, 0, 0.6, 0), box(0.8, 6, 2, -4.2, 3.8, 0), box(0.8, 6, 2, 4.2, 3.8, 0)];
    const yoke = new THREE.Mesh(this.track(mergeGeometries(yokeParts.map((g) => this.painted('steel', g)))!), this.siteMat!);
    yoke.castShadow = yoke.receiveShadow = true;
    dish.add(yoke);
    // Reflector (paraboloid), feed and struts on an elevation axis.
    const elev = new THREE.Group();
    elev.position.set(0, 6, 0);
    elev.rotation.x = -0.75;
    const prof: THREE.Vector2[] = [];
    const f = 4.2, Rd = 9;
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * Rd;
      prof.push(new THREE.Vector2(r, (r * r) / (4 * f)));
    }
    const refl = new THREE.LatheGeometry(prof, 40);
    const parts: THREE.BufferGeometry[] = [refl.translate(0, -1.2, 0)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(strut(V(Math.cos(a) * Rd * 0.85, (Rd * Rd * 0.72) / (4 * f) - 1.2, Math.sin(a) * Rd * 0.85), V(0, f - 1.2, 0), 0.15));
    }
    parts.push(new THREE.CylinderGeometry(0.5, 0.7, 1.4, 10).translate(0, f - 1.2, 0));
    parts.push(box(3, 2, 3, 0, -2.0, 0));
    const reflMat = this.track(withAerialPerspective(new THREE.MeshStandardMaterial({ color: 0xe4e4df, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }), BODY));
    const rm = new THREE.Mesh(this.track(mergeGeometries(parts.map(toNonIndexed).map((g) => (g.deleteAttribute('uv'), g)))!), reflMat);
    rm.castShadow = rm.receiveShadow = true;
    elev.add(rm);
    dish.add(elev);
    this.root.add(dish);
    this.dish = dish;
  }

  // ------------------------------------------------------------------ perimeter lights (instanced)

  // ------------------------------------------------------------------ vegetation (instanced)

  /** Number of vegetation instances (debug). */
  vegetationCount = 0;
  private keepCircles: [number, number, number][] = [];
  private keepRoads: { pts: [number, number][]; half: number }[] = [];

  private blocked(x: number, z: number): boolean {
    for (const [cx, cz, r] of this.keepCircles) if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    for (const { pts, half } of this.keepRoads) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < half * half) return true;
      }
    }
    return false;
  }

  /** Scattered scrub and pines on the plateau around the complex (2 instanced draw calls + trunks). */
  private buildVegetation() {
    let seed = 90210;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const bushes: THREE.Matrix4[] = [];
    const pines: THREE.Matrix4[] = [];
    const flatR = LAUNCH_SITE.flatRadius - 200;
    // Clustered placement: pick cluster centres, scatter members around them.
    for (let c = 0; c < 340; c++) {
      const a = rnd() * Math.PI * 2;
      const r = 185 + Math.pow(rnd(), 1.4) * (flatR - 185);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const n = 5 + Math.floor(rnd() * 14);
      const spread = 12 + rnd() * 35;
      const pineCluster = rnd() < 0.45;
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() - 0.5) * 2 * spread, z = cz + (rnd() - 0.5) * 2 * spread;
        if (Math.hypot(x, z) < 175 || this.blocked(x, z)) continue;
        const s = pineCluster ? 0.7 + rnd() * 0.7 : 0.6 + rnd() * 1.0;
        const y = this.groundY(x, z);
        const up = V(x, y + this.R0, z).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), up).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rnd() * 6.28));
        const m = new THREE.Matrix4().compose(V(x, y - 0.2, z), q, V(s * (0.8 + rnd() * 0.4), s, s * (0.8 + rnd() * 0.4)));
        (pineCluster && rnd() < 0.85 ? pines : bushes).push(m);
      }
    }
    const foliage = (color: number) => {
      const mat = withAerialPerspective(new THREE.MeshStandardMaterial({ color, roughness: 0.95, vertexColors: true }), BODY);
      const patch = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        patch(shader, renderer);
        shader.uniforms.uSiteWind = this.wind;
        shader.uniforms.uSiteLod = { value: 0 };
        shader.vertexShader = shader.vertexShader.replace('void main() {', 'uniform float uSiteWind;\nvoid main() {')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            transformed.x += sin(uSiteWind + instanceMatrix[3].x * 0.13 + position.y) * min(position.y * position.y * 0.002, 0.18);`);
        shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform float uSiteLod;\nvoid main() {').replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float distanceToPlant = length(cameraPosition - vAtmoWorld);
          float fade = 1.0 - smoothstep(7000.0, 10000.0, distanceToPlant);
          // Complementary dithers: detailed < 300–400 m < mid < 1.2–1.6 km < coarse crowns (uSiteLod 0 / 1 / 2).
          float lodMid = smoothstep(300.0, 400.0, distanceToPlant);
          float lodFar = smoothstep(1200.0, 1600.0, distanceToPlant);
          float grain = fract(dot(floor(gl_FragCoord.xy), vec2(0.75487766, 0.56984029)));
          float keepBelow = uSiteLod < 0.5 ? 2.0 : uSiteLod < 1.5 ? lodMid : lodFar;
          float keepFrom = uSiteLod < 0.5 ? lodMid : uSiteLod < 1.5 ? lodFar : -1.0;
          if (grain > fade || grain >= keepBelow || grain < keepFrom) discard;`);
      };
      mat.customProgramCacheKey = () => 'coastal-foliage-v2';
      return this.track(mat);
    };
    // Instances are bucketed into 1400 m cells so frustum culling (and the vessel-hugging shadow
    // camera) skips vegetation that is off screen, instead of drawing all ~4k plants every pass.
    // Colours consume the random sequence in the original order, so placement/tint are unchanged.
    const CELL = 1400;
    const density = this.options.vegetationDensity ?? 1;
    let kept = 0;
    const shade = (geo: THREE.BufferGeometry) => {
      if (geo.getAttribute('color')) return;
      const p = geo.getAttribute('position');
      const colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const v = 0.65 + Math.min(0.35, Math.max(0, p.getY(i)) * 0.15);
        colors.set([v, v, v], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    };
    const mk = (geo: THREE.BufferGeometry, midGeo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string, tint: [number, number]) => {
      if (!list.length) return;
      shade(geo); shade(midGeo);
      const shared = this.track(geo);
      const sharedMid = this.track(midGeo);
      const cells = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
      const pos = new THREE.Vector3();
      list.forEach((m, i) => {
        const k = tint[0] + rnd() * (tint[1] - tint[0]);
        const c = new THREE.Color(k, k * (0.95 + rnd() * 0.1), k * (0.85 + rnd() * 0.2));
        if (density < 1 && (i * 0.6180339887) % 1 >= density) return; // even thinning (golden-ratio sequence)
        kept++;
        pos.setFromMatrixPosition(m);
        const key = `${Math.floor((pos.x + CELL / 2) / CELL)},${Math.floor((pos.z + CELL / 2) / CELL)}`;
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = []));
        cell.push({ m, c });
      });
      // A coarse crown replaces detailed limbs beyond 1.2–1.6 km with a complementary dither.
      const farGeo = this.track(new THREE.IcosahedronGeometry(1, 0).scale(name === 'site:pines' ? 3.5 : 2.5, name === 'site:pines' ? 3 : 1.7, name === 'site:pines' ? 3.5 : 2.5).translate(0, name === 'site:pines' ? 7.2 : 1.3, 0));
      farGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(farGeo.getAttribute('position').count * 3).fill(0.85), 3));
      const levelMat = (level: number) => {
        const m = this.track(mat.clone());
        m.onBeforeCompile = (shader, renderer) => { mat.onBeforeCompile(shader, renderer); shader.uniforms.uSiteLod.value = level; };
        m.customProgramCacheKey = mat.customProgramCacheKey;
        return m;
      };
      const midMat = levelMat(1), farMat = levelMat(2);
      for (const cell of cells.values()) {
        const matrices = new Float32Array(cell.length * 16), colors = new Float32Array(cell.length * 3), xyz = new Float32Array(cell.length * 3);
        cell.forEach(({ m, c }, i) => {
          m.toArray(matrices, i * 16); c.toArray(colors, i * 3);
          xyz.set([matrices[i * 16 + 12], matrices[i * 16 + 13], matrices[i * 16 + 14]], i * 3);
        });
        const level = (g: THREE.BufferGeometry, m: THREE.Material, suffix: string, castShadow: boolean) => {
          const im = new THREE.InstancedMesh(g, m, cell.length);
          im.instanceMatrix.array.set(matrices);
          im.instanceColor = new THREE.InstancedBufferAttribute(colors.slice(), 3);
          im.castShadow = castShadow;
          im.receiveShadow = true;
          im.name = name + suffix;
          // Bounding spheres stay those of the whole cell (frustum culling); counts change with distance.
          im.computeBoundingSphere();
          this.root.add(im);
          return im;
        };
        this.vegetationLods.push({
          levels: [
            { mesh: level(shared, mat, '', true), min: 0, max: 400 },
            { mesh: level(sharedMid, midMat, ':mid', true), min: 300, max: 1600 },
            { mesh: level(farGeo, farMat, ':far', false), min: 1200, max: 10000 },
          ],
          matrices, colors, xyz,
        });
      }
    };
    // Lumpy scrub: a few overlapping jittered blobs, smooth-shaded.
    const blobs: THREE.BufferGeometry[] = [];
    const blobSpecs = [[0, 1.3, 0, 2.0], [1.4, 0.9, 0.6, 1.4], [-1.2, 0.8, -0.8, 1.5]];
    for (const [bx, by, bz, br] of blobSpecs) {
      const g = new THREE.IcosahedronGeometry(br, 1);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const k = 0.85 + 0.3 * Math.abs(Math.sin(p.getX(i) * 3.1 + p.getY(i) * 5.7 + p.getZ(i) * 4.3));
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      blobs.push(toNonIndexed(g.translate(bx, by, bz)));
    }
    const bushGeo = mergeGeometries(blobs)!;
    blobs.forEach((g) => g.dispose());
    // Scrub mid level: the same blobs with 20 faces each, shaded as spheres.
    const midBlobs = blobSpecs.map(([bx, by, bz, br]) => {
      const g = new THREE.IcosahedronGeometry(br, 0);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i), p.getY(i) * 0.8, p.getZ(i));
      smoothSphereNormals(g);
      return g.translate(bx, by, bz);
    });
    const bushMid = mergeGeometries(midBlobs)!;
    midBlobs.forEach((g) => g.dispose());
    mk(bushGeo, bushMid, foliage(0x46552f), bushes, 'site:scrub', [0.7, 1.05]);
    mk(coastalTreeGeometry(), coastalTreeGeometry('mid'), foliage(0x657044), pines, 'site:pines', [0.7, 1.05]);
    this.vegetationCount = kept;

  }

  private buildLights() {
    const spots: { x: number; z: number; face: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.11;
      spots.push({ x: Math.cos(a) * 70, z: Math.sin(a) * 70, face: Math.atan2(-Math.cos(a), -Math.sin(a)) });
    }
    // Along the crawlerway and around the VAB apron.
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const door = V(18, 0, SITE_LAYOUT.vab.d / 2 + 150).applyMatrix4(this.vabFrame);
      const dir = door.clone().normalize();
      const p = door.clone().multiplyScalar(1 - t).add(dir.clone().multiplyScalar(60 * t));
      for (const side of [-1, 1]) spots.push({ x: p.x + side * dir.z * 26, z: p.z - side * dir.x * 26, face: Math.atan2(-side * dir.z, side * dir.x) });
    }
    // Static: merged into the site batches like every other fixture.
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.28, 18, 6).translate(0, 9, 0);
    const headGeo = new THREE.BoxGeometry(2.2, 0.7, 0.5).translate(0, 18.2, 0.3);
    for (const s of spots) {
      const m = this.frameAt(s.x, s.z, s.face);
      this.add('steel', poleGeo.clone(), m);
      this.add('lamp', headGeo.clone(), m);
    }
    poleGeo.dispose(); headGeo.dispose();
    // Aviation beacons on mast and tower tops.
    const tw = SITE_LAYOUT.tower;
    this.add('beacon', new THREE.SphereGeometry(0.4, 8, 6).translate(tw.x, tw.height + 3.9, tw.z));
  }

  // ------------------------------------------------------------------ moving pad equipment and deluge steam

  private buildPadEquipment() {
    const mat = instancedVariant(this.siteMat!);
    this.equipment = new PadEquipment(mat, (key, g) => this.painted(key, g));
    for (const m of this.equipment.group.children) (m as THREE.Mesh).onBeforeRender = (renderer) => this.surfaceTextures?.fill(renderer);
    this.root.add(this.equipment.group);
    const n = this.options.steamParticles ?? 96;
    if (n > 0) {
      const L = SITE_LAYOUT;
      this.steam = new PadSteam(n, this.planetUniforms.uSunDir, { halfWidth: L.trenchHalf, open: -L.padHalf - 2, end: L.trenchEnd, hole: L.holeHalf });
      this.root.add(this.steam.mesh);
    }
  }

  // ------------------------------------------------------------------ interaction

  private buildPickables() {
    const inv = this.track(new THREE.MeshBasicMaterial({ visible: false }));
    const pad = new THREE.Mesh(this.track(new THREE.CylinderGeometry(30, 30, 80, 16).translate(0, 40, 0)), inv);
    pad.userData.siteId = 'pad';
    const { w, d, h } = SITE_LAYOUT.vab;
    const vab = new THREE.Mesh(this.track(new THREE.BoxGeometry(w + 54, h + 6, d).translate(-27, h / 2, 0)), inv);
    vab.applyMatrix4(this.vabFrame);
    vab.userData.siteId = 'vab';
    this.root.add(pad, vab);
    this.pickables.push(pad, vab);
    // Glowing ring + soft light curtain shown when the pad is hovered.
    const ringMat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.36, 0.78, 1).multiplyScalar(4), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(25, 28, 96).rotateX(-Math.PI / 2).translate(0, 0.35, 0)), ringMat);
    const curtainMat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.36, 0.78, 1).multiplyScalar(1.5), transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    ring.add(new THREE.Mesh(this.track(new THREE.CylinderGeometry(26.5, 26.5, 10, 96, 1, true).translate(0, 5.3, 0)), curtainMat));
    ring.visible = false;
    ring.renderOrder = 2;
    this.root.add(ring);
    this.highlightRing = ring;
  }

  /** Hover highlight for hub interaction (null = none). */
  setHighlight(id: SiteObjectId | null) {
    if (id === this.highlighted) return;
    this.highlighted = id;
    if (this.highlightRing) this.highlightRing.visible = id === 'pad';
    if (this.surfaceUniforms) this.surfaceUniforms.uVabGlow.value.set(id === 'vab' ? 0x2a6fa8 : 0x000000).multiplyScalar(id === 'vab' ? 0.55 : 0);
  }

  // ------------------------------------------------------------------ per frame

  /**
   * Place the site for the floating origin `origin` (float64 inertial) at sim time `t`, and update the terrain
   * cutout. Hidden beyond 200 km.
   */
  update(origin: Vec3, t: number, cameraPosition?: THREE.Vector3, pad?: PadVessel | null) {
    const eph = this.universe.ephem;
    const bp = eph.getBodyState(BODY, t).position;
    const q = eph.bodyRotation(BODY, t);
    this.tmpQ.set(q.x, q.y, q.z, q.w);
    // Float64 rotation of the pad point (never at planet-radius magnitudes in float32).
    const r = qRotate(q, this.padFixed);
    const px = bp.x + r.x - origin.x, py = bp.y + r.y - origin.y, pz = bp.z + r.z - origin.z;
    const dist = Math.hypot(px, py, pz);
    const visible = dist < HIDE_DISTANCE;
    this.root.visible = visible;
    const cut = terrainCutout(BODY);
    cut.uCutParams.value.w = visible ? 1 : 0;
    if (!visible) return;
    this.root.position.set(px, py, pz);
    this.root.quaternion.multiplyQuaternions(this.tmpQ, this.qLocal);
    this.root.updateMatrix();
    this.root.updateWorldMatrix(true, false);
    this.updateVegetationLod(cameraPosition);
    const L = SITE_LAYOUT;
    cut.uCutMatrix.value.copy(this.tmpM.copy(this.root.matrixWorld).invert());
    cut.uCutA.value.set(0, 0, L.padHalf, L.padHalf);
    cut.uCutB.value.set(0, (-L.padHalf + 0.5 + L.trenchEnd - 1.5) / 2, L.trenchHalf + 1.5, (L.padHalf - 0.5 - (L.trenchEnd - 1.5)) / 2);
    cut.uCutParams.value.set(L.padCorner, 0, 500, 1);

    const solar = this.planetUniforms.uSunDir.value;
    const up = this.sunUp.set(0, 1, 0).applyQuaternion(this.root.quaternion);
    this.night.value = 1 - THREE.MathUtils.smoothstep(up.dot(solar), -0.06, 0.12);
    this.wind.value = t % 4096;
    const su = this.surfaceUniforms;
    if (su) {
      su.uWindowGlow.value.set(0xffce88).multiplyScalar(this.night.value * 1.8);
      su.uLampColor.value.setRGB(1, 0.82, 0.56).multiplyScalar(0.6 + 3.4 * this.night.value);
    }
    if (this.dish) this.dish.rotation.y = (t * 0.02) % (Math.PI * 2);
    this.updatePad(origin, t, pad ?? null);
    if (su) {
      const on = Math.sin(t * Math.PI * 1.2) > 0.2 ? 8 : 0.4;
      su.uBeaconColor.value.setRGB(on, on * 0.08, on * 0.04);
    }
  }

  /** Clamps, swing arms and deluge steam follow the active vessel while it is on (or just above) the pad. */
  private updatePad(origin: Vec3, t: number, pad: PadVessel | null) {
    let local: THREE.Vector3 | null = null;
    if (pad) {
      const p = pad.state.position;
      local = this.vesselLocal.set(p.x - origin.x, p.y - origin.y, p.z - origin.z).applyMatrix4(this.tmpM.copy(this.root.matrixWorld).invert());
    }
    this.equipment?.update(t, pad && local ? { state: pad.state, com: local, held: pad.held, firing: pad.firing } : null);
    if (!this.steam) return;
    const dt = Number.isFinite(this.steamT) ? Math.min(0.1, Math.max(0, t - this.steamT)) : 0;
    this.steamT = t;
    let strength = 0;
    if (pad && local && pad.firing && Math.hypot(local.x, local.z) < 12) {
      const thrust = pad.state.telemetry.thrust;
      const height = Math.max(0, local.y);
      strength = Math.min(1, Math.max(0, thrust) / 1.5e6 + (thrust > 0 ? 0.35 : 0)) * (1 - THREE.MathUtils.smoothstep(height, 40, 220));
    }
    this.steam.update(t, dt, strength, 1 - this.night.value);
  }

  /**
   * Vegetation LOD bands (the shader dithers between them over 1.2–1.6 km and fades out at 7–10 km). Each cell's
   * near and far meshes draw only the instances inside their band, so detailed trees are not vertex-shaded (and
   * shadow-rendered) out to the cell's far edge only to be discarded per fragment.
   */
  private updateVegetationLod(cameraPosition?: THREE.Vector3) {
    const cam = this.lodCenter;
    if (cameraPosition) cam.copy(cameraPosition); else cam.set(0, 0, 0);
    cam.applyMatrix4(this.tmpM.copy(this.root.matrixWorld).invert());
    const STEP = 20;
    if (cam.distanceToSquared(this.vegCamera) < STEP * STEP) return;
    this.vegCamera.copy(cam);
    for (const { levels, matrices, colors, xyz } of this.vegetationLods) {
      const bound = levels[0].mesh.boundingSphere!;
      const centre = bound.center.distanceTo(cam);
      for (const { mesh, min, max } of levels) {
        // Bands widened by the update step so a stale partition still covers the shader's dither band.
        const lo = Math.max(0, min - STEP), hi = max + STEP;
        const k = centre + bound.radius > lo && centre - bound.radius < hi
          ? packBand(xyz, matrices, colors, cam, lo, hi, mesh.instanceMatrix.array as Float32Array, mesh.instanceColor!.array as Float32Array)
          : 0;
        mesh.visible = k > 0;
        if (k === 0) continue;
        mesh.count = k;
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, k * 16); mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, k * 3); mesh.instanceColor!.needsUpdate = true;
      }
    }
  }

  /** Hide the site and disable the terrain cutout (e.g. while the active vessel is around another body). */
  hide() {
    this.root.visible = false;
    terrainCutout(BODY).uCutParams.value.w = 0;
  }

  dispose() {
    this.equipment?.dispose();
    this.steam?.dispose();
    clearSiteShadow();
    terrainCutout(BODY).uCutParams.value.w = 0;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
