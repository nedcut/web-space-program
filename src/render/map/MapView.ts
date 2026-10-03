import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Body } from '../../sim/bodies/types';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { Orbit, TrajectoryPatch, ManeuverNode } from '../../sim/orbit/api';
import { elementsToState, periapsisRadius, apoapsisRadius, timeToPeriapsis, timeToApoapsis } from '../../sim/orbit/kepler';
import { sub, type Vec3 } from '../../util/vec3';

/**
 * Map view ("tracking" view): conic orbit lines for bodies and vessels, body spheres + icons,
 * an orbit camera around a focus body/vessel spanning metres to light-hours.
 *
 * Precision: every line/sphere is positioned relative to the camera focus in float64 on the CPU each frame,
 * and line vertices are stored relative to their parent body, so float32 is only used for local offsets.
 */
export interface MapUpdate {
  t: number;
  /** Heliocentric position of the focused object (float64). */
  focus: Vec3;
  /** Active vessel trajectory (patched conics) and its heliocentric position. */
  vessel?: { position: Vec3; patches: TrajectoryPatch[]; nodes: ManeuverNode[] };
  viewport: { width: number; height: number };
}

export interface ExtraOrbit {
  id: string;
  position: Vec3;
  orbit?: Orbit;
}

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
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 1e15);
  /** Spherical camera coords around focus. */
  yaw = 0.6;
  pitch = 0.5;
  distance = 2e7;
  private bodies = new Map<string, BodyVisual>();
  private vesselLines: Line2[] = [];
  private vesselIcon: THREE.Sprite;
  private nodeIcons: THREE.Sprite[] = [];
  private apPeIcons: THREE.Sprite[] = [];
  private labels: HTMLDivElement;
  private materials: LineMaterial[] = [];
  private sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
  private lastVesselKey = '';
  private extraOrbits: ExtraOrbit[] = [];
  private extras = new Map<string, { icon: THREE.Sprite; line?: Line2; key: string }>();

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
    return hit ? { kind: hit.kind, id: hit.id } : null;
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
        vis = { icon, key: '' };
        this.extras.set(item.id, vis);
      }
      const o = item.orbit;
      // Orbit elements are stable on rails; callers can throttle conic updates in physics.
      const key = o ? JSON.stringify(o) : '';
      if (key !== vis.key) {
        if (vis.line) this.removeLine(vis.line);
        vis.line = undefined;
        if (o) {
          const pts = sampleConic(o, this.bodies.get(o.body)?.body.soi ?? Infinity, u.t, null);
          if (pts.length > 1) vis.line = this.makeLine(pts, 0x6fe39a, 1.6, 0.8);
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
  ) {
    this.scene.background = new THREE.Color(0x02030a);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    this.scene.add(this.sunLight);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    labelHost.appendChild(this.labels);

    for (const b of bodies.values()) {
      const isStar = b.kind === 'star';
      const mat = isStar
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.75).multiplyScalar(3) })
        : new THREE.MeshStandardMaterial({ color: colorOf(b), roughness: 0.9 });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
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
    const key = patches.map((p) => `${p.orbit.body}:${p.orbit.a.toPrecision(8)}:${p.orbit.e.toPrecision(6)}:${p.startTime.toFixed(0)}:${p.endTime.toFixed(0)}`).join('|');
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
    const { t, focus } = u;
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
      if (onScreen) vis.label.style.left = `${(v.x * 0.5 + 0.5) * w}px`, (vis.label.style.top = `${(-v.y * 0.5 + 0.5) * h}px`);
    }

    this.updateExtras(u);
    for (const m of this.materials) m.resolution.set(u.viewport.width, u.viewport.height);
    if (!u.vessel) this.updateVesselLines([], this.bodies);

    // Vessel
    this.vesselIcon.visible = !!u.vessel;
    for (const s of [...this.nodeIcons, ...this.apPeIcons]) {
      this.scene.remove(s);
      s.material.dispose();
    }
    this.nodeIcons = [];
    this.apPeIcons = [];
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
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture('#3c8cff', true), sizeAttenuation: false, depthTest: false }));
        s.scale.setScalar(0.026);
        s.renderOrder = 13;
        this.place(s, { x: pp.x + np.x, y: pp.y + np.y, z: pp.z + np.z }, focus);
        this.scene.add(s);
        this.nodeIcons.push(s);
      }
      const first = u.vessel.patches[0];
      if (first) {
        const parentPos = this.ephem.getBodyState(first.orbit.body, t).position;
        const markers: [number, string][] = [[timeToPeriapsis(first.orbit, t), '#6fe39a']];
        if (first.orbit.e < 1) markers.push([timeToApoapsis(first.orbit, t), '#5cc8ff']);
        for (const [dt, color] of markers) {
          if (!isFinite(dt) || t + dt > first.endTime) continue;
          const p = elementsToState(first.orbit, t + dt).position;
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture(color, false), sizeAttenuation: false, depthTest: false }));
          s.scale.setScalar(0.014);
          s.renderOrder = 12;
          this.place(s, { x: parentPos.x + p.x, y: parentPos.y + p.y, z: parentPos.z + p.z }, focus);
          this.scene.add(s);
          this.apPeIcons.push(s);
        }
      }
    }
  }

  /** Apsis readouts for UI. */
  static apsides(o: Orbit, bodyRadius: number) {
    return { pe: periapsisRadius(o) - bodyRadius, ap: apoapsisRadius(o) - bodyRadius };
  }

  /** Mouse controls: right/left drag to orbit, wheel to zoom. Returns a disposer. */
  attachControls(el: HTMLElement, minDistance: () => number) {
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      this.yaw -= (e.clientX - lx) * 0.005;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = () => (dragging = false);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.distance = Math.max(minDistance(), Math.min(5e13, this.distance * Math.exp(e.deltaY * 0.0012)));
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  setVisible(visible: boolean) {
    this.labels.style.display = visible ? 'block' : 'none';
  }

  dispose() {
    this.labels.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const material of materials) material?.dispose();
    });
  }
}
