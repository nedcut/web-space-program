import { patchState } from '../../sim/orbit/numericalPrediction';
import { createTerrain } from '../../sim/terrain';
import { CometEffects } from '../planet/CometEffects';
import { AsteroidFieldView, type FieldSource } from './AsteroidFieldView';
import { PlanetRenderer, type PlanetUpdateParams } from '../planet/PlanetRenderer';
import { QUALITY_PRESETS, type QualitySettings } from '../core/quality';
import { SCALE_PRESETS } from '../../sim/bodies/scale';
import { BodyIcons } from './BodyIcons';
import { OrbitStyle } from './OrbitStyle';
import { familyColor, placeLabel, type LabelBox } from './presentation';
import type { Network } from '../../sim/comms/network';
import { concentrationAt } from '../../sim/resources/deposits';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Body } from '../../sim/bodies/types';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { Orbit, TrajectoryPatch, ManeuverNode } from '../../sim/orbit/api';
import { maneuverToInertialDv } from '../../sim/orbit/maneuver';
import { formatDistance, formatDuration } from '../../util/format';
import { elementsToState, periapsisRadius, apoapsisRadius, timeToPeriapsis, timeToApoapsis } from '../../sim/orbit/kepler';
import { add, sub, type Vec3 } from '../../util/vec3';

/**
 * Map view ("tracking" view): conic orbit lines for bodies and vessels, body spheres + icons,
 * an orbit camera around a focus body/vessel spanning metres to light-hours.
 *
 * Precision: every line/sphere is positioned relative to the camera focus in float64 on the CPU each frame,
 * and line vertices are stored relative to their parent body, so float32 is only used for local offsets.
 */
export interface MapUpdate {
  comms?: Network;
  t: number;
  /** Optional stable identity enables focus animation while the object moves. */
  focusId?: string;
  /** Body ancestry to display when the focus is a vessel. */
  referenceBody?: string;
  /** Heliocentric position of the focused object (float64). */
  focus: Vec3;
  /** Active vessel trajectory (patched conics) and its heliocentric position. */
  vessel?: { position: Vec3; patches: TrajectoryPatch[]; nodes: ManeuverNode[] };
  markers?: { body: string; position: Vec3; label: string; color: string }[];
  viewport: { width: number; height: number };
}

export interface ExtraOrbit {
  id: string;
  position: Vec3;
  orbit?: Orbit;
}

/** Navigation target highlight. */
export interface MapTarget {
  kind: 'vessel' | 'body';
  id: string;
}

/** Closest-approach markers: positions relative to `body` at the approach time, plus a label. */
export interface MapApproach {
  body: string;
  positionA: Vec3;
  positionB: Vec3;
  label: string;
}

const EMPTY_MARKERS: MapMarker[] = [];
const EMPTY_PATCHES: TrajectoryPatch[] = [];
const EMPTY_NODES: ManeuverNode[] = [];

const TARGET_COLOR = 0xff4fb8;
const TARGET_CSS = '#ff4fb8';
const EXTRA_COLOR = 0x6fe39a;

function snapshotOrbit(o: Orbit): Orbit {
  return { ...o, stateAtEpoch: o.stateAtEpoch ? { position: { ...o.stateAtEpoch.position }, velocity: { ...o.stateAtEpoch.velocity } } : undefined };
}
function sameOrbit(a: Orbit, b: Orbit) {
  return a.body === b.body && a.a === b.a && a.e === b.e && a.i === b.i && a.lan === b.lan
    && a.argPe === b.argPe && a.m0 === b.m0 && a.epoch === b.epoch && a.mu === b.mu && a.p === b.p
    && (!a.stateAtEpoch && !b.stateAtEpoch || !!a.stateAtEpoch && !!b.stateAtEpoch
      && a.stateAtEpoch.position.x === b.stateAtEpoch.position.x && a.stateAtEpoch.position.y === b.stateAtEpoch.position.y && a.stateAtEpoch.position.z === b.stateAtEpoch.position.z
      && a.stateAtEpoch.velocity.x === b.stateAtEpoch.velocity.x && a.stateAtEpoch.velocity.y === b.stateAtEpoch.velocity.y && a.stateAtEpoch.velocity.z === b.stateAtEpoch.velocity.z);
}

const PATCH_COLORS = [0x5cc8ff, 0xffb35c, 0xd066ff, 0x6fe39a, 0xff6b6b];

type MapMarker = NonNullable<MapUpdate['markers']>[number];

interface BodyVisual {
  body: Body;
  sphere: THREE.Mesh;
  icon: THREE.Sprite;
  orbitLine?: Line2;
  label: HTMLDivElement;
  renderer?: PlanetRenderer;
  resourceMaterial?: THREE.MeshStandardMaterial;
  labelBox: LabelBox;
  iconBox: LabelBox;
  familyColor: number;
}

const iconCache = new Map<string, THREE.CanvasTexture>();
function makeIconTexture(color: string, ring: boolean): THREE.CanvasTexture {
  const key = `${color}:${ring}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(32, 32, ring ? 20 : 14, 0, Math.PI * 2);
  if (ring) g.stroke();
  else g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(key, t);
  return t;
}

/** Closest-approach marker: a ring with four inward ticks. */
function makeApproachTexture(color: string): THREE.CanvasTexture {
  const key = `ca:${color}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(32, 32, 18, 0, Math.PI * 2);
  g.stroke();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 18, 32 + Math.sin(a) * 18);
    g.lineTo(32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(key, t);
  return t;
}

function colorOf(b: Body): THREE.Color {
  const c = b.surface.colors[0] ?? [0.6, 0.6, 0.6];
  return new THREE.Color(c[0], c[1], c[2]);
}

/** Sample a conic in its parent's frame. Ellipses: full ring; hyperbolas: limited to SOI radius. */
export function sampleConic(o: Orbit, soi: number, t0: number, t1: number | null, segments = 256): Vec3[] {
  const pts: Vec3[] = [];
  if (o.e < 1 && t1 === null) {
    const T = 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu);
    for (let i = 0; i <= segments; i++) pts.push(elementsToState(o, t0 + (T * i) / segments).position);
    return pts;
  }
  let end = t1 ?? t0 + (o.e < 1 ? 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu) : 1e7);
  if (end <= t0) end = t0 + 1;
  // Sample uniformly in time but refine near periapsis by sampling in sqrt-time space for hyperbolas.
  for (let i = 0; i <= segments; i++) {
    const t = t0 + ((end - t0) * i) / segments;
    const p = elementsToState(o, t).position;
    if (Math.hypot(p.x, p.y, p.z) > soi * 1.02 && i > 0) break;
    pts.push(p);
  }
  return pts;
}

