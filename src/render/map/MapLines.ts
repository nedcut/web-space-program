import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Body } from '../../sim/bodies/types';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { Orbit, TrajectoryPatch } from '../../sim/orbit/api';
import { add, sub, type Vec3 } from '../../util/vec3';
import { OrbitStyle, TRAJECTORY_LOOK, PLANNED_LOOK, type OrbitLook } from './OrbitStyle';
import { sampleConic } from './conicSampling';
import { firstPlannedPatch, patchDrawnClosed } from './orbitMarkers';
import { PLANNED_COLOR } from './mapIcons';
import type { MapUpdate } from './mapTypes';
import type { MapFrame } from './MapFrame';

/** Map line widths, CSS px (the map renders at device resolution, so these are 2 device px per unit on Retina). */
export const WIDTH = { active: 3, future: 2.5, planned: 2.75, planet: 1.6, moon: 1.4, highlight: 2.6, fleet: 1.6, fleetTarget: 2.4, gizmo: 2 };
export function snapshotOrbit(o: Orbit): Orbit {
  return { ...o, stateAtEpoch: o.stateAtEpoch ? { position: { ...o.stateAtEpoch.position }, velocity: { ...o.stateAtEpoch.velocity } } : undefined };
}
export function sameOrbit(a: Orbit, b: Orbit) {
  return a.body === b.body && a.a === b.a && a.e === b.e && a.i === b.i && a.lan === b.lan
    && a.argPe === b.argPe && a.m0 === b.m0 && a.epoch === b.epoch && a.mu === b.mu && a.p === b.p
    && (!a.stateAtEpoch && !b.stateAtEpoch || !!a.stateAtEpoch && !!b.stateAtEpoch
      && a.stateAtEpoch.position.x === b.stateAtEpoch.position.x && a.stateAtEpoch.position.y === b.stateAtEpoch.position.y && a.stateAtEpoch.position.z === b.stateAtEpoch.position.z
      && a.stateAtEpoch.velocity.x === b.stateAtEpoch.velocity.x && a.stateAtEpoch.velocity.y === b.stateAtEpoch.velocity.y && a.stateAtEpoch.velocity.z === b.stateAtEpoch.velocity.z);
}

/** Current-trajectory patch colours (first patch, then patches after SOI changes). */
const PATCH_COLORS = [0x5cc8ff, 0xd066ff, 0x6fe39a, 0xffe066, 0xff6b6b];
/** Planned (post-node) patch colours. */
const PLANNED_COLORS = [PLANNED_COLOR, 0xffd25c, 0xff7a5c, 0xffb3e0];

/** Line colour of trajectory patch `i` (current family, or planned family after the first node). */
export function patchColor(i: number, planned: number): number {
  return i >= planned ? PLANNED_COLORS[(i - planned) % PLANNED_COLORS.length] : PATCH_COLORS[i % PATCH_COLORS.length];
}
export function place(obj: THREE.Object3D, helio: Vec3, focus: Vec3) {
  obj.position.set(helio.x-focus.x, helio.y-focus.y, helio.z-focus.z);
}

const EMPTY_PATCHES: TrajectoryPatch[] = [];

