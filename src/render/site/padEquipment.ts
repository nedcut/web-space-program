import * as THREE from 'three';
import type { VesselState } from '../../sim/vessel/runtime';

/**
 * Moving launch-pad equipment, drawn with the site material as one mesh (one draw, the site's own program):
 * - four hold-down clamp arms, hinged on pedestals at the flame-hole corners, that reach in to the vessel's aft
 *   skirt while it is held and fall back when the clamps release;
 * - service-tower swing arms that stand at the vessel while it is on the pad and swing clear at ignition;
 * - telescoping umbilical hoods that slide out of each arm to the vessel's skin and retract first.
 * All geometry is in the pad frame (metres: +X east, +Y up, +Z south), like the rest of the site. The ten pieces
 * (4 clamps, 3 arms, 3 hoods) are posed on the CPU into one vertex buffer, and only while one of them moves
 * (a few seconds around liftoff): three instanced meshes cost an extra program and ~0.06 ms on the pad.
 */

/** Pad-frame vertical profile of a vessel standing on the pad (y relative to the deck). */
export interface PadProfile {
  bottom: number;
  top: number;
  /** Largest horizontal extent from the pad axis at height y (0 where nothing is). */
  radiusAt(y: number): number;
  /** Aft-skirt hold point for the clamps: lowest non-engine structure (height, radius). */
  holdY: number;
  holdR: number;
}

const STEP = 0.25;

/**
 * Sample a held vessel's silhouette. While clamped, the vessel's build frame is the pad frame (World.launch
 * uses the same east/up/south basis), so part offsets from the COM translate straight into the pad frame.
 */
export function padVesselProfile(state: VesselState, comLocal: { x: number; y: number; z: number }): PadProfile | null {
  const samples = new Map<number, number>();
  const structural = new Map<number, number>();
  let bottom = Infinity, top = -Infinity, structuralBottom = Infinity;
  const axis = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const p of state.parts) {
    const s = p.def.shape;
    const cx = comLocal.x + p.position.x - state.com.x, cy = comLocal.y + p.position.y - state.com.y, cz = comLocal.z + p.position.z - state.com.z;
    const off = Math.hypot(cx, cz);
    q.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
    axis.set(0, 1, 0).applyQuaternion(q);
    let half: number, r0: number, r1: number;
    if (s.kind === 'cylinder') {
      // Upright parts keep their taper; tilted ones are bounded by their largest radius.
      const upright = Math.abs(axis.y) > 0.9;
      half = upright ? s.height / 2 : Math.max(s.radiusTop, s.radiusBottom) + Math.abs(axis.y) * s.height / 2;
      const flip = axis.y < 0;
      r0 = upright ? (flip ? s.radiusTop : s.radiusBottom) : Math.max(s.radiusTop, s.radiusBottom, (1 - Math.abs(axis.y)) * s.height / 2);
      r1 = upright ? (flip ? s.radiusBottom : s.radiusTop) : r0;
    } else {
      half = s.size.y / 2;
      r0 = r1 = Math.hypot(s.size.x, s.size.z) / 2;
    }
    const y0 = cy - half, y1 = cy + half;
    bottom = Math.min(bottom, y0); top = Math.max(top, y1);
    const engine = !!p.engine || p.def.modules.some((m) => m.type === 'engine');
    if (!engine) structuralBottom = Math.min(structuralBottom, y0);
    for (let k = Math.floor(y0 / STEP); k <= Math.ceil(y1 / STEP); k++) {
      const y = k * STEP, t = Math.min(1, Math.max(0, (y - y0) / Math.max(1e-6, y1 - y0)));
      const r = off + r0 + (r1 - r0) * t;
      samples.set(k, Math.max(samples.get(k) ?? 0, r));
      if (!engine) structural.set(k, Math.max(structural.get(k) ?? 0, r));
    }
  }
  if (!Number.isFinite(bottom)) return null;
  const radiusAt = (y: number) => Math.max(samples.get(Math.floor(y / STEP)) ?? 0, samples.get(Math.ceil(y / STEP)) ?? 0);
  // Grab 0.4 m above the bottom of the lowest tank/skirt (above any engine bells).
  const holdY = Number.isFinite(structuralBottom) ? structuralBottom + 0.4 : bottom + 0.4;
  const holdR = structural.get(Math.round(holdY / STEP)) ?? radiusAt(holdY);
  return { bottom, top, radiusAt, holdY, holdR };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function strut(a: THREE.Vector3, b: THREE.Vector3, s: number, s2 = s): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s, a.distanceTo(b), s2);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Painter: turns object-space pieces into site-material geometry of a given surface key. */
export type PaintFn = (key: 'steel' | 'accent' | 'hazard' | 'grate' | 'cable' | 'darkMetal' | 'white', g: THREE.BufferGeometry) => THREE.BufferGeometry;