export class MapView {
  private field?: AsteroidFieldView;
  private comets = new Map<string, CometEffects>();
  private au = 149597870700;
  readonly scene = new THREE.Scene();
  private bodyIcons: BodyIcons;
  private orbitStyle = new OrbitStyle();
  private projected = new THREE.Vector3();
  private labelBoxes: LabelBox[] = [];
  private iconBoxes: LabelBox[] = [];
  private labelCount = 0;
  private orderedBodies: BodyVisual[] = [];
  private hoverBody: BodyVisual | null = null;
  private tooltip: HTMLDivElement;
  private breadcrumb: HTMLDivElement;
  private soi = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0x9cbfdc, transparent: true, opacity: .035, side: THREE.DoubleSide, depthWrite: false }));
  private renderFocus: Vec3 = { x: 0, y: 0, z: 0 };
  private previousFocus: Vec3 = { x: 0, y: 0, z: 0 };
  private focusOffset: Vec3 = { x: 0, y: 0, z: 0 };
  private focusIdentity = '';
  private renderedDistance = 0;
  private lastFrame = 0;
  private sunId: string;
  private sunGlow: THREE.Sprite;
  private planetParams: PlanetUpdateParams;
  private commsNodes = new Map<string, Vec3>();
  private linkColor = new THREE.Color();
  private commsLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false }));
  readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 1e15);
  /** Spherical camera coords around focus. */
  yaw = 0.6;
  pitch = 0.5;
  distance = 2e7;
  resourceOverlayEnabled = false;
  private resourceTextures = new Map<string, THREE.DataTexture>();
  private resourceBodies = new Set<string>();
  private bodies = new Map<string, BodyVisual>();
  private vesselLines: Line2[] = [];
  private vesselIcon: THREE.Sprite;
  private nodeIcons: THREE.Sprite[] = [];
  private markerPool: MapMarker[] = [];
  private markerClock = -Infinity;
  private markerCount = 0;
  private gizmoOrbit?: Orbit;
  private gizmoTime = NaN;
  private gizmoState?: ReturnType<typeof elementsToState>;
  private gizmoDirs?: Record<'prograde' | 'normal' | 'radial', Vec3>;
  private gizmoBase = new THREE.Vector3();
  private gizmoDirection = new THREE.Vector3();
  private markerVisuals: { icon: THREE.Sprite; label: HTMLDivElement; box: LabelBox }[] = [];
  private lastUpdate: MapUpdate | null = null;
  private frameUpdate: MapUpdate = { t: 0, focus: this.renderFocus, viewport: { width: 1, height: 1 } };
  private gizmo: { arrow: THREE.ArrowHelper; icon: THREE.Sprite; axis: 'prograde' | 'normal' | 'radial'; sign: number }[] = [];

  private project(p: Vec3, body: string, u: MapUpdate) {
    const relative = sub(add(this.ephem.getBodyState(body, u.t).position, p), u.focus);
    return new THREE.Vector3(relative.x, relative.y, relative.z).project(this.camera);
  }

  /** Maneuver sprites are picked separately so camera drag and target selection remain independent. */
  pickManeuver(x: number, y: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    this.scene.updateMatrixWorld(true);
    const objects = [...this.gizmo.filter(g => g.icon.visible).map(g => g.icon), ...this.nodeIcons.filter(s => s.visible)];
    const hit = ray.intersectObjects(objects, false)[0]?.object;
    if (!hit) return null;
    const handle = this.gizmo.find(g => g.icon === hit);
    return { id: handle ? this.lastUpdate?.vessel?.nodes[0]?.id : hit.userData.nodeId as number,
      axis: handle?.axis, sign: handle?.sign ?? 1 };
  }

  private updateMarkers(u: MapUpdate) {
    if (!u.markers?.length && !u.vessel?.patches.length && !u.vessel?.nodes.length) {
      for (const vis of this.markerVisuals) { vis.icon.visible = false; vis.label.style.display = 'none'; }
      return;
    }
    const markers = this.markerPool;
    let count = 0;
    const refreshText = Math.floor(u.t) !== this.markerClock;
    this.markerClock = Math.floor(u.t);
    for (const m of u.markers ?? EMPTY_MARKERS) {
      let pooled = markers[count++];
      if (!pooled) { pooled = { body: m.body, position: m.position, label: m.label, color: m.color }; markers.push(pooled); }
      pooled.body = m.body; pooled.position = m.position; pooled.label = m.label; pooled.color = m.color;
    }
    for (const patch of u.vessel?.patches ?? EMPTY_PATCHES) if (patch.endReason === 'soiEnter' || patch.endReason === 'soiExit') {
      let pooled = markers[count++];
      if (!pooled) { pooled = { body: '', position: { x: 0,y: 0,z: 0 }, label: '',color: '#ffb35c' }; markers.push(pooled); }
      pooled.body = patch.orbit.body;
      pooled.position = patchState(patch, patch.endTime).position;
      if (refreshText || count > this.markerCount) pooled.label = `${patch.endReason === 'soiEnter' ? 'Enter' : 'Exit'} ${this.bodies.get(patch.endReason === 'soiExit' ? patch.orbit.body : patch.nextBody ?? patch.orbit.body)?.body.name ?? patch.nextBody} SOI · T−${formatDuration(patch.endTime-u.t)}`;
      pooled.color = '#ffb35c';
    }
    for (const node of u.vessel?.nodes ?? EMPTY_NODES) {
      let patch: TrajectoryPatch | undefined;
      for (const candidate of u.vessel!.patches) if (node.time >= candidate.startTime && node.time <= candidate.endTime+1e-6) { patch = candidate; break; }
      if (!patch) continue;
      let pooled = markers[count++];
      if (!pooled) { pooled = { body: '', position: { x: 0,y: 0,z: 0 }, label: '', color: '#5cc8ff' }; markers.push(pooled); }
      pooled.body = patch.orbit.body; pooled.position = patchState(patch, node.time).position;
      if (refreshText || count > this.markerCount) pooled.label = `Node T−${formatDuration(node.time-u.t)}`;
      pooled.color = '#5cc8ff';
    }
    this.markerCount = count;
    while (this.markerVisuals.length < count) {
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false }));
      icon.scale.setScalar(0.018); icon.renderOrder = 12; this.scene.add(icon);
      const label = document.createElement('div');
      Object.assign(label.style, { position: 'absolute', font: '11px system-ui', whiteSpace: 'nowrap', textShadow: '0 0 4px black', transform: 'translate(12px,-50%)' });
      this.labels.appendChild(label); this.markerVisuals.push({ icon, label, box: { x: 0, y: 0, width: 0, height: 18 } });
    }
    for (let i = 0; i < this.markerVisuals.length; i++) {
      const vis = this.markerVisuals[i], m = i < count ? markers[i] : undefined; vis.icon.visible = !!m; vis.label.style.display = 'none';
      if (!m) continue;
      vis.icon.material.map = makeIconTexture(m.color, true);
      const parent = this.ephem.getBodyState(m.body, u.t).position;
      vis.icon.position.set(parent.x+m.position.x-u.focus.x,parent.y+m.position.y-u.focus.y,parent.z+m.position.z-u.focus.z);
      const p = this.projected.copy(vis.icon.position).project(this.camera);
      if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1) {
        vis.box.x = (p.x*.5+.5)*u.viewport.width+12; vis.box.y = (-p.y*.5+.5)*u.viewport.height-9;
        vis.box.width = m.label.length*6;
        if (!placeLabel(vis.box, this.labelBoxes, this.labelCount)) continue;
        this.labelBoxes[this.labelCount++] = vis.box;
        vis.label.textContent = m.label; vis.label.style.color = m.color; vis.label.style.display = 'block';
        vis.label.style.left = `${(p.x * .5 + .5) * u.viewport.width}px`;
        vis.label.style.top = `${(-p.y * .5 + .5) * u.viewport.height}px`;
      }
    }
  }

  private updateGizmo(u: MapUpdate) {
    const node = u.vessel?.nodes[0];
    const patch = node ? u.vessel?.patches.find(p => node.time >= p.startTime && node.time <= p.endTime + 1e-6) : null;
    if (!node && !this.gizmo.length) return;
    if (!this.gizmo.length) for (const [axis, color] of [['prograde', '#d8ff3c'], ['normal', '#d066ff'], ['radial', '#4fd8ff']] as const) for (const sign of [-1, 1]) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color);
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture(color, false), sizeAttenuation: false, depthTest: false }));
      icon.scale.setScalar(.022); icon.renderOrder = 15;
      this.scene.add(arrow, icon); this.gizmo.push({ arrow, icon, axis, sign });
    }
    for (const g of this.gizmo) { g.arrow.visible = g.icon.visible = !!patch; }
    if (!node || !patch) return;
    if (this.gizmoTime !== node.time || !this.gizmoOrbit || !sameOrbit(this.gizmoOrbit, patch.orbit)) {
      this.gizmoTime = node.time; this.gizmoOrbit = snapshotOrbit(patch.orbit);
      this.gizmoState = patchState(patch, node.time);
      this.gizmoDirs = { prograde: maneuverToInertialDv(this.gizmoState, { prograde: 1, normal: 0, radial: 0 }), normal: maneuverToInertialDv(this.gizmoState, { prograde: 0, normal: 1, radial: 0 }), radial: maneuverToInertialDv(this.gizmoState, { prograde: 0, normal: 0, radial: 1 }) };
    }
    const position = this.gizmoState!.position, parent = this.ephem.getBodyState(patch.orbit.body, u.t).position;
    const base = this.gizmoBase.set(parent.x+position.x-u.focus.x,parent.y+position.y-u.focus.y,parent.z+position.z-u.focus.z);
    const size = base.distanceTo(this.camera.position) * .07;
    for (const g of this.gizmo) {
      const d = this.gizmoDirs![g.axis], direction = this.gizmoDirection.set(d.x,d.y,d.z).multiplyScalar(g.sign);
      g.arrow.position.copy(base); g.arrow.setDirection(direction); g.arrow.setLength(size, size * .2, size * .08);
      g.icon.position.copy(base).addScaledVector(direction, size);
    }
  }
  private apPeIcons: THREE.Sprite[] = [];
  private apsisTimes = new Float64Array(2);
  private apsisColors = ['#6fe39a', '#5cc8ff'];
  private labels: HTMLDivElement;
  private materials: LineMaterial[] = [];
  private sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
  private lastPatches: TrajectoryPatch[] = [];
  private extraOrbits: ExtraOrbit[] = [];
  private extras = new Map<string, { icon: THREE.Sprite; line?: Line2; orbit?: Orbit; targeted: boolean }>();
  private target: MapTarget | null = null;
  private highlightedBody: { vis: BodyVisual; color: number; width: number } | null = null;
  private approach: MapApproach | null = null;
  private approachIcons: THREE.Sprite[];
  private approachLabel: HTMLDivElement;

  /** Cached body-fixed field texture; callers supply only surveyed bodies. */
  setResourceOverlay(surveyedBodies: readonly string[], enabled = true) {
    this.resourceOverlayEnabled = enabled;
    this.resourceBodies = new Set(enabled ? surveyedBodies : []);
    for (const [id, vis] of this.bodies) {
      if (!vis.body.solidSurface) continue;
      const mat = vis.resourceMaterial ??= vis.sphere.material as THREE.MeshStandardMaterial;
      vis.sphere.material = mat;
      const show = this.resourceBodies.has(id);
      if (show && !this.resourceTextures.has(id)) {
        const width = 256, height = 128, bytes = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          // SphereGeometry's UV convention, rotated from Y-up to body-fixed Z-up.
          const phi = (x + 0.5) / width * Math.PI * 2;
          const theta = (1 - (y + 0.5) / height) * Math.PI;
          const c = concentrationAt(vis.body, { x: -Math.cos(phi) * Math.sin(theta), y: -Math.sin(phi) * Math.sin(theta), z: Math.cos(theta) });
          const i = (y * width + x) * 4;
          bytes[i] = Math.round(30 + c * 225); bytes[i + 1] = Math.round(65 + c * 155);
          bytes[i + 2] = Math.round(200 - c * 170); bytes[i + 3] = 255;
        }
        const texture = new THREE.DataTexture(bytes, width, height);
        texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter; texture.wrapS = THREE.RepeatWrapping; texture.needsUpdate = true;
        this.resourceTextures.set(id, texture);
      }
      vis.sphere.visible = show;
      if (vis.renderer) vis.renderer.root.visible = !show;
      mat.map = show ? this.resourceTextures.get(id)! : null;
      mat.color.copy(show ? new THREE.Color(1, 1, 1) : colorOf(vis.body));
      mat.emissive.setHex(show ? 0xffffff : 0); mat.emissiveMap = mat.map; mat.emissiveIntensity = show ? 0.7 : 0;
      mat.needsUpdate = true;
    }
  }

  /** Highlight the navigation target (its orbit and icon); null clears. */
  setTarget(t: MapTarget | null) {
    if (this.target?.id === t?.id && this.target?.kind === t?.kind) return;
    this.target = t;
    this.field?.select(t?.kind === 'body' ? t.id : null);
    if (this.highlightedBody) {
      const { vis, color, width } = this.highlightedBody;
      if (vis.orbitLine) {
        vis.orbitLine.material.color.setHex(color);
        vis.orbitLine.material.linewidth = width;
      }
      this.highlightedBody = null;
    }
    if (t?.kind === 'body') {
      const vis = this.bodies.get(t.id);
      if (vis?.orbitLine) {
        this.highlightedBody = { vis, color: vis.orbitLine.material.color.getHex(), width: vis.orbitLine.material.linewidth };
        vis.orbitLine.material.color.setHex(TARGET_COLOR);
        vis.orbitLine.material.linewidth = 2.2;
      }
    }
  }

  /** Closest-approach markers (null hides them). */
  setApproach(a: MapApproach | null) {
    this.approach = a;
  }

  /** Additional fleet conics and icons; positions are heliocentric float64, conics body-relative. */
  setExtraOrbits(list: ExtraOrbit[]) { this.extraOrbits = list; }

  /** Pick visible body/vessel icons at normalized device coordinates, for map double-click focus. */
  pick(x: number, y: number): { kind: 'body' | 'vessel'; id: string } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const candidates: { object: THREE.Object3D; kind: 'body' | 'vessel'; id: string }[] = [];
    for (const [id, vis] of this.bodies) {
      if (!vis.sphere.userData.mapVisible) continue;
      if (vis.icon.visible) {
        this.projected.copy(vis.icon.position).project(this.camera);
        const w = this.lastUpdate?.viewport.width ?? 1, h = this.lastUpdate?.viewport.height ?? 1;
        if (this.projected.z < 1 && Math.hypot((this.projected.x-x)*w/2, (this.projected.y-y)*h/2) < 12) return { kind: 'body', id };
      } else candidates.push({ object: vis.sphere, kind: 'body', id });
    }
    for (const [id, vis] of this.extras) candidates.push({ object: vis.icon, kind: 'vessel', id });
    this.scene.updateMatrixWorld(true);
    const hits = ray.intersectObjects(candidates.map((c) => c.object), false);
    const hit = candidates.find((c) => c.object === hits[0]?.object);
    if (hit) return { kind: hit.kind, id: hit.id };
    const asteroid = this.field?.pick(x, y, this.camera);
    return asteroid ? { kind: 'body' as const, id: asteroid } : null;
  }

  private removeLine(line: Line2) {
    this.scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    this.materials = this.materials.filter((m) => m !== line.material);
  }

  private updateExtras(u: MapUpdate) {
    for (const [id, vis] of this.extras) {
      let found = false;
      for (const orbit of this.extraOrbits) if (orbit.id === id) { found = true; break; }
      if (found) continue;
      if (vis.line) this.removeLine(vis.line);
      this.scene.remove(vis.icon);
      vis.icon.material.dispose();
      this.extras.delete(id);
    }
    for (const item of this.extraOrbits) {
      let vis = this.extras.get(item.id);
      if (!vis) {
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture('#6fe39a', true), sizeAttenuation: false, depthTest: false }));
        icon.scale.setScalar(0.025);
        icon.renderOrder = 11;
        this.scene.add(icon);
        vis = { icon, targeted: false };
        this.extras.set(item.id, vis);
      }
      const targeted = this.target?.kind === 'vessel' && this.target.id === item.id;
      if (targeted !== vis.targeted) {
        vis.targeted = targeted;
        vis.icon.material.map = makeIconTexture(targeted ? TARGET_CSS : '#6fe39a', true);
        vis.icon.material.needsUpdate = true;
        if (vis.line) { vis.line.material.color.setHex(targeted ? TARGET_COLOR : EXTRA_COLOR); vis.line.material.linewidth = targeted ? 2.2 : 1.6; }
      }
      const o = item.orbit;
      // Orbit elements are stable on rails; callers can throttle conic updates in physics.
      if (!!o !== !!vis.orbit || (o && vis.orbit && !sameOrbit(o, vis.orbit))) {
        if (vis.line) this.removeLine(vis.line);
        vis.line = undefined;
        if (o) {
          const pts = sampleConic(o, this.bodies.get(o.body)?.body.soi ?? Infinity, u.t, null);
          if (pts.length > 1) vis.line = vis.targeted ? this.makeLine(pts, TARGET_COLOR, 2.2, 0.95) : this.makeLine(pts, EXTRA_COLOR, 1.6, 0.8);
        }
        vis.orbit = o ? snapshotOrbit(o) : undefined;
      }
      this.place(vis.icon, item.position, u.focus);
      if (vis.line && o) this.place(vis.line, this.ephem.getBodyState(o.body, u.t).position, u.focus);
    }
  }

  constructor(
    bodies: Map<string, Body>,
    private ephem: Ephemeris,
    labelHost: HTMLElement,
    private quality: QualitySettings = QUALITY_PRESETS.medium,
    field?: FieldSource,
  ) {
    this.au = bodies.get('earth')?.orbit?.a ?? 149597870700;
    if (field) this.field = new AsteroidFieldView(field, bodies.get('sun')!.gm, this.au / 149597870700, this.scene);
    this.scene.background = new THREE.Color(0x050914);
    this.sunId = [...bodies.values()].find(b => b.kind === 'star')!.id;
    const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
    const glowContext = glowCanvas.getContext('2d')!;
    const glow = glowContext.createRadialGradient(64,64,0,64,64,64);
    glow.addColorStop(0,'rgba(255,244,208,1)'); glow.addColorStop(.15,'rgba(255,216,135,.6)');
    glow.addColorStop(.45,'rgba(255,178,85,.12)'); glow.addColorStop(1,'rgba(255,158,64,0)');
    glowContext.fillStyle = glow; glowContext.fillRect(0,0,128,128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.sunGlow);
    this.bodyIcons = new BodyIcons(bodies.size); this.scene.add(this.bodyIcons.mesh);
    this.soi.visible = false; this.scene.add(this.soi);
    this.planetParams = { camera: this.camera, origin: this.renderFocus, bodyPosition: this.renderFocus,
      bodyRotation: { x: 0, y: 0, z: 0, w: 1 }, sunPosition: this.renderFocus, dt: 0 };
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    this.scene.add(this.sunLight);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    labelHost.appendChild(this.labels);

    this.tooltip = document.createElement('div');
    Object.assign(this.tooltip.style, { position: 'absolute', display: 'none', padding: '10px 14px', background: '#0a1525ee', border: '1px solid #7997ba55', borderRadius: '8px', color: '#e2edf8', font: '12px system-ui', whiteSpace: 'pre-line', lineHeight: '1.7', boxShadow: '0 6px 24px #0008' });
    this.labels.appendChild(this.tooltip);
    this.breadcrumb = document.createElement('div');
    Object.assign(this.breadcrumb.style, { position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', color: '#c8d9ee', background: '#0a1525bb', border: '1px solid #7997ba33', borderRadius: '20px', font: '12px system-ui', letterSpacing: '.08em' });
    this.labels.appendChild(this.breadcrumb);
    for (const b of bodies.values()) {
      if (b.kind === 'comet') { const fx = new CometEffects(); this.comets.set(b.id, fx); this.scene.add(fx.root); }
      const isStar = b.kind === 'star';
      const mat = isStar
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.75).multiplyScalar(3) })
        : new THREE.MeshStandardMaterial({ color: colorOf(b), roughness: 0.9 });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
      if (b.surface.preset === 'irregular') {
        const terrain = createTerrain(b), points = sphere.geometry.getAttribute('position'), p = new THREE.Vector3();
        for (let i = 0; i < points.count; i++) {
          p.fromBufferAttribute(points, i).normalize();
          p.multiplyScalar(1 + terrain.heightAt(p.x, p.y, p.z) / b.radius);
          points.setXYZ(i, p.x, p.y, p.z);
        }
        sphere.geometry.computeVertexNormals(); sphere.geometry.computeBoundingSphere();
      }
      sphere.scale.setScalar(b.radius);
      this.scene.add(sphere);
      const icon = new THREE.Sprite(new THREE.SpriteMaterial());
      icon.scale.setScalar(0.022);
      icon.renderOrder = 10;
      // Body icons render in one instanced draw; sprite is retained as a position proxy.
      const label = document.createElement('div');
      label.textContent = b.name;
      Object.assign(label.style, { position: 'absolute', font: '12px system-ui', color: '#cfd8e6', textShadow: '0 1px 5px #000', whiteSpace: 'nowrap', transform: 'translate(10px,-50%)' });
      this.labels.appendChild(label);
      sphere.visible = false;
      const vis: BodyVisual = { body: b, sphere, icon, label, familyColor: familyColor(b, bodies),
        labelBox: { x: 0, y: 0, width: b.name.length * 7 + 8, height: 18 }, iconBox: { x: 0, y: 0, width: 14, height: 14 } };
      if (b.orbit && b.parent) {
        const parent = bodies.get(b.parent)!;
        const o: Orbit = { ...b.orbit, body: b.parent, mu: parent.gm + b.gm, m0: b.orbit.meanAnomalyAtEpoch };
        // Body orbits are sampled via the ephemeris (handles parentEquator frames).
        const T = b.orbitalPeriod ?? 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu);
        const pts: Vec3[] = [];
        for (let i = 0; i <= 256; i++) pts.push(this.ephem.getRelativeState(b.id, (T * i) / 256).position);
        vis.orbitLine = this.makeLine(pts, vis.familyColor, b.kind === 'moon' ? 1 : 1.3, b.kind === 'moon' ? .32 : .55);
      }
      this.bodies.set(b.id, vis);
    }
    this.orderedBodies = [...this.bodies.values()].sort((a, b) => b.body.radius - a.body.radius);
    this.labelBoxes = this.orderedBodies.map(v => v.labelBox);
    this.iconBoxes = this.orderedBodies.map(v => v.iconBox);
    this.vesselIcon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture('#ffffff', true), sizeAttenuation: false, depthTest: false }));
    this.vesselIcon.scale.setScalar(0.028);
    this.vesselIcon.renderOrder = 11;
    this.scene.add(this.vesselIcon);
    this.approachIcons = ['#ffffff', TARGET_CSS].map((c) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeApproachTexture(c), sizeAttenuation: false, depthTest: false }));
      s.scale.setScalar(0.03);
      s.renderOrder = 14;
      s.visible = false;
      this.scene.add(s);
      return s;
    });
    this.approachLabel = document.createElement('div');
    Object.assign(this.approachLabel.style, {
      position: 'absolute', font: '11px system-ui', color: '#ffd0ec', textShadow: '0 0 3px #000', whiteSpace: 'nowrap',
      transform: 'translate(12px,-50%)', display: 'none',
    });
    this.labels.appendChild(this.approachLabel);
  }

  private updateApproach(u: MapUpdate) {
    const a = this.approach;
    const show = !!a && this.bodies.has(a.body);
    for (const s of this.approachIcons) s.visible = show;
    this.approachLabel.style.display = 'none';
    if (!a || !show) return;
    const bp = this.ephem.getBodyState(a.body, u.t).position;
    this.place(this.approachIcons[0], { x: bp.x + a.positionA.x, y: bp.y + a.positionA.y, z: bp.z + a.positionA.z }, u.focus);
    this.place(this.approachIcons[1], { x: bp.x + a.positionB.x, y: bp.y + a.positionB.y, z: bp.z + a.positionB.z }, u.focus);
    const v = this.projected.copy(this.approachIcons[0].position).project(this.camera);
    if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
      this.approachLabel.textContent = a.label;
      this.approachLabel.style.display = 'block';
      this.approachLabel.style.left = `${(v.x * 0.5 + 0.5) * u.viewport.width}px`;
      this.approachLabel.style.top = `${(-v.y * 0.5 + 0.5) * u.viewport.height}px`;
    }
  }

  private makeLine(pts: Vec3[], color: number, width: number, opacity = 1): Line2 {
    const pos = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3));
    const geom = new LineGeometry();
    geom.setPositions(pos);
    const mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, depthWrite: false });
    this.orbitStyle.configure(mat, width >= 1.8);
    this.materials.push(mat);
    const line = new Line2(geom, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  private place(obj: THREE.Object3D, helio: Vec3, focus: Vec3) {
    obj.position.set(helio.x-focus.x, helio.y-focus.y, helio.z-focus.z);
  }

  /** Rebuild vessel trajectory lines when the patch set changes. */
  private updateVesselLines(patches: TrajectoryPatch[], bodies: Map<string, BodyVisual>) {
    let unchanged = patches.length === this.lastPatches.length;
    for (let i = 0; unchanged && i < patches.length; i++) {
      const p = patches[i], previous = this.lastPatches[i];
      unchanged = p.startTime === previous.startTime && p.endTime === previous.endTime && p.endReason === previous.endReason
        && p.samples === previous.samples && sameOrbit(p.orbit, previous.orbit);
    }
    if (unchanged) return;
    this.lastPatches = patches.map(p => ({ ...p, orbit: snapshotOrbit(p.orbit) }));
    for (const l of this.vesselLines) {
      this.removeLine(l);
    }
    this.vesselLines = patches.map((p, i) => {
      const soi = bodies.get(p.orbit.body)?.body.soi ?? Infinity;
      const closed = p.orbit.e < 1 && (p.endReason === 'horizon' || p.endTime - p.startTime > 2 * Math.PI * Math.sqrt(p.orbit.a ** 3 / p.orbit.mu));
      const pts = p.samples ? p.samples.map(s => s.position) : sampleConic(p.orbit, soi, p.startTime, closed ? null : p.endTime, 384);
      if (pts.length === 1) pts.push(pts[0]);
      const line = this.makeLine(pts, PATCH_COLORS[i % PATCH_COLORS.length], i === 0 ? 2.4 : 1.8);
      line.material.dashed = i > 0;
      line.material.dashSize = 14; line.material.gapSize = 8;
      const total = line.geometry.getAttribute('instanceDistanceEnd');
      const length = total.getX(total.count - 1);
      line.material.dashScale = length > 0 ? 600 / length : 1;
      line.userData.body = p.orbit.body;
      return line;
    });
  }

  update(u: MapUpdate) {
    const now = performance.now();
    const dt = this.lastFrame ? Math.min((now-this.lastFrame)/1000, .1) : 1;
    this.lastFrame = now;
    const identity = u.focusId ?? '';
    const jump = Math.hypot(u.focus.x-this.previousFocus.x, u.focus.y-this.previousFocus.y, u.focus.z-this.previousFocus.z);
    if (this.lastUpdate && (identity !== this.focusIdentity || (!identity && jump > this.distance * .5))) {
      this.focusOffset.x += this.previousFocus.x-u.focus.x;
      this.focusOffset.y += this.previousFocus.y-u.focus.y;
      this.focusOffset.z += this.previousFocus.z-u.focus.z;
    }
    const blend = 1-Math.exp(-dt*6);
    this.focusOffset.x *= 1-blend; this.focusOffset.y *= 1-blend; this.focusOffset.z *= 1-blend;
    this.previousFocus.x = u.focus.x; this.previousFocus.y = u.focus.y; this.previousFocus.z = u.focus.z;
    this.focusIdentity = identity;
    this.renderFocus.x = u.focus.x+this.focusOffset.x; this.renderFocus.y = u.focus.y+this.focusOffset.y; this.renderFocus.z = u.focus.z+this.focusOffset.z;
    this.renderedDistance = this.renderedDistance ? Math.exp(Math.log(this.renderedDistance) + (Math.log(this.distance)-Math.log(this.renderedDistance))*blend) : this.distance;
    // The existing marker and picking paths use the same animated floating origin.
    this.lastUpdate = this.frameUpdate;
    Object.assign(this.frameUpdate, u); this.frameUpdate.focus = this.renderFocus; u = this.frameUpdate;
    const { t, focus } = u;
    this.field?.update(t, focus);
    for (const [id, fx] of this.comets) fx.update(this.ephem.getBodyState(id, t).position, this.ephem.getBodyState('sun', t).position, focus, this.bodies.get(id)!.body.radius, this.au, t, true);
    if (!this.commsLines.parent) { this.scene.add(this.commsLines); this.commsLines.renderOrder = 5; }
    this.commsLines.visible = !!u.comms;
    if (u.comms) {
      const nodes = this.commsNodes; nodes.clear();
      for (const node of u.comms.nodes) nodes.set(node.id, node.position);
      const count = u.comms.links.length * 2;
      let position = this.commsLines.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      let color = this.commsLines.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!position || position.count < count) {
        this.commsLines.geometry.dispose();
        this.commsLines.geometry = new THREE.BufferGeometry();
        const capacity = Math.max(16, count * 2);
        position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.commsLines.geometry.setAttribute('position', position);
        this.commsLines.geometry.setAttribute('color', color);
      }
      let index = 0;
      for (const link of u.comms.links) {
        this.linkColor.setHSL(link.strength * 0.33, 0.85, 0.55);
        for (let endpoint = 0; endpoint < 2; endpoint++) {
          const p = nodes.get(endpoint === 0 ? link.a : link.b)!;
          position.setXYZ(index, p.x - focus.x, p.y - focus.y, p.z - focus.z);
          color!.setXYZ(index++, this.linkColor.r, this.linkColor.g, this.linkColor.b);
        }
      }
      position.needsUpdate = true; color!.needsUpdate = true;
      this.commsLines.geometry.setDrawRange(0, count);
      this.commsLines.frustumCulled = false;
    }
    for (const m of this.materials) m.resolution.set(u.viewport.width, u.viewport.height);
    this.camera.aspect = u.viewport.width / u.viewport.height;

    // Camera around focus (focus is at the scene origin).
    const cp = Math.cos(this.pitch);
    this.camera.position.set(Math.cos(this.yaw) * cp * this.renderedDistance, Math.sin(this.yaw) * cp * this.renderedDistance, Math.sin(this.pitch) * this.renderedDistance);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(.1, this.renderedDistance * 1e-6);
    this.camera.far = this.renderedDistance * 1e6;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const sunPosition = this.ephem.getBodyState(this.sunId, t).position;
    this.place(this.sunLight, sunPosition, focus);
    this.place(this.sunGlow, sunPosition, focus);
    const glowSize = Math.max(this.bodies.get(this.sunId)!.body.radius*5, this.sunGlow.position.distanceTo(this.camera.position)*.025);
    this.sunGlow.scale.setScalar(glowSize);
    const v = this.projected;
    const w = u.viewport.width, h = u.viewport.height;
    let iconCount = 0, labelCount = 0, occluderCount = 0;
    this.orbitStyle.uniforms.mapDistance.value = this.renderedDistance;
    this.orbitStyle.uniforms.mapVessel.value.set(u.vessel ? u.vessel.position.x-focus.x : 0,
      u.vessel ? u.vessel.position.y-focus.y : 0, u.vessel ? u.vessel.position.z-focus.z : 0);
    const params = this.planetParams;
    params.origin = focus; params.sunPosition = sunPosition; params.time = t; params.dt = dt; params.viewportHeight = h;
    for (const vis of this.orderedBodies) {
      const pos = this.ephem.getBodyState(vis.body.id, t).position;
      this.place(vis.sphere, pos, focus);
      this.place(vis.icon, pos, focus);
      const rotation = this.ephem.bodyRotation(vis.body.id, t);
      vis.sphere.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      if (vis.body.surface.preset !== 'irregular') vis.sphere.rotateX(Math.PI / 2);
      if (vis.orbitLine && vis.body.parent) this.place(vis.orbitLine, this.ephem.getBodyState(vis.body.parent, t).position, focus);
      const dist = vis.sphere.position.distanceTo(this.camera.position);
      const angular = vis.body.radius / Math.max(dist, 1);
      const orbitPx = vis.body.orbit ? vis.body.orbit.a / Math.max(dist, 1) * h / (2*Math.tan(this.camera.fov*Math.PI/360)) : 1e9;
      const parent = vis.body.parent ? this.bodies.get(vis.body.parent) : undefined;
      const parentDistance = parent ? Math.hypot(this.camera.position.x-(this.ephem.getBodyState(parent.body.id,t).position.x-focus.x), this.camera.position.y-(this.ephem.getBodyState(parent.body.id,t).position.y-focus.y), this.camera.position.z-(this.ephem.getBodyState(parent.body.id,t).position.z-focus.z)) : 0;
      const visible = vis.body.kind !== 'moon' || (orbitPx > 24 && parentDistance < parent!.body.soi * 8) || vis.body.id === identity;
      vis.sphere.userData.mapVisible = visible;
      const resolved = visible && angular*h > 1.5;
      if (resolved && !vis.renderer) {
        const quality = { ...QUALITY_PRESETS.low, bakedTextureWidth: this.quality.bakedTextureWidth };
        const sunRadius = this.bodies.get(this.sunId)!.body.radius;
        const scale = { ...SCALE_PRESETS.standard, s: sunRadius / 696340000 };
        vis.renderer = new PlanetRenderer(vis.body, vis.body.solidSurface ? createTerrain(vis.body) : null,
          { farOnly: true, quality, scale, registerUniforms: false, sunRadiance: 4 });
        // Flight's HDR compositor transforms these shaders; direct map rendering needs its own output transform.
        vis.renderer.root.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!(material instanceof THREE.ShaderMaterial) || material.fragmentShader.includes('colorspace_fragment')) continue;
            const premultiplied = material.blending === THREE.CustomBlending && material.blendSrc === THREE.OneFactor;
            material.fragmentShader = material.fragmentShader.replace(/\}\s*$/, `
              ${premultiplied ? 'gl_FragColor.rgb /= max(gl_FragColor.a, .00001);' : ''}
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
              ${premultiplied ? 'gl_FragColor.rgb *= gl_FragColor.a;' : ''}
            }`);
            material.needsUpdate = true;
          }
        });
        this.scene.add(vis.renderer.root);
      }
      const resource = this.resourceBodies.has(vis.body.id);
      vis.sphere.visible = resolved && resource;
      if (vis.renderer) {
        vis.renderer.root.visible = resolved && !resource;
        if (resolved) { params.bodyPosition = pos; params.bodyRotation = rotation; vis.renderer.update(params); }
      }
      if (resolved && occluderCount < 12) this.orbitStyle.occluders[occluderCount++].set(vis.sphere.position.x, vis.sphere.position.y, vis.sphere.position.z, vis.body.radius);
      vis.icon.visible = visible && angular < .009;

      if (vis.orbitLine) {
        vis.orbitLine.visible = visible;
        const hovered = this.hoverBody === vis, targeted = this.target?.kind === 'body' && this.target.id === vis.body.id;
        vis.orbitLine.material.color.setHex(targeted ? TARGET_COLOR : vis.familyColor);
        vis.orbitLine.material.linewidth = hovered || targeted ? 2.3 : vis.body.kind === 'moon' ? 1 : 1.3;
        vis.orbitLine.material.opacity = hovered || targeted ? .95 : vis.body.kind === 'moon' ? .32 : .55;
      }
      v.copy(vis.sphere.position).project(this.camera);
      const onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < .96 && Math.abs(v.y) < .94;
      vis.icon.visible &&= onScreen;
      const iconBox = vis.iconBox;
      iconBox.x = (v.x*.5+.5)*w-7; iconBox.y = (-v.y*.5+.5)*h-7;
      vis.icon.visible &&= placeLabel(iconBox, this.iconBoxes, iconCount);
      if (vis.icon.visible) {
        this.iconBoxes[iconCount] = iconBox;
        this.bodyIcons.set(iconCount++, v, 44/w, 44/h, this.target?.id === vis.body.id ? TARGET_COLOR : vis.familyColor);
      }
      const box = vis.labelBox;
      box.x = (v.x*.5+.5)*w+Math.max(12, angular*h/(2*Math.tan(this.camera.fov*Math.PI/360))+8); box.y = (-v.y*.5+.5)*h-9;
      const show = visible && (resolved || vis.icon.visible) && onScreen && placeLabel(box, this.labelBoxes, labelCount);
      vis.label.style.display = show ? 'block' : 'none';
      if (show) {
        this.labelBoxes[labelCount++] = box;
        vis.label.style.left = `${box.x-10}px`; vis.label.style.top = `${box.y+9}px`;
        vis.label.style.color = this.hoverBody === vis ? '#fff1c9' : '#cfd8e6';
      }
    }
    this.labelCount = labelCount;
    this.bodyIcons.finish(iconCount);
    this.orbitStyle.uniforms.mapCount.value = occluderCount;
    this.soi.visible = !!this.hoverBody && Number.isFinite(this.hoverBody.body.soi);
    if (this.hoverBody && this.soi.visible) {
      this.soi.position.copy(this.hoverBody.sphere.position); this.soi.scale.setScalar(this.hoverBody.body.soi);
    }
    const breadcrumbId = u.referenceBody ?? identity;
    const focusBody = this.bodies.get(breadcrumbId);
    if (focusBody && this.breadcrumb.dataset.focus !== breadcrumbId) {
      this.breadcrumb.dataset.focus = breadcrumbId;
      const chain: string[] = [];
      let body: Body | undefined = focusBody.body;
      while (body) { chain.unshift(body.name); body = body.parent ? this.bodies.get(body.parent)?.body : undefined; }
      this.breadcrumb.textContent = chain.join('  ›  ');
    }
    this.breadcrumb.style.display = focusBody ? 'block' : 'none';

    this.updateMarkers(u);
    this.updateGizmo(u);
    this.updateExtras(u);
    this.updateApproach(u);
    for (const m of this.materials) m.resolution.set(u.viewport.width, u.viewport.height);
    if (!u.vessel) this.updateVesselLines(EMPTY_PATCHES, this.bodies);

    // Vessel
    this.vesselIcon.visible = !!u.vessel;
    for (const s of this.nodeIcons) s.visible = false;
    for (const s of this.apPeIcons) if (s) s.visible = false;
    let nodeIndex = 0;
    if (u.vessel) {
      this.place(this.vesselIcon, u.vessel.position, focus);
      this.updateVesselLines(u.vessel.patches, this.bodies);
      for (const line of this.vesselLines) {
        const id = line.userData.body as string;
        this.place(line, this.ephem.getBodyState(id, t).position, focus);
      }
      // Maneuver node markers: position at node time on whichever patch contains it.
      for (const n of u.vessel.nodes) {
        const patch = u.vessel.patches.find((p) => n.time >= p.startTime && n.time <= p.endTime + 1e-6);
        if (!patch) continue;
        const pp = this.ephem.getBodyState(patch.orbit.body, t).position;
        const np = patchState(patch, n.time).position;
        const s = this.pooledIcon(this.nodeIcons, nodeIndex++, '#3c8cff', true, .026, 13);
        s.position.set(pp.x+np.x-focus.x,pp.y+np.y-focus.y,pp.z+np.z-focus.z);
        s.userData.nodeId = n.id;
      }
      const first = u.vessel.patches[0];
      if (first && !first.samples) {
        const parentPos = this.ephem.getBodyState(first.orbit.body, t).position;
        this.apsisTimes[0] = timeToPeriapsis(first.orbit,t);
        this.apsisTimes[1] = first.orbit.e < 1 ? timeToApoapsis(first.orbit,t) : Infinity;
        for (let i = 0; i < 2; i++) {
          const dt = this.apsisTimes[i], color = this.apsisColors[i];
          if (!isFinite(dt) || t + dt > first.endTime) continue;
          const p = elementsToState(first.orbit, t + dt).position;
          const s = this.pooledIcon(this.apPeIcons, color === '#6fe39a' ? 0 : 1, color, false, .014, 12);
          s.position.set(parentPos.x+p.x-focus.x,parentPos.y+p.y-focus.y,parentPos.z+p.z-focus.z);
        }
      }
    }
  }

  private pooledIcon(pool: THREE.Sprite[], index: number, color: string, ring: boolean, size: number, order: number): THREE.Sprite {
    let sprite = pool[index];
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture(color, ring), sizeAttenuation: false, depthTest: false }));
      sprite.scale.setScalar(size); sprite.renderOrder = order;
      pool[index] = sprite; this.scene.add(sprite);
    }
    sprite.visible = true;
    return sprite;
  }

  /** Apsis readouts for UI. */
  static apsides(o: Orbit, bodyRadius: number) {
    return { pe: periapsisRadius(o) - bodyRadius, ap: apoapsisRadius(o) - bodyRadius };
  }

  /** Mouse controls: right/left drag to orbit, wheel to zoom. Returns a disposer. */
  attachControls(el: HTMLElement, minDistance: () => number, enabled: () => boolean = () => true) {
    let dragging = false;
    let maneuver: { node: ManeuverNode; orbit: Orbit; patch: TrajectoryPatch; axis?: 'prograde' | 'normal' | 'radial'; sign: number; start: number; dx: number; dy: number; timeMin: number; timeMax: number } | null = null;
    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * 2 - 1, y: 1 - (e.clientY - r.top) / r.height * 2 };
    };
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      if (!enabled()) return;
      if (e.button === 0 && this.lastUpdate?.vessel) {
        const u = this.lastUpdate, at = ndc(e), hit = this.pickManeuver(at.x, at.y);
        const node = u.vessel!.nodes.find(n => n.id === hit?.id);
        const patch = node && u.vessel!.patches.find(p => node.time >= p.startTime && node.time <= p.endTime + 1e-6);
        if (node && patch && hit) {
          const state = patchState(patch, node.time);
          const dirs = { prograde: maneuverToInertialDv(state, { prograde: 1, normal: 0, radial: 0 }), normal: maneuverToInertialDv(state, { prograde: 0, normal: 1, radial: 0 }), radial: maneuverToInertialDv(state, { prograde: 0, normal: 0, radial: 1 }) };
          const center = this.project(state.position, patch.orbit.body, u);
          const dir = hit.axis ? dirs[hit.axis] : dirs.prograde;
          const endpoint = this.project(add(state.position, { x: dir.x * this.distance * .07 * hit.sign, y: dir.y * this.distance * .07 * hit.sign, z: dir.z * this.distance * .07 * hit.sign }), patch.orbit.body, u);
          const dx = (endpoint.x - center.x) * el.clientWidth / 2, dy = -(endpoint.y - center.y) * el.clientHeight / 2;
          const len = Math.hypot(dx, dy);
          maneuver = { node, patch, orbit: patch.orbit, axis: hit.axis, sign: hit.sign, start: hit.axis ? node[hit.axis] : node.time,
            dx: len > 2 ? dx / len : 1, dy: len > 2 ? dy / len : 0,
            timeMin: Math.max(u.t + 5, patch.startTime), timeMax: Math.max(u.t + 5, Math.min(patch.startTime + (patch.orbit.e < 1 ? 2 * Math.PI * Math.sqrt(patch.orbit.a ** 3 / patch.orbit.mu) : 86400), u.vessel!.patches.find(p => p.endTime >= node.time && (p.endReason === 'soiEnter' || p.endReason === 'soiExit'))?.endTime ?? Infinity)) };
          lx = e.clientX; ly = e.clientY; e.preventDefault(); return;
        }
      }
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!enabled()) { maneuver = null; dragging = false; return; }
      if (maneuver && this.lastUpdate) {
        const m = maneuver, u = this.lastUpdate;
        if (m.axis) m.node[m.axis] = m.start + ((e.clientX - lx) * m.dx + (e.clientY - ly) * m.dy) * m.sign * 2;
        else {
          const at = ndc(e);
          let best = m.node.time, error = Infinity;
          const evaluate = (time: number) => {
            const p = this.project(patchState(m.patch, time).position, m.orbit.body, u);
            const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
            if (p.z < 1 && d < error) { error = d; best = time; }
          };
          const step = (m.timeMax - m.timeMin) / 512;
          for (let i = 0; i <= 512; i++) evaluate(m.timeMin + i * step);
          const center = best;
          for (let i = -20; i <= 20; i++) evaluate(Math.max(m.timeMin, Math.min(m.timeMax, center + i * step / 20)));
          m.node.time = best;
        }
        return;
      }
      if (!dragging) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { this.hoverBody = null; this.tooltip.style.display = 'none'; return; }
        const at = ndc(e), hit = this.pick(at.x, at.y);
        let body = hit?.kind === 'body' ? this.bodies.get(hit.id) : undefined;
        if (!body) {
          const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(at.x, at.y), this.camera);
          ray.params.Line2 = { threshold: 6 };
          for (const vis of this.bodies.values()) if (vis.orbitLine?.visible && ray.intersectObject(vis.orbitLine)[0]) { body = vis; break; }
        }
        this.hoverBody = body ?? null;
        this.tooltip.style.display = body ? 'block' : 'none';
        if (body) {
          const b = body.body, o = b.orbit;
          this.tooltip.textContent = `${b.name}\n${b.orbitalPeriod ? `Period ${formatDuration(b.orbitalPeriod)}` : 'Solar system primary'}${o ? `\nPe ${formatDistance(o.a*(1-o.e))} · Ap ${formatDistance(o.a*(1+o.e))}` : ''}`;
          this.tooltip.style.left = `${Math.min(e.clientX-r.left+18,r.width-280)}px`;
          this.tooltip.style.top = `${Math.min(e.clientY-r.top+18,r.height-110)}px`;
        }
        return;
      }
      this.yaw -= (e.clientX - lx) * 0.005;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = () => { dragging = false; maneuver = null; };
    const wheel = (e: WheelEvent) => {
      if (!enabled()) return;
      e.preventDefault();
      this.distance = Math.max(minDistance(), Math.min(5e13, this.distance * Math.exp(e.deltaY * 0.0012)));
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  setVisible(visible: boolean) {
    this.labels.style.display = visible ? 'block' : 'none';
    if (!visible) { this.hoverBody = null; this.tooltip.style.display = 'none'; }
  }

  dispose() {
    for (const fx of this.comets.values()) fx.dispose();
    this.comets.clear();
    this.sunGlow.material.map?.dispose();
    for (const texture of this.resourceTextures.values()) texture.dispose();
    this.resourceTextures.clear();
    this.labels.remove();
    for (const vis of this.bodies.values()) {
      if (vis.renderer) { vis.renderer.root.removeFromParent(); vis.renderer.dispose(); }
      vis.icon.material.dispose();
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const material of materials) material?.dispose();
    });
  }
}