/** Owns line materials, trajectory snapshots and reusable landing/comms buffers. */
export class MapLines {
  private orbitStyle = new OrbitStyle();
  private vesselLines: Line2[] = [];
  private landingLine?: Line2;
  private landingData?: MapUpdate['landing'];
  private landingAnchor?: Vec3;
  private landingPosition: Vec3 = { x: 0, y: 0, z: 0 };
  private lastPatches: TrajectoryPatch[] = [];
  private version = 0;
  get patchVersion() { return this.version; }
  private materials: LineMaterial[] = [];
  /** Viewport (CSS px) last written to every line material's `resolution`. */
  private resolutionWidth = 1;
  private resolutionHeight = 1;
  private commsNodes = new Map<string, Vec3>();
  private linkColor = new THREE.Color();
  private commsLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false }));
  constructor(private scene: THREE.Scene, private bodies: Map<string, Body>, private ephem: Ephemeris, private frame: MapFrame) {}

  create(pts: Vec3[], color: number, width: number, opacity: number, look: OrbitLook): Line2 {
    const pos = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3));
    const geom = new LineGeometry();
    geom.setPositions(pos);
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
    mat.resolution.set(this.resolutionWidth, this.resolutionHeight);
    this.orbitStyle.configure(mat, look);
    this.materials.push(mat);
    const line = new Line2(geom, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  remove(line: Line2) {
    this.scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    this.materials = this.materials.filter((m) => m !== line.material);
  }

  /**
   * Rebuild vessel trajectory lines whose patch changed. Only changed patches are rebuilt: during a burn the current
   * conic changes every frame while its continuation does not.
   */
  private rebuildTrajectory(patches: TrajectoryPatch[]) {
    const planned = firstPlannedPatch(patches);
    const lastPlanned = firstPlannedPatch(this.lastPatches);
    const same = (i: number) => {
      const p = patches[i], previous = this.lastPatches[i];
      return !!previous && p.startTime === previous.startTime && p.endTime === previous.endTime && p.endReason === previous.endReason
        && p.samples === previous.samples && sameOrbit(p.orbit, previous.orbit)
        && patchColor(i, planned) === patchColor(i, lastPlanned) && (i >= planned) === (i >= lastPlanned);
    };
    let unchanged = patches.length === this.lastPatches.length;
    for (let i = 0; unchanged && i < patches.length; i++) unchanged = same(i);
    if (unchanged) return;
    const keep = patches.map((_, i) => same(i));
    this.lastPatches = patches.map(p => ({ ...p, orbit: snapshotOrbit(p.orbit) }));
    this.version++;
    for (let i = 0; i < this.vesselLines.length; i++) if (!keep[i]) this.remove(this.vesselLines[i]);
    this.vesselLines = patches.map((p, i) => {
      if (keep[i]) return this.vesselLines[i];
      const soi = this.bodies.get(p.orbit.body)?.soi ?? Infinity;
      // The current orbit stays a full ellipse past a node (as the planned orbit does), so both read at a glance.
      const closed = patchDrawnClosed(p);
      const pts = p.samples ? p.samples.map(s => s.position) : sampleConic(p.orbit, soi, p.startTime, closed ? null : p.endTime);
      if (pts.length === 1) pts.push(pts[0]);
      // Localize numerical vertices in Float64 before conversion to GPU Float32 buffers.
      const anchor = p.samples ? pts[0] : undefined;
      const isPlanned = i >= planned;
      const color = patchColor(i, planned);
      // Planned patches stay bright wherever they go (an encounter far from the vessel is what is being planned).
      const line = this.create(anchor ? pts.map(point => sub(point, anchor)) : pts, color,
        i === 0 ? WIDTH.active : isPlanned ? WIDTH.planned : WIDTH.future, 1, isPlanned ? PLANNED_LOOK : TRAJECTORY_LOOK);
      line.userData.numericAnchor = anchor;
      // Dashes are sized in screen pixels each frame (see update), so they read the same at every zoom.
      line.material.dashed = i > 0;
      line.material.dashSize = isPlanned ? 14 : 10; line.material.gapSize = isPlanned ? 7 : 7;
      line.renderOrder = isPlanned ? 4 : 3;
      line.userData.body = p.orbit.body; line.userData.patch = i;
      return line;
    });
  }

  updateLanding(u: MapUpdate) {
    const { t, focus } = u;
    const landing = u.landing;
    if (landing !== this.landingData) {
      this.landingData = landing;
      if (landing && landing.points.length > 1) {
        this.landingAnchor = landing.points[0];
        const points = landing.points.map(p => sub(p, this.landingAnchor!));
        if (!this.landingLine) {
          this.landingLine = this.create(points, 0xffac66, WIDTH.active, .95, TRAJECTORY_LOOK);
          this.landingLine.renderOrder = 4; // Keep the drag path legible where it overlaps the live conic.
        }
        else {
          const coords: number[] = [];
          for (const p of points) coords.push(p.x, p.y, p.z);
          this.landingLine.geometry.setPositions(coords);
          this.landingLine.computeLineDistances();
        }
      }
    }
    if (this.landingLine) {
      this.landingLine.visible = !!landing && landing.points.length > 1;
      if (landing && this.landingAnchor) {
        const bodyPosition = this.ephem.getBodyState(landing.body, t).position, anchor = this.landingAnchor;
        this.landingPosition.x = bodyPosition.x + anchor.x;
        this.landingPosition.y = bodyPosition.y + anchor.y;
        this.landingPosition.z = bodyPosition.z + anchor.z;
        place(this.landingLine, this.landingPosition, focus);
      }
    }
  }

  updateComms(u: MapUpdate) {
    const { focus } = u;
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
  }

  resize(u: MapUpdate) {
    // Line materials take the viewport at creation; existing ones only need it again on resize.
    if (u.viewport.width !== this.resolutionWidth || u.viewport.height !== this.resolutionHeight) {
      this.resolutionWidth = u.viewport.width; this.resolutionHeight = u.viewport.height;
      for (const m of this.materials) m.resolution.set(this.resolutionWidth, this.resolutionHeight);
    }
  }

  beginFrame(u: MapUpdate, distance: number) {
    const { focus } = u;
    this.orbitStyle.uniforms.mapDistance.value = distance;
    this.orbitStyle.uniforms.mapVessel.value.set(u.vessel ? u.vessel.position.x-focus.x : 0,
      u.vessel ? u.vessel.position.y-focus.y : 0, u.vessel ? u.vessel.position.z-focus.z : 0);
    this.orbitStyle.uniforms.mapViewport.value.set(u.viewport.width, u.viewport.height);
    this.orbitStyle.uniforms.mapCount.value = 0;
  }

  occlude(position: THREE.Vector3, radius: number) {
    const count = this.orbitStyle.uniforms.mapCount;
    if (count.value < 12) this.orbitStyle.occluders[count.value++].set(position.x, position.y, position.z, radius);
  }

  updateTrajectory(u: MapUpdate, distance: number, pxPerWorld1: number) {
    const { focus } = u;
    if (u.vessel) {
      this.rebuildTrajectory(u.vessel.patches);
      for (const line of this.vesselLines) {
        const id = line.userData.body as string;
        const bodyPosition = this.frame.framedBodyPosition(id, u, this.frame.patchFrameTime(u, u.vessel.patches[line.userData.patch as number]));
        place(line, line.userData.numericAnchor ? add(bodyPosition, line.userData.numericAnchor) : bodyPosition, focus);
        // Screen-space dashes: dash lengths are px at the focus distance, whatever the conic's size.
        if (line.material.dashed) line.material.dashScale = pxPerWorld1 / Math.max(distance, 1e-3);
      }
    } else this.rebuildTrajectory(EMPTY_PATCHES);
  }
}