/** Clamp pedestals sit at the flame-hole corners (pad frame), hinge height above the deck. */
export const CLAMP = { corner: 6.6, hingeY: 2.4 } as const;
/** Swing-arm hinge positions on the service tower's pad face and the arm reach (pad frame). */
export const ARMS = { x0: -14, z: 0, levels: [8.5, 20, 33], reach: 8.2 } as const;
const HOOD_TRAVEL = 4.2;

function smooth(t: number): number { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); }

export class PadEquipment {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private clampGeo: THREE.BufferGeometry;
  private readonly armGeo: THREE.BufferGeometry;
  private readonly hoodGeo: THREE.BufferGeometry;
  /** Per piece: object-space source geometry, first vertex in the merged buffer, last pose (float32). */
  private pieces: { src: THREE.BufferGeometry; first: number; pose: Float32Array }[] = [];
  private posed = false;
  private readonly paint: PaintFn;
  private clampLength = -1;
  private clampPitch = 0;
  private vesselId: string | null = null;
  /** Seconds since the clamps released / the arms began to retract (−1 = engaged). */
  private clampT = -1;
  private armT = -1;
  /** Per arm: extended (vessel present at that height) and hood travel (m) toward the vessel's skin. */
  private armUse: boolean[] = ARMS.levels.map(() => false);
  private hoodX: number[] = ARMS.levels.map(() => 0);
  private lastT = NaN;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly slideM = new THREE.Matrix4();
  private readonly nm = new THREE.Matrix3();
  private readonly v = new THREE.Vector3();

  constructor(material: THREE.Material, paint: PaintFn) {
    this.paint = paint;
    this.group.name = 'site:padEquipment';
    this.clampGeo = this.clampGeometry(6);
    this.armGeo = this.armGeometry();
    this.hoodGeo = this.hoodGeometry();
    this.mesh = new THREE.Mesh(this.assemble(), material);
    this.mesh.name = 'site:equipment';
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.pose(0);
  }

  /**
   * One buffer for every piece: static attributes copied once, positions/normals written by `pose`. Fixed bounds
   * cover every pose (arms swung or extended, clamps engaged or stowed): the mesh is culled away from the pad and
   * stays outside the vessel's shadow volume in flight (an unculled caster that moves relative to the vessel — the
   * whole site does, in orbit — would redraw the shadow map every frame).
   */
  private assemble(): THREE.BufferGeometry {
    const srcs = [...Array(4).fill(this.clampGeo), ...ARMS.levels.map(() => this.armGeo), ...ARMS.levels.map(() => this.hoodGeo)] as THREE.BufferGeometry[];
    const total = srcs.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const out = new THREE.BufferGeometry();
    let first = 0;
    this.pieces = srcs.map((src) => { const p = { src, first, pose: new Float32Array(16).fill(NaN) }; first += src.getAttribute('position').count; return p; });
    for (const name of Object.keys(this.clampGeo.attributes)) {
      const size = this.clampGeo.getAttribute(name).itemSize, arr = new Float32Array(total * size);
      if (name !== 'position' && name !== 'normal') for (const p of this.pieces) arr.set(p.src.getAttribute(name).array as Float32Array, p.first * size);
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    out.boundingSphere = new THREE.Sphere(new THREE.Vector3(-4, 17, 0), 30);
    return out;
  }

  private merge(parts: [Parameters<PaintFn>[0], THREE.BufferGeometry][]): THREE.BufferGeometry {
    const geos = parts.map(([k, g]) => this.paint(k, g));
    const merged = mergeAll(geos);
    geos.forEach((g) => g.dispose());
    return merged;
  }

  /** Clamp arm of length L along +X from its hinge (origin), claw at the tip. */
  private clampGeometry(L: number): THREE.BufferGeometry {
    return this.merge([
      ['steel', box(L - 0.4, 0.38, 0.42, (L - 0.4) / 2, 0, 0)],
      ['darkMetal', box(L * 0.5, 0.12, 0.5, L * 0.3, 0.25, 0)],
      ['steel', new THREE.CylinderGeometry(0.34, 0.34, 1.0, 12).rotateX(Math.PI / 2)],
      // Claw: a shoe that bears on the aft skirt, with a hazard-striped lip.
      ['darkMetal', box(0.45, 0.95, 0.9, L - 0.22, -0.08, 0)],
      ['hazard', box(0.12, 0.2, 0.95, L - 0.42, 0.34, 0)],
    ]);
  }

  /** Service-arm truss along +X from the tower hinge (origin): chords, verticals, diagonals, deck and hinge drum. */
  private armGeometry(): THREE.BufferGeometry {
    const L = ARMS.reach, w = 0.9, hh = 1.0, parts: [Parameters<PaintFn>[0], THREE.BufferGeometry][] = [];
    for (const [cz, cy] of [[-w, -hh], [w, -hh], [-w, hh], [w, hh]]) parts.push(['accent', strut(V(0, cy, cz), V(L, cy, cz), 0.2)]);
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const x = (L * i) / n;
      parts.push(['accent', strut(V(x, -hh, -w), V(x, hh, -w), 0.12)]);
      parts.push(['accent', strut(V(x, -hh, w), V(x, hh, w), 0.12)]);
      parts.push(['accent', strut(V(x, hh, -w), V(x, hh, w), 0.12)]);
      if (i < n) {
        const xn = (L * (i + 1)) / n;
        parts.push(['accent', strut(V(x, -hh, -w), V(xn, hh, -w), 0.1)]);
        parts.push(['accent', strut(V(x, -hh, w), V(xn, hh, w), 0.1)]);
      }
    }
    parts.push(['grate', box(L, 0.15, 2 * w, L / 2, -hh, 0)]);
    parts.push(['hazard', strut(V(0.2, -hh + 1.05, -w + 0.1), V(L, -hh + 1.05, -w + 0.1), 0.06)]);
    parts.push(['cable', new THREE.CylinderGeometry(0.15, 0.15, L, 6).rotateZ(Math.PI / 2).translate(L / 2, -hh - 0.3, 0.5)]);
    parts.push(['cable', new THREE.CylinderGeometry(0.1, 0.1, L, 6).rotateZ(Math.PI / 2).translate(L / 2, -hh - 0.25, -0.4)]);
    parts.push(['steel', new THREE.CylinderGeometry(0.6, 0.6, 2.6, 10).translate(0.3, 0, 0)]);
    return this.merge(parts);
  }

