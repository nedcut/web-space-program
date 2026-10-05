import { createTerrain } from '../../sim/terrain';
import { CometEffects } from '../planet/CometEffects';
import { AsteroidFieldView, type FieldSource } from './AsteroidFieldView';
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
import { formatDuration } from '../../util/format';
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

const TARGET_COLOR = 0xff4fb8;
const TARGET_CSS = '#ff4fb8';
const EXTRA_COLOR = 0x6fe39a;

const PATCH_COLORS = [0x5cc8ff, 0xffb35c, 0xd066ff, 0x6fe39a, 0xff6b6b];

interface BodyVisual {
  body: Body;
  sphere: THREE.Mesh;
  icon: THREE.Sprite;
  orbitLine?: Line2;
  label: HTMLDivElement;
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
  private markerVisuals: { icon: THREE.Sprite; label: HTMLDivElement }[] = [];
  private lastUpdate: MapUpdate | null = null;
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
    const markers = [...(u.markers ?? [])];
    for (const p of u.vessel?.patches ?? []) if (p.endReason === 'soiEnter' || p.endReason === 'soiExit') {
      markers.push({ body: p.orbit.body, position: elementsToState(p.orbit, p.endTime).position,
        label: `${p.endReason === 'soiEnter' ? 'Enter' : 'Exit'} ${this.bodies.get(p.endReason === 'soiExit' ? p.orbit.body : p.nextBody ?? p.orbit.body)?.body.name ?? p.nextBody} SOI · T−${formatDuration(p.endTime - u.t)}`, color: '#ffb35c' });
    }
    for (const n of u.vessel?.nodes ?? []) {
      const p = u.vessel!.patches.find(p => n.time >= p.startTime && n.time <= p.endTime + 1e-6);
      if (p) markers.push({ body: p.orbit.body, position: elementsToState(p.orbit, n.time).position,
        label: `Node T−${formatDuration(n.time - u.t)}`, color: '#5cc8ff' });
    }
    while (this.markerVisuals.length < markers.length) {
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false }));
      icon.scale.setScalar(0.018); icon.renderOrder = 12; this.scene.add(icon);
      const label = document.createElement('div');
      Object.assign(label.style, { position: 'absolute', font: '11px system-ui', whiteSpace: 'nowrap', textShadow: '0 0 4px black', transform: 'translate(12px,-50%)' });
      this.labels.appendChild(label); this.markerVisuals.push({ icon, label });
    }
    this.markerVisuals.forEach((vis, i) => {
      const m = markers[i]; vis.icon.visible = !!m; vis.label.style.display = 'none';
      if (!m) return;
      vis.icon.material.map = makeIconTexture(m.color, true);
      this.place(vis.icon, add(this.ephem.getBodyState(m.body, u.t).position, m.position), u.focus);
      const p = vis.icon.position.clone().project(this.camera);
      if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1) {
        vis.label.textContent = m.label; vis.label.style.color = m.color; vis.label.style.display = 'block';
        vis.label.style.left = `${(p.x * .5 + .5) * u.viewport.width}px`;
        vis.label.style.top = `${(-p.y * .5 + .5) * u.viewport.height}px`;
      }
    });
  }

  private updateGizmo(u: MapUpdate) {
    const node = u.vessel?.nodes[0];
    const patch = node ? u.vessel?.patches.find(p => node.time >= p.startTime && node.time <= p.endTime + 1e-6) : null;
    if (!this.gizmo.length) for (const [axis, color] of [['prograde', '#d8ff3c'], ['normal', '#d066ff'], ['radial', '#4fd8ff']] as const) for (const sign of [-1, 1]) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color);
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture(color, false), sizeAttenuation: false, depthTest: false }));
      icon.scale.setScalar(.022); icon.renderOrder = 15;
      this.scene.add(arrow, icon); this.gizmo.push({ arrow, icon, axis, sign });
    }
    for (const g of this.gizmo) { g.arrow.visible = g.icon.visible = !!patch; }
    if (!node || !patch) return;
    const state = elementsToState(patch.orbit, node.time);
    const dirs = { prograde: maneuverToInertialDv(state, { prograde: 1, normal: 0, radial: 0 }), normal: maneuverToInertialDv(state, { prograde: 0, normal: 1, radial: 0 }), radial: maneuverToInertialDv(state, { prograde: 0, normal: 0, radial: 1 }) };
    const origin = sub(add(this.ephem.getBodyState(patch.orbit.body, u.t).position, state.position), u.focus);
    const base = new THREE.Vector3(origin.x, origin.y, origin.z);
    const size = base.distanceTo(this.camera.position) * .07;
    for (const g of this.gizmo) {
      const d = dirs[g.axis], direction = new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(g.sign);
      g.arrow.position.copy(base); g.arrow.setDirection(direction); g.arrow.setLength(size, size * .2, size * .08);
      g.icon.position.copy(base).addScaledVector(direction, size);
    }
  }
  private apPeIcons: THREE.Sprite[] = [];
  private labels: HTMLDivElement;
  private materials: LineMaterial[] = [];
  private sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
  private lastVesselKey = '';
  private extraOrbits: ExtraOrbit[] = [];
  private extras = new Map<string, { icon: THREE.Sprite; line?: Line2; key: string; targeted: boolean }>();
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
      const mat = vis.sphere.material as THREE.MeshStandardMaterial;
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
      candidates.push({ object: vis.icon.visible ? vis.icon : vis.sphere, kind: 'body', id });
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
    const ids = new Set(this.extraOrbits.map((v) => v.id));
    for (const [id, vis] of this.extras) if (!ids.has(id)) {
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
        vis = { icon, key: '', targeted: false };
        this.extras.set(item.id, vis);
      }
      const targeted = this.target?.kind === 'vessel' && this.target.id === item.id;
      if (targeted !== vis.targeted) {
        vis.targeted = targeted;
        vis.icon.material.map = makeIconTexture(targeted ? TARGET_CSS : '#6fe39a', true);
        vis.icon.material.needsUpdate = true;
        vis.key = ''; // rebuild the conic in the new colour
      }
      const o = item.orbit;
      // Orbit elements are stable on rails; callers can throttle conic updates in physics.
      const key = o ? JSON.stringify(o) : '';
      if (key !== vis.key) {
        if (vis.line) this.removeLine(vis.line);
        vis.line = undefined;
        if (o) {
          const pts = sampleConic(o, this.bodies.get(o.body)?.body.soi ?? Infinity, u.t, null);
          if (pts.length > 1) vis.line = vis.targeted ? this.makeLine(pts, TARGET_COLOR, 2.2, 0.95) : this.makeLine(pts, EXTRA_COLOR, 1.6, 0.8);
        }
        vis.key = key;
      }
      this.place(vis.icon, item.position, u.focus);
      if (vis.line && o) this.place(vis.line, this.ephem.getBodyState(o.body, u.t).position, u.focus);
    }
  }

  constructor(
    bodies: Map<string, Body>,
    private ephem: Ephemeris,
    labelHost: HTMLElement,
    field?: FieldSource,
  ) {
    this.au = (bodies.get('earth')?.orbit?.a ?? 149597870700);
    if (field) this.field = new AsteroidFieldView(field, bodies.get('sun')!.gm, this.au / 149597870700, this.scene);
    this.scene.background = new THREE.Color(0x02030a);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    this.scene.add(this.sunLight);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    labelHost.appendChild(this.labels);

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
      const css = `#${colorOf(b).getHexString()}`;
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture(isStar ? '#ffe9a8' : css, !isStar), sizeAttenuation: false, depthTest: false, transparent: true }));
      icon.scale.setScalar(0.022);
      icon.renderOrder = 10;
      this.scene.add(icon);
      const label = document.createElement('div');
      label.textContent = b.name;
      Object.assign(label.style, { position: 'absolute', font: '11px system-ui', color: '#cfd8e6', textShadow: '0 0 3px #000', whiteSpace: 'nowrap', transform: 'translate(10px,-50%)' });
      this.labels.appendChild(label);
      const vis: BodyVisual = { body: b, sphere, icon, label };
      if (b.orbit && b.parent) {
        const parent = bodies.get(b.parent)!;
        const o: Orbit = { ...b.orbit, body: b.parent, mu: parent.gm + b.gm, m0: b.orbit.meanAnomalyAtEpoch };
        // Body orbits are sampled via the ephemeris (handles parentEquator frames).
        const T = b.orbitalPeriod ?? 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu);
        const pts: Vec3[] = [];
        for (let i = 0; i <= 256; i++) pts.push(this.ephem.getRelativeState(b.id, (T * i) / 256).position);
        vis.orbitLine = this.makeLine(pts, colorOf(b).lerp(new THREE.Color(1, 1, 1), 0.3).getHex(), 1.2, 0.55);
      }
      this.bodies.set(b.id, vis);
    }
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
    const v = this.approachIcons[0].position.clone().project(this.camera);
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
    this.materials.push(mat);
    const line = new Line2(geom, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  private place(obj: THREE.Object3D, helio: Vec3, focus: Vec3) {
    const d = sub(helio, focus);
    obj.position.set(d.x, d.y, d.z);
  }

  /** Rebuild vessel trajectory lines when the patch set changes. */
  private updateVesselLines(patches: TrajectoryPatch[], bodies: Map<string, BodyVisual>) {
    const key = patches.map((p) => `${p.orbit.body}:${p.orbit.a.toPrecision(8)}:${p.orbit.e.toPrecision(6)}:${p.orbit.i.toPrecision(8)}:${p.orbit.lan.toPrecision(8)}:${p.orbit.argPe.toPrecision(8)}:${p.startTime.toFixed(0)}:${p.endTime.toFixed(0)}`).join('|');
    if (key === this.lastVesselKey) return;
    this.lastVesselKey = key;
    for (const l of this.vesselLines) {
      this.removeLine(l);
    }
    this.vesselLines = patches.map((p, i) => {
      const soi = bodies.get(p.orbit.body)?.body.soi ?? Infinity;
      const closed = p.orbit.e < 1 && (p.endReason === 'horizon' || p.endTime - p.startTime > 2 * Math.PI * Math.sqrt(p.orbit.a ** 3 / p.orbit.mu));
      const pts = sampleConic(p.orbit, soi, p.startTime, closed ? null : p.endTime, 384);
      const line = this.makeLine(pts, PATCH_COLORS[i % PATCH_COLORS.length], i === 0 ? 2.4 : 1.8);
      line.userData.body = p.orbit.body;
      return line;
    });
  }

  update(u: MapUpdate) {
    this.lastUpdate = u;
    const { t, focus } = u;
    this.field?.update(t, focus);
    for (const [id, fx] of this.comets) fx.update(this.ephem.getBodyState(id, t).position, this.ephem.getBodyState('sun', t).position, focus, this.bodies.get(id)!.body.radius, this.au, t, true);
    if (!this.commsLines.parent) { this.scene.add(this.commsLines); this.commsLines.renderOrder = 5; }
    this.commsLines.visible = !!u.comms;
    if (u.comms) {
      const nodes = new Map(u.comms.nodes.map(n => [n.id, n]));
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
        for (const id of [link.a, link.b]) {
          const p = nodes.get(id)!.position;
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
    this.camera.position.set(Math.cos(this.yaw) * cp * this.distance, Math.sin(this.yaw) * cp * this.distance, Math.sin(this.pitch) * this.distance);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(1, this.distance * 1e-4);
    this.camera.far = this.distance * 1e6;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const sun = [...this.bodies.values()].find((b) => b.body.kind === 'star');
    if (sun) this.place(this.sunLight, this.ephem.getBodyState(sun.body.id, t).position, focus);

    const v = new THREE.Vector3();
    const w = u.viewport.width;
    const h = u.viewport.height;
    for (const vis of this.bodies.values()) {
      const pos = this.ephem.getBodyState(vis.body.id, t).position;
      this.place(vis.sphere, pos, focus);
      const rotation = this.ephem.bodyRotation(vis.body.id, t);
      vis.sphere.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      if (vis.body.surface.preset !== 'irregular') vis.sphere.rotateX(Math.PI / 2);
      this.place(vis.icon, pos, focus);
      if (vis.orbitLine && vis.body.parent) this.place(vis.orbitLine, this.ephem.getBodyState(vis.body.parent, t).position, focus);
      // Hide icons/labels for bodies whose apparent size is large, or whose orbit is tiny on screen (declutter).
      const dist = vis.sphere.position.distanceTo(this.camera.position);
      const angular = vis.body.radius / Math.max(dist, 1);
      const orbitPx = vis.body.orbit ? ((vis.body.orbit.a / Math.max(dist, 1)) * h) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) : 1e9;
      const visible = orbitPx > 14;
      vis.icon.visible = visible && angular < 0.01;
      if (vis.orbitLine) vis.orbitLine.visible = visible;
      v.copy(vis.sphere.position).project(this.camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      vis.label.style.display = visible && onScreen ? 'block' : 'none';
      if (onScreen) { vis.label.style.left = `${(v.x * 0.5 + 0.5) * w}px`; vis.label.style.top = `${(-v.y * 0.5 + 0.5) * h}px`; }
    }

    this.updateMarkers(u);
    this.updateGizmo(u);
    this.updateExtras(u);
    this.updateApproach(u);
    for (const m of this.materials) m.resolution.set(u.viewport.width, u.viewport.height);
    if (!u.vessel) this.updateVesselLines([], this.bodies);

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
        const np = elementsToState(patch.orbit, n.time).position;
        const s = this.pooledIcon(this.nodeIcons, nodeIndex++, '#3c8cff', true, .026, 13);
        this.place(s, { x: pp.x + np.x, y: pp.y + np.y, z: pp.z + np.z }, focus);
        s.userData.nodeId = n.id;
      }
      const first = u.vessel.patches[0];
      if (first) {
        const parentPos = this.ephem.getBodyState(first.orbit.body, t).position;
        const markers: [number, string][] = [[timeToPeriapsis(first.orbit, t), '#6fe39a']];
        if (first.orbit.e < 1) markers.push([timeToApoapsis(first.orbit, t), '#5cc8ff']);
        for (const [dt, color] of markers) {
          if (!isFinite(dt) || t + dt > first.endTime) continue;
          const p = elementsToState(first.orbit, t + dt).position;
          const s = this.pooledIcon(this.apPeIcons, color === '#6fe39a' ? 0 : 1, color, false, .014, 12);
          this.place(s, { x: parentPos.x + p.x, y: parentPos.y + p.y, z: parentPos.z + p.z }, focus);
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
    let maneuver: { node: ManeuverNode; orbit: Orbit; axis?: 'prograde' | 'normal' | 'radial'; sign: number; start: number; dx: number; dy: number; timeMin: number; timeMax: number } | null = null;
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
          const state = elementsToState(patch.orbit, node.time);
          const dirs = { prograde: maneuverToInertialDv(state, { prograde: 1, normal: 0, radial: 0 }), normal: maneuverToInertialDv(state, { prograde: 0, normal: 1, radial: 0 }), radial: maneuverToInertialDv(state, { prograde: 0, normal: 0, radial: 1 }) };
          const center = this.project(state.position, patch.orbit.body, u);
          const dir = hit.axis ? dirs[hit.axis] : dirs.prograde;
          const endpoint = this.project(add(state.position, { x: dir.x * this.distance * .07 * hit.sign, y: dir.y * this.distance * .07 * hit.sign, z: dir.z * this.distance * .07 * hit.sign }), patch.orbit.body, u);
          const dx = (endpoint.x - center.x) * el.clientWidth / 2, dy = -(endpoint.y - center.y) * el.clientHeight / 2;
          const len = Math.hypot(dx, dy);
          maneuver = { node, orbit: patch.orbit, axis: hit.axis, sign: hit.sign, start: hit.axis ? node[hit.axis] : node.time,
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
            const p = this.project(elementsToState(m.orbit, time).position, m.orbit.body, u);
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
      if (!dragging) return;
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
  }

  dispose() {
    for (const texture of this.resourceTextures.values()) texture.dispose();
    this.resourceTextures.clear();
    this.labels.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const material of materials) material?.dispose();
    });
  }
}
