import * as THREE from 'three';
import type { PartState, VesselState } from '../sim/vessel/runtime';
import type { Vec3 } from '../util/vec3';

/** Hatches farther than this are not marked (a drifting astronaut still finds the way back). */
export const HATCH_MARKER_RANGE = 250;

/** Marker caption: the distance to walk/fly, or the board key once in reach. */
export function hatchMarkerLabel(distance: number, ready: boolean, boardKey: string): string {
  if (ready) return `Board · ${boardKey}`;
  return `Hatch · ${distance < 10 ? distance.toFixed(1) : Math.round(distance)} m`;
}

const scratchQ = new THREE.Quaternion();
const scratchN = new THREE.Vector3();

/**
 * Scene-space position of a pod's hatch (the same point as `World.hatchPosition`, on the pod's +Z face 0.6 m out)
 * written to `out`, without allocating. Returns whether the hatch faces away from `eye` (behind the hull).
 */
export function hatchScenePosition(v: VesselState, pod: PartState, origin: Vec3, eye: THREE.Vector3, out: THREE.Vector3): boolean {
  const shape = pod.def.shape;
  const radius = shape.kind === 'box' ? shape.size.z / 2 : Math.max(shape.radiusTop, shape.radiusBottom);
  const vq = v.orientation, pq = pod.rotation;
  scratchQ.set(pq.x, pq.y, pq.z, pq.w);
  scratchN.set(0, 0, 1).applyQuaternion(scratchQ);
  out.copy(scratchN).multiplyScalar(radius + 0.6);
  out.x += pod.position.x - v.com.x; out.y += pod.position.y - v.com.y; out.z += pod.position.z - v.com.z;
  scratchQ.set(vq.x, vq.y, vq.z, vq.w);
  out.applyQuaternion(scratchQ);
  scratchN.applyQuaternion(scratchQ);
  out.x += v.position.x - origin.x; out.y += v.position.y - origin.y; out.z += v.position.z - origin.z;
  return scratchN.x * (out.x - eye.x) + scratchN.y * (out.y - eye.y) + scratchN.z * (out.z - eye.z) > 0;
}

/** Margin (px) that keeps an off-screen marker's arrow and caption inside the view. */
const EDGE = 28;

/**
 * Where a marker goes for a view-space point (camera looks down −Z): on screen, or clamped to the view's edge in its
 * direction (behind the camera: the bottom edge, toward its side). `ndc` is the point's projection, valid when in front. Writes CSS px to
 * `out` (x right, y down) and returns the arrow angle (rad, screen space, 0 = right) or NaN when on screen.
 */
export function markerPlacement(view: { x: number; y: number; z: number }, ndc: { x: number; y: number }, width: number, height: number, out: { x: number; y: number }, top = EDGE): number {
  const front = view.z < 0;
  if (front && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
    out.x = (ndc.x + 1) * 0.5 * width; out.y = (1 - ndc.y) * 0.5 * height;
    return NaN;
  }
  // Screen-space direction (px, y up): the projection in front; behind the camera the bottom edge ("turn round"),
  // toward the side the point lies on.
  let dx = front ? ndc.x * width : view.x, dy = front ? ndc.y * height : -(Math.abs(view.y) + Math.abs(view.z));
  if (dx === 0 && dy === 0) dy = -1;
  // The top edge sits below the HUD's top bar.
  const hw = Math.max(1, width / 2 - EDGE), hh = Math.max(1, height / 2 - (dy > 0 ? top : EDGE));
  const k = Math.min(hw / Math.max(1e-9, Math.abs(dx)), hh / Math.max(1e-9, Math.abs(dy)));
  dx *= k; dy *= k;
  out.x = width / 2 + dx; out.y = height / 2 - dy;
  return Math.atan2(-dy, dx);
}

/**
 * On-screen marker for the astronaut's nearest free hatch: a small diamond and caption in the label layer
 * (DOM, no draw call or shader program); off screen it sits on the view's edge with an arrow toward the hatch.
 * The target and caption change at telemetry rate; the position is projected every frame, and styles are written
 * only when the marker moves by half a pixel or more (or the arrow turns by a degree).
 */
export class HatchMarker {
  readonly el: HTMLDivElement;
  private readonly caption: HTMLSpanElement;
  private readonly arrow: HTMLElement;
  private target: { vesselId: string; podUid: number } | null = null;
  private text = '';
  private shown = false;
  private x = NaN;
  private y = NaN;
  private angle = NaN;
  private behind = false;
  private ready = false;
  private flip = false;
  private readonly p = new THREE.Vector3();
  private readonly view = { x: 0, y: 0, z: 0 };
  private readonly px = { x: 0, y: 0 };
  /** Top margin for an off-screen marker (CSS px): clear of the HUD's top bar. */
  topInset = EDGE;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hatch-marker';
    this.el.style.display = 'none';
    this.el.appendChild(document.createElement('i'));
    this.arrow = document.createElement('b');
    this.el.appendChild(this.arrow);
    this.caption = document.createElement('span');
    this.el.appendChild(this.caption);
    host.appendChild(this.el);
  }

  /** Telemetry rate: which hatch to mark (null hides it) and its caption. */
  setTarget(target: { vesselId: string; podUid: number; distance: number; ready: boolean; boardKey: string } | null) {
    this.target = target && { vesselId: target.vesselId, podUid: target.podUid };
    if (!target) return;
    const text = hatchMarkerLabel(target.distance, target.ready, target.boardKey);
    if (text !== this.text) this.caption.textContent = this.text = text;
    if (target.ready !== this.ready) this.el.classList.toggle('ready', this.ready = target.ready);
  }

  /** Every rendered frame, after the camera moved. `vessels` resolves the target's (render-interpolated) state. */
  update(vessels: ReadonlyMap<string, { state: VesselState }>, origin: Vec3, camera: THREE.PerspectiveCamera, width: number, height: number, visible: boolean) {
    const v = visible && this.target ? vessels.get(this.target.vesselId)?.state : undefined;
    const pod = v?.cache.byUid.get(this.target!.podUid);
    const on = !!(v && pod);
    if (v && pod) {
      const behind = hatchScenePosition(v, pod, origin, camera.position, this.p);
      this.p.applyMatrix4(camera.matrixWorldInverse);
      this.view.x = this.p.x; this.view.y = this.p.y; this.view.z = this.p.z;
      this.p.applyMatrix4(camera.projectionMatrix);
      const angle = markerPlacement(this.view, this.p, width, height, this.px, this.topInset);
      const { x, y } = this.px;
      if (!(Math.abs(x - this.x) < 0.5 && Math.abs(y - this.y) < 0.5)) {
        this.x = x; this.y = y;
        this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const flip = x > width - 140;
        if (flip !== this.flip) this.el.classList.toggle('flip', this.flip = flip);
      }
      if (Number.isNaN(angle) !== Number.isNaN(this.angle)) this.el.classList.toggle('edge', !Number.isNaN(angle));
      if (Number.isNaN(angle)) this.angle = NaN;
      else if (!(Math.abs(angle - this.angle) < 0.017)) this.arrow.style.transform = `rotate(${(this.angle = angle).toFixed(3)}rad)`;
      // Dimmed when the hatch faces away (behind the hull); an edge arrow stays bright.
      const dim = behind && Number.isNaN(angle);
      if (dim !== this.behind) this.el.classList.toggle('behind', this.behind = dim);
    }
    if (on !== this.shown) this.el.style.display = (this.shown = on) ? '' : 'none';
  }

  dispose() { this.el.remove(); }
}