  /** Umbilical hood (at the origin, facing +X) on a telescoping boom that hides inside the arm when retracted. */
  private hoodGeometry(): THREE.BufferGeometry {
    return this.merge([
      ['steel', box(HOOD_TRAVEL + 0.4, 0.7, 0.9, -(HOOD_TRAVEL + 0.4) / 2 - 0.4, -0.55, 0)],
      ['white', box(1.0, 2.4, 2.4, 0, 0, 0)],
      ['darkMetal', box(0.2, 1.8, 1.8, 0.55, 0, 0)],
      ['cable', new THREE.CylinderGeometry(0.22, 0.22, HOOD_TRAVEL + 0.4, 8).rotateZ(Math.PI / 2).translate(-(HOOD_TRAVEL + 0.4) / 2 - 0.4, -1.1, 0.55)],
    ]);
  }

  /**
   * Advance the equipment for sim time `t`. `vessel` is the active vessel on the pad (or null), with its COM in
   * the pad frame; `held` while the hold-down clamps keep it, `firing` once its launch stage has ignited.
   */
  update(t: number, vessel: { state: VesselState; com: THREE.Vector3; held: boolean; firing: boolean } | null): void {
    const dt = Number.isFinite(this.lastT) ? Math.min(0.25, Math.max(0, t - this.lastT)) : 0;
    this.lastT = t;
    const onPad = !!vessel && vessel.held && Math.hypot(vessel.com.x, vessel.com.z) < 3;
    if (onPad && vessel!.state.id !== this.vesselId) {
      // A new vessel stands on the pad: fit the clamps and arms to it, engaged.
      this.vesselId = vessel!.state.id;
      this.fit(padVesselProfile(vessel!.state, vessel!.com));
      this.clampT = this.armT = -1;
    } else if (!onPad && this.vesselId === null && this.clampT < 0) {
      // Nothing was ever on the pad (Space Center, runway launches): stowed.
      this.clampT = this.armT = 1e3;
    }
    if (this.vesselId !== null && vessel?.state.id === this.vesselId) {
      if (!vessel.held && this.clampT < 0) this.clampT = 0;
      if ((vessel.firing || !vessel.held) && this.armT < 0) this.armT = 0;
    } else if (this.vesselId !== null && !onPad) {
      if (this.clampT < 0) this.clampT = 0;
      if (this.armT < 0) this.armT = 0;
    }
    if (this.clampT >= 0) this.clampT += dt;
    if (this.armT >= 0) this.armT += dt;
    this.pose(dt);
  }

