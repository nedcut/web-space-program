import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../../sim/terrain/api';
import { latLonToUnit, LAUNCH_SITE } from '../../sim/terrain';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { Vec3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import { terrainCutout } from '../planet/cutout';
import * as TX from './textures';
import { withAerialPerspective } from './aerial';

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

type Key =
  | 'concrete' | 'soot' | 'deck' | 'steel' | 'accent' | 'hazard' | 'grate' | 'white' | 'darkMetal' | 'cable'
  | 'cladding' | 'vabClad' | 'door' | 'windows' | 'apron' | 'crawler' | 'road' | 'roofDark' | 'lamp' | 'beacon';

interface BatchDef {
  mat: THREE.Material;
  /** Box-projected UV tile size in metres (u, v); null = keep geometry UVs. */
  tile: [number, number] | null;
  cast: boolean;
  receive: boolean;
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
  private batches = new Map<Key, { def: BatchDef; geos: THREE.BufferGeometry[] }>();
  private disposables: { dispose(): void }[] = [];
  private dish: THREE.Group | null = null;
  private beaconMat: THREE.MeshBasicMaterial | null = null;
  private highlightRing: THREE.Mesh | null = null;
  private vabMaterials: THREE.MeshStandardMaterial[] = [];
  private highlighted: SiteObjectId | null = null;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  constructor(private universe: SiteUniverse) {
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
    this.buildDish();
    this.buildLights();
    this.buildVegetation();
    this.buildPickables();
    this.flush();
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
    const std = (p: THREE.MeshStandardMaterialParameters) => this.track(withAerialPerspective(new THREE.MeshStandardMaterial(p), BODY));
    const concreteTex = t(TX.concreteTexture(3));
    const apronTex = t(TX.concreteTexture(9, '#a6a39b'));
    const claddingTex = t(TX.claddingTexture());
    const def = (mat: THREE.Material, tile: [number, number] | null, cast = true, receive = true): BatchDef => ({ mat, tile, cast, receive });
    const B: Record<Key, BatchDef> = {
      concrete: def(std({ map: concreteTex, color: 0xbdb9b1, roughness: 0.88, metalness: 0 }), [8, 8]),
      soot: def(std({ map: t(TX.sootTexture()), roughness: 0.95, metalness: 0 }), [8, 8], false),
      deck: def(std({ map: t(TX.padDeckTexture(SITE_LAYOUT.holeHalf, SITE_LAYOUT.trenchHalf)), color: 0xc4c2bc, roughness: 0.85, metalness: 0 }), null, false),
      steel: def(std({ color: 0x8f969d, roughness: 0.5, metalness: 0.75 }), null),
      accent: def(std({ color: 0x1f5f8a, roughness: 0.5, metalness: 0.45 }), null),
      hazard: def(std({ color: 0xd9a72a, roughness: 0.55, metalness: 0.2 }), null),
      grate: def(std({ color: 0x4d545c, roughness: 0.75, metalness: 0.6 }), null),
      white: def(std({ color: 0xe4e4df, roughness: 0.62, metalness: 0.05 }), null),
      darkMetal: def(std({ color: 0x2b2826, roughness: 0.8, metalness: 0.6 }), null, false),
      cable: def(std({ color: 0x2a2b2e, roughness: 0.6, metalness: 0.4 }), null, false, false),
      cladding: def(std({ map: claddingTex, color: 0xc8d4e2, roughness: 0.6, metalness: 0.3 }), [4, 8]),
      vabClad: def(std({ map: claddingTex, color: 0xc8d4e2, roughness: 0.6, metalness: 0.3 }), [4, 8]),
      door: def(std({ map: t(TX.vabDoorTexture()), roughness: 0.5, metalness: 0.5 }), null),
      windows: def(std({ map: t(TX.windowsTexture()), roughness: 0.4, metalness: 0.2 }), [12, 4]),
      apron: def(std({ map: apronTex, color: 0xb4b2ac, roughness: 0.9, metalness: 0 }), [8, 8], false),
      crawler: def(std({ map: t(TX.roadTexture(true)), roughness: 0.92, metalness: 0 }), null, false),
      road: def(std({ map: t(TX.roadTexture(false)), roughness: 0.85, metalness: 0 }), null, false),
      roofDark: def(std({ color: 0x3c3f44, roughness: 0.85, metalness: 0.2 }), null),
      lamp: def(this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.9, 0.74).multiplyScalar(3.2) })), null, false, false),
      beacon: def(this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.04).multiplyScalar(8) })), null, false, false),
    };
    this.beaconMat = B.beacon.mat as THREE.MeshBasicMaterial;
    this.vabMaterials = [B.vabClad.mat as THREE.MeshStandardMaterial, B.door.mat as THREE.MeshStandardMaterial];
    for (const k of Object.keys(B) as Key[]) this.batches.set(k, { def: B[k], geos: [] });
  }

  /** Add geometry (object space) to a batch, optionally transformed by `m` (object → local pad frame). */
  private add(key: Key, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const b = this.batches.get(key)!;
    let geo = toNonIndexed(g);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (b.def.tile) projectUV(geo, b.def.tile[0], b.def.tile[1]);
    else if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    // Keep only the attributes every batch member shares.
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    geo.clearGroups();
    if (m) geo = geo.applyMatrix4(m);
    b.geos.push(geo);
  }

  private addAll(key: Key, gs: THREE.BufferGeometry[], m?: THREE.Matrix4) {
    for (const g of gs) this.add(key, g, m);
  }

  private flush() {
    for (const [key, b] of this.batches) {
      if (!b.geos.length) continue;
      const merged = this.track(mergeGeometries(b.geos, false)!);
      b.geos.forEach((g) => g.dispose());
      b.geos = [];
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.def.mat);
      mesh.name = `site:${key}`;
      mesh.castShadow = b.def.cast;
      mesh.receiveShadow = b.def.receive;
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
      const a = inner[i], b = inner[j];
      this.add('hazard', this.facing(V(a[0], 0.0, a[1]), V(b[0], 0.0, b[1]), V(b[0], top + 0.005, b[1]), V(a[0], top + 0.005, a[1]), V(-a[0], 0, -a[1])));
    }

    // Flame trench (soot concrete). Floor: flat under the deflector, then a ramp up to the exit.
    const zS = H, zN = L.trenchEnd, zRamp = -8, zDeck = -L.padHalf;
    const floorAt = (z: number) => (z > zRamp ? D : D + ((zRamp - z) / (zRamp - zN)) * 8);
    const up = V(0, 1, 0);
    this.add('soot', this.facing(V(-T, D, zS), V(T, D, zS), V(T, D, zRamp), V(-T, D, zRamp), up));
    this.add('soot', this.facing(V(-T, D, zRamp), V(T, D, zRamp), V(T, floorAt(zN), zN), V(-T, floorAt(zN), zN), up));
    // Side walls: segments with different tops (hole: 0, under deck: −1.5, open: coping).
    const segs: [number, number, number][] = [
      [zS, -H, 0],
      [-H, zDeck, -1.5],
      [zDeck, zN, 0.15],
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
    this.add('soot', this.facing(V(-T, floorAt(zN), zN), V(T, floorAt(zN), zN), V(T, 0.15, zN), V(-T, 0.15, zN), V(0, 0, 1)));
    // Lintel at the deck edge over the trench mouth.
    this.add('concrete', boxY(2 * T + 0.2, 1.2, 0, zDeck - 0.1, -1.5, 0.21));
    // Coping along the open trench (covers the cutout boundary).
    const cz0 = zDeck - 0.4, cz1 = zN - 2.2;
    for (const sx of [-1, 1]) this.add('concrete', boxY(2.2, cz0 - cz1, sx * (T + 1.1), (cz0 + cz1) / 2, -0.6, 0.15));
    this.add('concrete', boxY(2 * T + 4.4, 2.2, 0, zN - 1.1, -0.6, 0.15));
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

    // Launch mount: four hold-down posts at the hole corners (outside a 4 m radius vehicle) + rails.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (H + 1.6), z = sz * (H + 1.6);
      this.add('steel', boxY(1.4, 1.4, x, z, 0, 0.9));
      this.add('accent', boxY(1.6, 1.6, x, z, 0, 0.18));
      this.add('darkMetal', boxY(0.6, 0.6, x - sx * 0.45, z - sz * 0.45, 0.9, 1.25));
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

    // Umbilical / access arms reaching toward the pad (end ≥ 4.6 m from the vehicle axis).
    for (const y of [20, 33]) {
      const x0 = tx + h, x1 = -4.6 - 1.2;
      const w = 0.9, hh = 1.0;
      const chords: [number, number][] = [[-w, -hh], [w, -hh], [-w, hh], [w, hh]];
      for (const [cz, cy] of chords) accent.push(strut(V(x0, y + cy, tz + cz), V(x1, y + cy, tz + cz), 0.2));
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        accent.push(strut(V(x, y - hh, tz - w), V(x, y + hh, tz - w), 0.12));
        accent.push(strut(V(x, y - hh, tz + w), V(x, y + hh, tz + w), 0.12));
        accent.push(strut(V(x, y + hh, tz - w), V(x, y + hh, tz + w), 0.12));
        if (i < n) {
          const xn = x0 + ((x1 - x0) * (i + 1)) / n;
          accent.push(strut(V(x, y - hh, tz - w), V(xn, y + hh, tz - w), 0.1));
          accent.push(strut(V(x, y - hh, tz + w), V(xn, y + hh, tz + w), 0.1));
        }
      }
      grate.push(box(x1 - x0, 0.15, 2 * w, (x0 + x1) / 2, y - hh, tz));
      // Swing-arm hood at the end.
      steel.push(box(1.2, 2.6, 2.6, x1 + 0.6, y, tz));
      this.add('cable', new THREE.CylinderGeometry(0.15, 0.15, x1 - x0, 6).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y - hh - 0.3, tz + 0.5));
      // Hinge drum on the tower face.
      steel.push(new THREE.CylinderGeometry(0.6, 0.6, 2.6, 10).translate(x0 + 0.3, y, tz));
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
    this.add(wall, this.facing(V(-hw, y0, hd), V(hw, y0, hd), V(hw, h, hd), V(-hw, h, hd), V(0, 0, 1)), m);
    this.add(wall, this.facing(V(hw, y0, -hd), V(-hw, y0, -hd), V(-hw, h, -hd), V(hw, h, -hd), V(0, 0, -1)), m);
    this.add(wall, this.facing(V(hw, y0, hd), V(hw, y0, -hd), V(hw, h, -hd), V(hw, h, hd), V(1, 0, 0)), m);
    this.add(wall, this.facing(V(-hw, y0, -hd), V(-hw, y0, hd), V(-hw, h, hd), V(-hw, h, -hd), V(-1, 0, 0)), m);
    this.add(roof, this.facing(V(-hw, h, hd), V(hw, h, hd), V(hw, h, -hd), V(-hw, h, -hd), up), m);
    // Parapet
    for (const [px, pz, pw, pd] of [[0, hd - 0.2, w, 0.4], [0, -hd + 0.2, w, 0.4], [hw - 0.2, 0, 0.4, d], [-hw + 0.2, 0, 0.4, d]]) {
      this.add('concrete', boxY(pw, pd, px, pz, h, h + 1.0), m);
    }
    return m;
  }

  private buildBuildings() {
    // Launch control blockhouse (low, heavy concrete, few windows).
    {
      const m = this.frameAt(150, 95, -0.5, 16, 10);
      this.add('concrete', boxY(32, 20, 0, 0, -1.5, 6), m);
      this.add('concrete', boxY(28, 16, 0, 0, 6, 7.5), m);
      this.add('roofDark', boxY(26, 14, 0, 0, 7.5, 7.7), m);
      this.add('windows', this.facing(V(-12, 2.5, 10.02), V(12, 2.5, 10.02), V(12, 5, 10.02), V(-12, 5, 10.02), V(0, 0, 1)), m);
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
    this.add('vabClad', boxY(w, d, 0, 0, -1.5, h), m);
    this.add('vabClad', boxY(54, d - 20, -hw - 27, -10, -1.5, 48), m);
    this.add('accent', boxY(w + 0.8, d + 0.8, 0, 0, h - 7, h + 0.6), m);
    this.add('accent', boxY(54.8, d - 19.2, -hw - 27, -10, 44, 48.6), m);
    for (const [cx, cz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) this.add('accent', boxY(3, 3, cx, cz, -1.5, h - 7), m);
    // Giant door with frame.
    const doorW = 46, doorH = 104, doorX = 18;
    this.add('door', box(doorW, doorH, 1.0, doorX, doorH / 2, hd + 0.2), m);
    this.add('accent', boxY(3.2, 2.4, doorX - doorW / 2 - 1.6, hd + 0.4, -0.5, doorH + 3), m);
    this.add('accent', boxY(3.2, 2.4, doorX + doorW / 2 + 1.6, hd + 0.4, -0.5, doorH + 3), m);
    this.add('accent', boxY(doorW + 6.4, 2.4, doorX, hd + 0.4, doorH, doorH + 4), m);
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

    // Painted wordmark + flag decals (separate transparent materials).
    const decal = (texture: THREE.Texture, ww: number, hh: number, lx: number, ly: number, lz: number, rotY: number) => {
      const mat = this.track(withAerialPerspective(new THREE.MeshStandardMaterial({ map: this.track(texture), transparent: true, roughness: 0.7, metalness: 0.1, depthWrite: false }), BODY));
      this.vabMaterials.push(mat);
      const g = this.track(new THREE.PlaneGeometry(ww, hh));
      const mesh = new THREE.Mesh(g, mat);
      const om = new THREE.Matrix4().makeRotationY(rotY).setPosition(lx, ly, lz);
      mesh.applyMatrix4(om.premultiply(m));
      mesh.renderOrder = 1;
      mesh.name = 'site:decal';
      this.root.add(mesh);
    };
    decal(TX.logoTexture(), 52, 26, -36, 84, hd + 0.08, 0);
    decal(TX.flagTexture(), 40, 25, -36, 44, hd + 0.08, 0);
    decal(TX.logoTexture(), 70, 35, hw + 0.08, 80, 0, Math.PI / 2);
    decal(TX.flagTexture(), 44, 27.5, -30, 76, -hd - 0.08, Math.PI);
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
    const white = this.batches.get('white')!.def.mat;
    const steel = this.batches.get('steel')!.def.mat;
    // Azimuth turntable + yoke
    const yokeParts = [box(6, 1.2, 6, 0, 0.6, 0), box(0.8, 6, 2, -4.2, 3.8, 0), box(0.8, 6, 2, 4.2, 3.8, 0)];
    const yoke = new THREE.Mesh(this.track(mergeGeometries(yokeParts.map(toNonIndexed))!), steel);
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
    const reflMat = this.track(withAerialPerspective((white as THREE.MeshStandardMaterial).clone(), BODY));
    reflMat.side = THREE.DoubleSide;
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
    const foliage = (color: number) =>
      this.track(withAerialPerspective(new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }), BODY));
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string, tint: [number, number]) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(this.track(geo), mat, list.length);
      list.forEach((m, i) => {
        im.setMatrixAt(i, m);
        const k = tint[0] + rnd() * (tint[1] - tint[0]);
        im.setColorAt(i, new THREE.Color(k, k * (0.95 + rnd() * 0.1), k * (0.85 + rnd() * 0.2)));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.name = name;
      im.computeBoundingSphere();
      this.root.add(im);
    };
    // Lumpy scrub: a few overlapping jittered blobs, smooth-shaded.
    const blobs: THREE.BufferGeometry[] = [];
    for (const [bx, by, bz, br] of [[0, 1.3, 0, 2.0], [1.4, 0.9, 0.6, 1.4], [-1.2, 0.8, -0.8, 1.5]]) {
      const g = new THREE.IcosahedronGeometry(br, 0);
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
    mk(bushGeo, foliage(0x46552f), bushes, 'site:scrub', [0.7, 1.05]);
    const pineParts = [
      new THREE.CylinderGeometry(0.25, 0.35, 4, 5).translate(0, 2, 0),
      new THREE.ConeGeometry(2.6, 6, 7).translate(0, 5.5, 0),
      new THREE.ConeGeometry(2.0, 5, 7).translate(0, 8.5, 0),
      new THREE.ConeGeometry(1.3, 4, 7).translate(0, 11, 0),
    ].map(toNonIndexed);
    mk(mergeGeometries(pineParts)!, foliage(0x2f4024), pines, 'site:pines', [0.7, 1.05]);
    this.vegetationCount = bushes.length + pines.length;
    pineParts.forEach((g) => g.dispose());
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
    const n = spots.length;
    const poleGeo = this.track(new THREE.CylinderGeometry(0.16, 0.28, 18, 6).translate(0, 9, 0));
    const headGeo = this.track(new THREE.BoxGeometry(2.2, 0.7, 0.5).translate(0, 18.2, 0.3));
    const poles = new THREE.InstancedMesh(poleGeo, this.batches.get('steel')!.def.mat, n);
    const heads = new THREE.InstancedMesh(headGeo, this.batches.get('lamp')!.def.mat, n);
    spots.forEach((s, i) => {
      const m = this.frameAt(s.x, s.z, s.face);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    poles.name = 'site:poles';
    heads.name = 'site:lamps';
    poles.computeBoundingSphere();
    heads.computeBoundingSphere();
    this.root.add(poles, heads);
    // Aviation beacons on mast and tower tops.
    const tw = SITE_LAYOUT.tower;
    this.add('beacon', new THREE.SphereGeometry(0.4, 8, 6).translate(tw.x, tw.height + 3.9, tw.z));
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
    for (const m of this.vabMaterials) {
      m.emissive.set(id === 'vab' ? 0x2a6fa8 : 0x000000);
      m.emissiveIntensity = id === 'vab' ? 0.55 : 0;
    }
  }

  // ------------------------------------------------------------------ per frame

  /**
   * Place the site for the floating origin `origin` (float64 inertial) at sim time `t`, and update the terrain
   * cutout. Hidden beyond 200 km.
   */
  update(origin: Vec3, t: number) {
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
    this.root.updateMatrixWorld(true);
    const L = SITE_LAYOUT;
    cut.uCutMatrix.value.copy(this.tmpM.copy(this.root.matrixWorld).invert());
    cut.uCutA.value.set(0, 0, L.padHalf, L.padHalf);
    cut.uCutB.value.set(0, (-L.padHalf + 0.5 + L.trenchEnd - 1.5) / 2, L.trenchHalf + 1.5, (L.padHalf - 0.5 - (L.trenchEnd - 1.5)) / 2);
    cut.uCutParams.value.set(L.padCorner, 0, 500, 1);

    if (this.dish) this.dish.rotation.y = (t * 0.02) % (Math.PI * 2);
    if (this.beaconMat) {
      const on = Math.sin(t * Math.PI * 1.2) > 0.2 ? 8 : 0.4;
      this.beaconMat.color.setRGB(on, on * 0.08, on * 0.04);
    }
  }

  /** Hide the site and disable the terrain cutout (e.g. while the active vessel is around another body). */
  hide() {
    this.root.visible = false;
    terrainCutout(BODY).uCutParams.value.w = 0;
  }

  dispose() {
    terrainCutout(BODY).uCutParams.value.w = 0;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