  private fit(profile: PadProfile | null): void {
    const d = CLAMP.corner * Math.SQRT2;
    if (profile) {
      const run = d - (profile.holdR + 0.25), rise = profile.holdY - CLAMP.hingeY;
      const L = Math.hypot(run, rise);
      if (run > 0.6 && L < 16) {
        this.clampPitch = Math.atan2(rise, run);
        if (Math.abs(L - this.clampLength) > 0.05) {
          this.clampGeo.dispose();
          this.clampGeo = this.clampGeometry(L);
          this.mesh.geometry.dispose();
          this.mesh.geometry = this.assemble();
          this.clampLength = L;
        }
      } else this.clampLength = 0;
    } else this.clampLength = 0;
    ARMS.levels.forEach((y, i) => {
      const r = profile && y > profile.bottom + 1 && y < profile.top - 1.4 ? Math.max(profile.radiusAt(y - 1.2), profile.radiusAt(y), profile.radiusAt(y + 1.2)) : -1;
      // The hood's face stops 10 cm short of the skin; the boom can travel HOOD_TRAVEL beyond the arm's end.
      const skin = -ARMS.x0 - r - 0.6;
      this.armUse[i] = r > 0 && skin > ARMS.reach - 0.2 && skin < ARMS.reach + HOOD_TRAVEL;
      this.hoodX[i] = this.armUse[i] ? skin : ARMS.reach;
    });
  }

  private pose(dt: number): void {
    void dt;
    // Clamps: engaged → swing up and back over the pedestal, ending outward and slightly down.
    const engaged = this.clampLength > 0 && this.clampT < 0;
    const fall = this.clampT < 0 ? 0 : smooth(this.clampT / 0.9) * smooth(this.clampT / 0.9);
    const stowPitch = Math.PI * 0.86;
    const pitch = this.clampLength > 0 ? this.clampPitch + (stowPitch - this.clampPitch) * (engaged ? 0 : fall) : stowPitch;
    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? -1 : 1, sz = i % 2 ? 1 : -1;
      const heading = Math.atan2(sz, -sx);
      this.e.set(0, heading, pitch, 'YZX');
      this.q.setFromEuler(this.e);
      this.p.set(sx * CLAMP.corner, CLAMP.hingeY, sz * CLAMP.corner);
      this.set(i, this.m.compose(this.p, this.q, this.one));
    }
    // Arms: hoods slide home over 0.8 s, then the arm swings 85° north over 2.4 s.
    const t = this.armT;
    for (let k = 0; k < ARMS.levels.length; k++) {
      const y = ARMS.levels[k], used = this.armUse[k];
      const slide = !used ? 1 : t < 0 ? 0 : smooth(t / 0.8);
      const swing = !used ? 1 : t < 0 ? 0 : smooth((t - 0.6) / 2.4);
      const yaw = swing * (85 * Math.PI) / 180;
      this.q.setFromAxisAngle(this.p.set(0, 1, 0), yaw);
      this.p.set(ARMS.x0, y, ARMS.z);
      this.m.compose(this.p, this.q, this.one);
      this.set(4 + k, this.m);
      const hx = this.hoodX[k] + (ARMS.reach - 0.6 - this.hoodX[k]) * slide;
      this.m.multiply(this.slideM.makeTranslation(hx, 0, 0));
      this.set(4 + ARMS.levels.length + k, this.m);
    }
    if (this.posed) {
      const g = this.mesh.geometry;
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('normal').needsUpdate = true;
      this.posed = false;
    }
  }

  /** Pose of piece `i` (pad frame), e.g. clamp arms 0–3. */
  pieceMatrix(i: number, target = new THREE.Matrix4()): THREE.Matrix4 { return target.fromArray(this.pieces[i].pose); }

  /**
   * Re-pose a piece only when its matrix changes: a vertex upload marks the shadow-map cache dirty (a full depth
   * pass), so a resting pad must not touch its buffers.
   */
  private set(i: number, m: THREE.Matrix4): void {
    const piece = this.pieces[i], e = m.elements;
    let same = true;
    for (let k = 0; k < 16; k++) if (piece.pose[k] !== Math.fround(e[k])) { same = false; break; }
    if (same) return;
    piece.pose.set(e);
    const g = this.mesh.geometry, pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const sp = piece.src.getAttribute('position'), sn = piece.src.getAttribute('normal');
    this.nm.getNormalMatrix(m);
    for (let j = 0; j < sp.count; j++) {
      this.v.fromBufferAttribute(sp, j).applyMatrix4(m); pos.setXYZ(piece.first + j, this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(sn, j).applyMatrix3(this.nm).normalize(); nor.setXYZ(piece.first + j, this.v.x, this.v.y, this.v.z);
    }
    this.posed = true;
  }

  dispose(): void {
    for (const g of [this.mesh.geometry, this.clampGeo, this.armGeo, this.hoodGeo]) g.dispose();
    this.group.removeFromParent();
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Same attribute set on every piece (position/normal/uv/color/aSite, non-indexed): concatenate.
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geos[0].getAttribute(name).itemSize;
    const total = geos.reduce((n, g) => n + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) { const a = g.getAttribute(name).array as Float32Array; arr.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
