import { MapLines, WIDTH, snapshotOrbit, sameOrbit, patchColor, place } from './MapLines';
import { MapFrame } from './MapFrame';
import type { MapMarkerInput, MapUpdate, ExtraOrbit, MapTarget, MapApproach, MapPick, MapPoint, MapHandlers } from './mapTypes';
import { aimAt, clearDistance, pickSphere, smallBodyVisible } from './framing';
import { patchState } from '../../sim/orbit/numericalPrediction';
import { createTerrain } from '../../sim/terrain';
import { CometEffects } from '../planet/CometEffects';
import { AsteroidFieldView, type FieldSource } from './AsteroidFieldView';
import { PlanetRenderer, type PlanetUpdateParams } from '../planet/PlanetRenderer';
import { QUALITY_PRESETS, type QualitySettings } from '../core/quality';
import { SCALE_PRESETS } from '../../sim/bodies/scale';
import { BodyIcons } from './BodyIcons';
import { BODY_LOOK, GIZMO_LOOK, PLANNED_LOOK, TRAJECTORY_LOOK, orbitUniforms } from './OrbitStyle';
import { adaptiveSamples, sampleConic } from './conicSampling';
import { createMapStars, createSoiShell } from './mapBackdrop';
import { familyColor, placeLabel, type LabelBox } from './presentation';
import { concentrationAt } from '../../sim/resources/deposits';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';

import type { Body } from '../../sim/bodies/types';
import type { Ephemeris } from '../../sim/orbit/ephemeris';
import type { Orbit, TrajectoryPatch, ManeuverNode } from '../../sim/orbit/api';
import { maneuverToInertialDv } from '../../sim/orbit/maneuver';
import { formatDistance, formatDuration } from '../../util/format';
import { elementsToState, periapsisRadius, apoapsisRadius, period } from '../../sim/orbit/kepler';
import { add, length, sub, type Vec3 } from '../../util/vec3';
import {
  GIZMO_HANDLES, applyHandle, applyWheel, closestOnPolyline, handlePull, handleScreenDirection, handleStretch, screenPolyline, slideWindow,
  wheelZoomFactor,
  type GizmoAxis, type GizmoHandle, type ScreenPolyline,
} from './maneuverGizmo';
import { firstPlannedPatch, markerCaption, markerDetail, orbitMarkers, patchDrawnClosed, type OrbitMarker } from './orbitMarkers';
import { AXIS_COLORS, NODE_COLOR, PLANNED_COLOR, handleTexture, nodeTexture } from './mapIcons';
import { GLYPH_PX, LABEL_SHADOW, cssHex, glyphForKey, markerGlyphSvg, type MarkerGlyph } from './markerGlyphs';
import { setPosition, setStyle } from './styleWriter';
import { coveredIndex, nodeClearSpot, nudgeClear, overlapsAny } from './hudAvoid';
import { HudRectCache } from './hudRects';
import { SurfaceLayers, type BiomeTarget, type LegendEntry } from './surfaceLayers';
import type { BiomeMap } from '../../sim/science/biomeMap';

/**
 * Map view ("tracking" view): conic orbit lines for bodies and vessels, body spheres + icons,
 * an orbit camera around a focus body/vessel spanning metres to light-hours.
 *
 * Precision: every line/sphere is positioned relative to the camera focus in float64 on the CPU each frame,
 * and line vertices are stored relative to their parent body, so float32 is only used for local offsets.
 *
 * Interaction (attachControls): left/right drag orbits the camera, the wheel (and trackpad pinch) zooms. Hovering the
 * active trajectory shows a ghost node and clicking places a maneuver node there; the selected node shows six Δv
 * handles at a constant screen distance (drag out to add Δv, Alt+wheel for fine steps) and its centre, which always
 * wins hit-testing over handles, slides along the orbit. Clicks, double-clicks and right-clicks on
 * bodies, vessels and orbit lines are reported through `handlers` so the host UI can open menus or change focus.
 */
export type { MapMarkerInput, MapUpdate, ExtraOrbit, MapTarget, MapApproach, MapPick, MapPoint, MapHandlers } from './mapTypes';

type Hover =
  | { kind: 'none' }
  | { kind: 'handle'; index: number; nodeId: number }
  | { kind: 'node'; id: number }
  | { kind: 'marker'; key: string }
  | { kind: 'object'; pick: MapPick }
  | { kind: 'orbit'; time: number; patch: number; distance: number };

type Drag =
  | { kind: 'camera'; button: number; x: number; y: number; moved: boolean; hover: Hover }
  | { kind: 'handle'; nodeId: number; index: number; x: number; y: number; dirX: number; dirY: number; pull: number }
  | { kind: 'node'; nodeId: number; x: number; y: number; moved: boolean; patch: TrajectoryPatch; earliest: number; latest: number; period: number;
      /** Grab offset, true point minus drawn icon (non-zero when the icon is nudged out from under a HUD panel). */
      offX: number; offY: number };

const EMPTY_MARKERS: MapMarkerInput[] = [];
const EMPTY_PATCHES: TrajectoryPatch[] = [];
const EMPTY_NODES: ManeuverNode[] = [];
const NONE: Hover = { kind: 'none' };

const TARGET_COLOR = 0xff4fb8;
const TARGET_CSS = '#ff4fb8';
const EXTRA_COLOR = 0x6fe39a;
/** Rest distance of gizmo handles from the node, CSS px (constant at every zoom, like the node icon). */
const HANDLE_OFFSET = 60;
/** A handle whose arm still projects shorter than this (it points almost at the camera) is hidden and unpickable,
 * so it can never cover the node centre. */
const HANDLE_MIN_PX = 32;
/** Grab radius of a node centre, CSS px. Checked before any handle: the centre always wins. */
const NODE_GRAB_PX = 16;
/** Below this on-screen orbit radius (CSS px) the handles hide; zoom in to edit. */
const GIZMO_MIN_ORBIT_PX = 3;
/** Sprite sizes, CSS px. */
const ICON_PX = { vessel: 24, fleet: 20, node: 20, nodeHover: 24, ghost: 20, ghostBody: 18 };
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const CLICK_SLOP = 5;

/** Platform name of the Alt key (Option on Apple keyboards) for hints. */
function altKeyName(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Option' : 'Alt';
}

const IMPACT_CSS = '#ff5c5c';

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
  /** Orbit-line highlight last written (bit 0 hovered, bit 1 targeted; -1 forces a write). */
  lineStyle: number;
}

/** A marker drawn this frame (pooled). */
interface ShownMarker {
  key: string; body: string; position: Vec3; caption: string; color: string; priority: number;
  orbit?: OrbitMarker; detail?: string; dotOnly?: boolean; time?: number; glyph: MarkerGlyph;
  /** Body placement time (encounter patches); undefined = now. */
  frameTime?: number;
}
interface MarkerElement {
  root: HTMLDivElement; dot: HTMLDivElement; text: HTMLDivElement; box: LabelBox; content: string; color: string; glyph: string;
  /** Thin line from a nudged glyph back to its true point, as last written (rounded to 0.01 rad / 1 px). */
  leader: HTMLDivElement; leaderA: number; leaderL: number;
  /** Caption sits left of the glyph (the right side runs under a HUD panel). */
  flipped: boolean;
  /** Caption placement box, re-measured only when its text changes. */
  caption: LabelBox; measured: string; lines: number;
}

const EMPTY_RECTS: LabelBox[] = [];
/** A marker within this many px of a HUD block counts as covered by it; a nudged marker stands this far clear. */
const HUD_COVER_PX = 6, HUD_CLEAR_PX = 10;
/**
 * Maneuver nodes stand this far clear of HUD blocks (icon radius plus a little); the selected node's whole gizmo
 * (handles at HANDLE_OFFSET plus their icon) does. Closer nodes are drawn at the nearest clear spot with a leader.
 */
const NODE_CLEAR_PX = 14, GIZMO_CLEAR_PX = HANDLE_OFFSET + 16;

/** Hover-sampled trajectory polyline (body-relative positions, float64). */
interface TrajectoryPoly { body: string; patch: number; times: Float64Array; points: Float64Array; count: number }

const iconCache = new Map<string, THREE.CanvasTexture>();
function makeIconTexture(color: string, ring: boolean): THREE.CanvasTexture {
  const key = `${color}:${ring}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // Dark halo first so the icon stays legible over bright planet discs.
  g.strokeStyle = 'rgba(2,5,12,0.75)';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(32, 32, ring ? 20 : 14, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(32, 32, ring ? 20 : 14, 0, Math.PI * 2);
  if (ring) g.stroke();
  else g.fill();
  if (ring) { g.beginPath(); g.arc(32, 32, 5, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(key, t);
  return t;
}

function colorOf(b: Body): THREE.Color {
  const c = b.surface.colors[0] ?? [0.6, 0.6, 0.6];
  return new THREE.Color(c[0], c[1], c[2]);
}

export { sampleConic };

/**
 * Whether a pointer event is over the map itself: inside its rect and not over a HUD element stacked above it
 * (pointermove listens on window, so its target is whatever is on top). A marker under a HUD panel would otherwise
 * show its tooltip while clicks go to the panel.
 */
export function pointerOnMap(el: HTMLElement, target: EventTarget | null, x: number, y: number, width: number, height: number): boolean {
  if (!(x >= 0 && y >= 0 && x <= width && y <= height)) return false;
  return !target || target === el || (typeof (target as Node).nodeType === 'number' && el.contains(target as Node));
}

export class MapView {
  private readonly frame: MapFrame;
  private readonly lines: MapLines;
  private field?: AsteroidFieldView;
  private comets = new Map<string, CometEffects>();
  private au = 149597870700;
  readonly scene = new THREE.Scene();
  private bodyIcons: BodyIcons;
  private projected = new THREE.Vector3();
  private labelBoxes: LabelBox[] = [];
  private iconBoxes: LabelBox[] = [];
  private labelCount = 0;
  /** Accepted labels after marker captions (surface labels place after these). */
  private markerLabelCount = 0;
  /** Biome overlay, objective highlights and city labels. */
  readonly surface: SurfaceLayers;
  private orderedBodies: BodyVisual[] = [];
  private hoverBody: BodyVisual | null = null;
  private tooltip: HTMLDivElement;
  private breadcrumb: HTMLDivElement;
  /** SOI shells: [0] the hovered body, the rest bodies the trajectory encounters. */
  private soiShells = [createSoiShell(), createSoiShell(), createSoiShell()];
  private encounterGhosts: THREE.Sprite[] = [];
  private renderFocus: Vec3 = { x: 0, y: 0, z: 0 };
  private previousFocus: Vec3 = { x: 0, y: 0, z: 0 };
  private focusOffset: Vec3 = { x: 0, y: 0, z: 0 };
  private focusIdentity = '';
  private renderedDistance = 0;
  private lastFrame = 0;
  private sunId: string;
  private sunGlow: THREE.Sprite;
  private planetParams: PlanetUpdateParams;
  readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 1e15);
  /** Spherical camera coords around focus. */
  yaw = 0.6;
  pitch = 0.5;
  distance = 2e7;
  /** Counts the player's own zoom gestures, so automatic framing can stay out of a deliberate zoom. */
  zoomCount = 0;
  resourceOverlayEnabled = false;
  /** Gesture callbacks (see MapHandlers). */
  handlers: MapHandlers = {};
  /** Node whose gizmo is shown (defaults to the next upcoming node). */
  selectedNodeId: number | null = null;
  /** Fine-tune: handles and wheel steps are 20× finer. */
  fineTune = false;
  private resourceTextures = new Map<string, THREE.DataTexture>();
  private resourceBodies = new Set<string>();
  private bodies = new Map<string, BodyVisual>();
  private vesselIcon: THREE.Sprite;
  private nodeIcons: THREE.Sprite[] = [];
  private nodeScreen = new Map<number, MapPoint>();
  private ghost: THREE.Sprite;
  private gizmoOrbit?: Orbit;
  private gizmoTime = NaN;
  private gizmoState?: ReturnType<typeof elementsToState>;
  private gizmoDirs?: Record<GizmoAxis, Vec3>;
  private gizmoNodeId: number | null = null;
  private gizmoBase = new THREE.Vector3();
  private gizmoDirection = new THREE.Vector3();
  private gizmoQuat = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private gizmo: { line: Line2; icon: THREE.Sprite; handle: GizmoHandle; axis: GizmoAxis; sign: number; screen: MapPoint; visible: boolean; stretch: number }[] = [];
  private gizmoCenter: MapPoint = { x: 0, y: 0 };
  private gizmoOffset = HANDLE_OFFSET;
  private gizmoIconPx = 26;
  /** Sprite scale for one CSS pixel (non-attenuated sprites), updated each frame. */
  private spritePx = .001;
  private lastUpdate: MapUpdate | null = null;
  private frameUpdate: MapUpdate = { t: 0, focus: this.renderFocus, viewport: { width: 1, height: 1 } };
  private orbitMarks: OrbitMarker[] = [];
  private orbitMarksKey = '';
  private shown: ShownMarker[] = [];
  private shownCount = 0;
  private markerEls: MarkerElement[] = [];
  /** Per marker element: its caption won placement this frame. */
  private captioned: boolean[] = [];
  private markerScreen: { key: string; x: number; y: number }[] = [];
  private markerScreenCount = 0;
  private hudRects: HudRectCache | null = null;
  private readonly nudgeAt = { x: 0, y: 0 };
  /** HUD rectangles measured this frame; `obstacles` also counts the spots reserved by nudged nodes/markers. */
  private hudCount = 0;
  private obstacles = 0;
  private pinned = new Set<string>();
  private trajectoryPolys: TrajectoryPoly[] = [];
  private polysVersion = -1;
  private polysTime = -Infinity;
  private screenLine: ScreenPolyline = screenPolyline(1100);
  private hover: Hover = NONE;
  private drag: Drag | null = null;
  private pointer = { x: 0, y: 0, inside: false, clientX: 0, clientY: 0 };
  private lastHoverAt = 0;
  private lastPlaced = -Infinity;
  /** Tooltips stay hidden after a click opened a menu, until the pointer moves away. */
  private quiet: MapPoint | null = null;
  private element: HTMLElement | null = null;
  private labels: HTMLDivElement;
  /** Viewport (CSS px) last written to every line material's `resolution`. */
  private sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
  private extraOrbits: ExtraOrbit[] = [];
  private extras = new Map<string, { icon: THREE.Sprite; line?: Line2; orbit?: Orbit; targeted: boolean }>();
  private target: MapTarget | null = null;
  private highlightedBody: { vis: BodyVisual; color: number; width: number } | null = null;
  private approach: MapApproach | null = null;
  private approachLine: THREE.Line;
  private warmObjects: THREE.Object3D[] = [];

  /** The node showing the gizmo: the selected node, else the next upcoming one. */
  private gizmoNode(u: MapUpdate): ManeuverNode | undefined {
    const nodes = u.vessel?.nodes ?? EMPTY_NODES;
    let pick = this.selectedNodeId !== null ? nodes.find(n => n.id === this.selectedNodeId) : undefined;
    if (!pick) for (const n of nodes) if (n.time >= u.t - 60 && (!pick || n.time < pick.time)) pick = n;
    return pick;
  }

  private patchAt(u: MapUpdate, time: number) {
    for (const p of u.vessel?.patches ?? EMPTY_PATCHES) if (time >= p.startTime && time <= p.endTime + 1e-6) return p;
    return undefined;
  }

  /** CSS-pixel position of a maneuver node on screen this frame (null when hidden). */
  nodeScreenPosition(id: number): MapPoint | null {
    const p = this.nodeScreen.get(id);
    return p && Number.isFinite(p.x) ? p : null;
  }

  /** Maneuver handles/nodes at normalized device coordinates (kept for scripts and tests). */
  pickManeuver(x: number, y: number) {
    const u = this.lastUpdate;
    if (!u) return null;
    const h = this.hitManeuver((x * .5 + .5) * u.viewport.width, (-y * .5 + .5) * u.viewport.height);
    if (h.kind === 'handle') { const g = this.gizmo[h.index]; return { id: h.nodeId, axis: g.axis, sign: g.sign }; }
    if (h.kind === 'node') return { id: h.id, axis: undefined, sign: 1 };
    return null;
  }

  private hitManeuver(x: number, y: number): Hover {
    if (!this.handlers.placeNode && !this.handlers.nodesChanged) return NONE;
    // Node centres first: grabbing the node to slide it along the orbit must never be stolen by a handle.
    let best: number = NODE_GRAB_PX, hit: Hover = NONE;
    for (const [id, p] of this.nodeScreen) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) { best = d; hit = { kind: 'node', id }; }
    }
    if (hit.kind !== 'none') return hit;
    best = Math.max(14, this.gizmoIconPx / 2 + 6);
    if (this.gizmoNodeId !== null) for (let i = 0; i < this.gizmo.length; i++) {
      const g = this.gizmo[i];
      if (!g.visible) continue;
      const d = Math.hypot(g.screen.x - x, g.screen.y - y);
      if (d < best) { best = d; hit = { kind: 'handle', index: i, nodeId: this.gizmoNodeId }; }
    }
    return hit;
  }

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

  /** Where biome maps come from (the host's worker); without one there is no biome overlay. */
  setBiomeSource(source: ((body: Body) => Promise<BiomeMap | null>) | null) { this.surface.setSource(source); }

  /** Translucent biome regions, outlines and region names on every body with more than one biome. */
  setBiomeOverlay(enabled: boolean) { this.surface.setBiomes(enabled); }

  get biomeOverlayEnabled() { return this.surface.biomes; }

  /** Earth city labels (on by default). */
  setCityLabels(enabled: boolean) { this.surface.setCities(enabled); }

  get cityLabelsEnabled() { return this.surface.cities; }

  /** Biomes named by active objectives: always highlighted and labelled. */
  setBiomeTargets(targets: readonly BiomeTarget[]) { this.surface.setTargets(targets); }

  /** Biomes on a body's map (objectives first); null until the map has been built. */
  biomeLegend(bodyId: string): LegendEntry[] | null { return this.surface.legend(bodyId); }

  /** Body-fixed unit vector inside a biome region (nearest to `near` if given), or null. */
  biomeAnchor(bodyId: string, biome: string, near?: Vec3): Vec3 | null { return this.surface.anchor(bodyId, biome, near); }

  /**
   * Turn the camera to look straight down on a body-fixed direction of `bodyId` from `radii` body radii out.
   * Meant for a focus on that body's centre (inertial camera angles).
   */
  lookAtSurface(bodyId: string, direction: Vec3, t: number, radii = 2.6) {
    const body = this.bodies.get(bodyId)?.body;
    if (!body) return;
    const q = this.ephem.bodyRotation(bodyId, t);
    const d = this.poleScratch.set(direction.x, direction.y, direction.z).normalize().applyQuaternion(this.quatScratch.set(q.x, q.y, q.z, q.w));
    this.yaw = Math.atan2(d.y, d.x);
    this.pitch = Math.max(-1.55, Math.min(1.55, Math.asin(Math.max(-1, Math.min(1, d.z)))));
    this.distance = body.radius * radii;
    this.zoomCount++;
    this.zoomAnchor = null;
  }

  /** Highlight the navigation target (its orbit and icon); null clears. */
  setTarget(t: MapTarget | null) {
    if (this.target?.id === t?.id && this.target?.kind === t?.kind) return;
    this.target = t;
    this.field?.select(t?.kind === 'body' ? t.id : null);
    if (this.highlightedBody) {
      const { vis, color, width } = this.highlightedBody;
      vis.lineStyle = -1;
      if (vis.orbitLine) {
        vis.orbitLine.material.color.setHex(color);
        vis.orbitLine.material.linewidth = width;
      }
      this.highlightedBody = null;
    }
    if (t?.kind === 'body') {
      const vis = this.bodies.get(t.id);
      if (vis?.orbitLine) {
        vis.lineStyle = -1;
        this.highlightedBody = { vis, color: vis.orbitLine.material.color.getHex(), width: vis.orbitLine.material.linewidth };
        vis.orbitLine.material.color.setHex(TARGET_COLOR);
        vis.orbitLine.material.linewidth = WIDTH.highlight;
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
  pick(x: number, y: number): MapPick | null {
    const u = this.lastUpdate;
    if (!u) return null;
    return this.pickObject((x * .5 + .5) * u.viewport.width, (-y * .5 + .5) * u.viewport.height, false);
  }

  private readonly pickPoint: MapPoint = { x: 0, y: 0 };
  private readonly surfaceFrame: SurfaceFrameArgs = { camera: this.camera, width: 1, height: 1, pxPerWorld1: 1, boxes: [], count: 0 };
  /** Body/vessel icon (or resolved sphere, or optionally orbit line) under a CSS-pixel position. */
  private pickObject(x: number, y: number, orbits: boolean): MapPick | null {
    const u = this.lastUpdate;
    if (!u) return null;
    let best = 13, hit: MapPick | null = null;
    const test = (obj: THREE.Object3D, pick: MapPick, radius = 13) => {
      const s = this.frame.toScreen(obj.position, u, this.pickPoint), d = Math.hypot(s.x - x, s.y - y);
      if (d < Math.min(best, radius)) { best = d; hit = pick; }
    };
    // Bodies first: a vessel sharing a body's icon position only wins when strictly closer.
    for (const [id, vis] of this.bodies) if (vis.sphere.userData.mapVisible && vis.icon.visible) test(vis.icon, { kind: 'body', id });
    if (this.vesselIcon.visible && u.vessel?.id) test(this.vesselIcon, { kind: 'vessel', id: u.vessel.id }, 14);
    for (const [id, vis] of this.extras) if (vis.icon.visible) test(vis.icon, { kind: 'vessel', id });
    const found = hit as MapPick | null;
    if (found) return found;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2(x / u.viewport.width * 2 - 1, 1 - y / u.viewport.height * 2);
    ray.setFromCamera(ndc, this.camera);
    const spheres: THREE.Object3D[] = [], ids: string[] = [];
    for (const [id, vis] of this.bodies) if (vis.sphere.userData.mapVisible && !vis.icon.visible) { vis.sphere.updateMatrix(); spheres.push(vis.sphere); ids.push(id); }
    this.scene.updateMatrixWorld(true);
    const sphere = ray.intersectObjects(spheres, false)[0]?.object;
    if (sphere) return { kind: 'body', id: ids[spheres.indexOf(sphere)] };
    const asteroid = this.field?.pick(ndc.x, ndc.y, this.camera);
    if (asteroid) return { kind: 'body', id: asteroid };
    if (!orbits) return null;
    ray.params.Line2 = { threshold: 7 };
    for (const [id, vis] of this.extras) if (vis.line?.visible && ray.intersectObject(vis.line)[0]) return { kind: 'vessel', id };
    for (const vis of this.orderedBodies) if (vis.orbitLine?.visible && ray.intersectObject(vis.orbitLine)[0]) return { kind: 'body', id: vis.body.id };
    return null;
  }

  private updateExtras(u: MapUpdate) {
    for (const [id, vis] of this.extras) {
      let found = false;
      for (const orbit of this.extraOrbits) if (orbit.id === id) { found = true; break; }
      if (found) continue;
      if (vis.line) this.lines.remove(vis.line);
      this.scene.remove(vis.icon);
      vis.icon.material.dispose();
      this.extras.delete(id);
    }
    for (const item of this.extraOrbits) {
      let vis = this.extras.get(item.id);
      if (!vis) {
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture('#6fe39a', true), sizeAttenuation: false, depthTest: false }));
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
        if (vis.line) { vis.line.material.color.setHex(targeted ? TARGET_COLOR : EXTRA_COLOR); vis.line.material.linewidth = targeted ? WIDTH.fleetTarget : WIDTH.fleet; }
      }
      const o = item.orbit;
      // Orbit elements are stable on rails; callers can throttle conic updates in physics.
      if (!!o !== !!vis.orbit || (o && vis.orbit && !sameOrbit(o, vis.orbit))) {
        if (vis.line) this.lines.remove(vis.line);
        vis.line = undefined;
        if (o) {
          const pts = sampleConic(o, this.bodies.get(o.body)?.body.soi ?? Infinity, u.t, null);
          if (pts.length > 1) {
            vis.line = vis.targeted ? this.lines.create(pts, TARGET_COLOR, WIDTH.fleetTarget, 0.95, BODY_LOOK) : this.lines.create(pts, EXTRA_COLOR, WIDTH.fleet, 0.8, BODY_LOOK);
            vis.line.renderOrder = 2;
          }
        }
        vis.orbit = o ? snapshotOrbit(o) : undefined;
      }
      place(vis.icon, item.position, u.focus);
      vis.icon.scale.setScalar(ICON_PX.fleet * this.spritePx);
      if (vis.line && o) place(vis.line, this.ephem.getBodyState(o.body, u.t).position, u.focus);
    }
  }

  constructor(
    bodies: Map<string, Body>,
    private ephem: Ephemeris,
    labelHost: HTMLElement,
    private quality: QualitySettings = QUALITY_PRESETS.medium,
    field?: FieldSource,
  ) {
    this.frame = new MapFrame(bodies, ephem, this.camera);
    this.lines = new MapLines(this.scene, bodies, ephem, this.frame);
    this.au = bodies.get('earth')?.orbit?.a ?? 149597870700;
    if (field) this.field = new AsteroidFieldView(field, bodies.get('sun')!.gm, this.au / 149597870700, this.scene);
    this.scene.background = new THREE.Color(0x03060d);
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
    for (const shell of this.soiShells) this.scene.add(shell);
    for (let i = 0; i < 2; i++) {
      const ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture('#ffffff', true), sizeAttenuation: false, depthTest: false, transparent: true, opacity: .7 }));
      ghost.renderOrder = 10; ghost.visible = false;
      this.encounterGhosts.push(ghost); this.scene.add(ghost);
    }
    this.scene.add(createMapStars());
    this.planetParams = { camera: this.camera, origin: this.renderFocus, bodyPosition: this.renderFocus,
      bodyRotation: { x: 0, y: 0, z: 0, w: 1 }, sunPosition: this.renderFocus, dt: 0 };
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    this.scene.add(this.sunLight);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    labelHost.appendChild(this.labels);

    this.tooltip = document.createElement('div');
    Object.assign(this.tooltip.style, { position: 'absolute', display: 'none', padding: '7px 11px', background: '#0a1525ee', border: '1px solid #7997ba55', borderRadius: '7px', color: '#e2edf8', font: '12px system-ui', whiteSpace: 'pre-line', lineHeight: '1.45', zIndex: '20', boxShadow: '0 6px 24px #0008' });
    this.labels.appendChild(this.tooltip);
    this.breadcrumb = document.createElement('div');
    Object.assign(this.breadcrumb.style, { position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', color: '#c8d9ee', background: '#0a1525bb', border: '1px solid #7997ba33', borderRadius: '20px', font: '12px system-ui', letterSpacing: '.08em' });
    this.labels.appendChild(this.breadcrumb);
    this.surface = new SurfaceLayers(this.scene, this.labels, bodies);
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
      Object.assign(label.style, { position: 'absolute', left: '0', top: '0', font: '500 12.5px system-ui, sans-serif', color: '#d8e2ef', textShadow: LABEL_SHADOW, whiteSpace: 'nowrap', letterSpacing: '.02em' });
      this.labels.appendChild(label);
      sphere.visible = false;
      // Only resolved (drawn) spheres need a current matrix; picking refreshes the rest on demand.
      sphere.matrixAutoUpdate = false;
      const vis: BodyVisual = { body: b, sphere, icon, label, familyColor: familyColor(b, bodies), lineStyle: -1,
        labelBox: { x: 0, y: 0, width: b.name.length * 7 + 8, height: 18 }, iconBox: { x: 0, y: 0, width: 14, height: 14 } };
      if (b.orbit && b.parent) {
        const parent = bodies.get(b.parent)!;
        const o: Orbit = { ...b.orbit, body: b.parent, mu: parent.gm + b.gm, m0: b.orbit.meanAnomalyAtEpoch };
        // Body orbits are sampled via the ephemeris (handles parentEquator frames).
        const T = b.orbitalPeriod ?? 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu);
        // Adaptive in time: eccentric comets and dwarfs stay smooth around perihelion.
        const pts = adaptiveSamples(t => this.ephem.getRelativeState(b.id, t).position, 0, T, { initial: 192, maxPoints: 1200 });
        vis.orbitLine = this.lines.create(pts, vis.familyColor, b.kind === 'moon' ? WIDTH.moon : WIDTH.planet, b.kind === 'moon' ? .6 : .6, BODY_LOOK);
        vis.orbitLine.renderOrder = 1;
      }
      this.bodies.set(b.id, vis);
    }
    this.orderedBodies = [...this.bodies.values()].sort((a, b) => b.body.radius - a.body.radius);
    this.labelBoxes = this.orderedBodies.map(v => v.labelBox);
    this.iconBoxes = this.orderedBodies.map(v => v.iconBox);
    this.vesselIcon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeIconTexture('#ffffff', true), sizeAttenuation: false, depthTest: false }));
    this.vesselIcon.renderOrder = 11;
    this.scene.add(this.vesselIcon);
    this.ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: nodeTexture('ghost'), sizeAttenuation: false, depthTest: false, transparent: true }));
    this.ghost.renderOrder = 14; this.ghost.visible = false;
    this.scene.add(this.ghost);
    const approachGeometry = new THREE.BufferGeometry();
    approachGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.approachLine = new THREE.Line(approachGeometry, new THREE.LineBasicMaterial({ color: TARGET_COLOR, transparent: true, opacity: .7, depthTest: false }));
    this.approachLine.frustumCulled = false; this.approachLine.visible = false; this.approachLine.renderOrder = 13;
    this.scene.add(this.approachLine);
    // Gizmo shafts reuse the orbit-line program; created up front so opening the map never compiles shaders.
    for (const handle of GIZMO_HANDLES) {
      const color = new THREE.Color(AXIS_COLORS[handle.axis]).getHex();
      const line = this.lines.create([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], color, WIDTH.gizmo, .8, GIZMO_LOOK);
      line.visible = false; line.renderOrder = 14;
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: handleTexture(handle.axis, handle.sign), sizeAttenuation: false, depthTest: false, transparent: true }));
      icon.renderOrder = 15; icon.visible = false;
      this.scene.add(icon);
      this.gizmo.push({ line, icon, handle, axis: handle.axis, sign: handle.sign, screen: { x: NaN, y: NaN }, visible: false, stretch: 1 });
    }
    // Dashed trajectory variants (future patch, planned patch) for shader warm-up; never shown otherwise.
    for (const look of [TRAJECTORY_LOOK, PLANNED_LOOK]) {
      const line = this.lines.create([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], PLANNED_COLOR, WIDTH.planned, 1, look);
      line.material.dashed = true; line.visible = false;
      this.warmObjects.push(line);
    }
    this.warmObjects.push(this.approachLine, this.ghost, this.surface.warmObject, ...this.gizmo.flatMap(g => [g.line, g.icon]));
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
    const eased = this.renderedDistance;
    this.renderedDistance = this.renderedDistance ? Math.exp(Math.log(this.renderedDistance) + (Math.log(this.distance)-Math.log(this.renderedDistance))*blend) : this.distance;
    this.orbitRate = ORBIT_RATE;
    const ref = u.referenceBody ? this.bodies.get(u.referenceBody) : undefined;
    if (!ref) this.zoomAnchor = null;
    if (ref) {
      const bp = this.ephem.getBodyState(ref.body.id, u.t).position, R = ref.body.radius;
      const rel = { x: bp.x-this.renderFocus.x, y: bp.y-this.renderFocus.y, z: bp.z-this.renderFocus.z };
      // Looking at the body's centre: the wheel zooms towards the point under the cursor, and close to the ground a
      // drag turns the globe about as fast as the ground under the cursor moves (not the far-out orbiting rate).
      if (Math.hypot(rel.x, rel.y, rel.z) < R * 1e-6) {
        this.orbitRate = Math.min(ORBIT_RATE, this.camera.fov * Math.PI / 180 / Math.max(1, u.viewport.height) * Math.max(0, this.renderedDistance - R) / R);
        if (this.zoomAnchor && eased) this.turnToCursor(eased, this.renderedDistance, R);
      } else this.zoomAnchor = null;
      if (Math.abs(Math.log(this.renderedDistance / this.distance)) < 1e-4) this.zoomAnchor = null;
      // Never render from inside the reference body (an off-centre focus while turning, easing or changing focus).
      const cp = Math.cos(this.pitch);
      const clear = clearDistance(this.renderedDistance, Math.cos(this.yaw)*cp, Math.sin(this.yaw)*cp, Math.sin(this.pitch), rel, ref.body.radius*1.01);
      if (clear > this.renderedDistance) { this.renderedDistance = clear; this.distance = Math.max(this.distance, clear); }
    }
    // The existing marker and picking paths use the same animated floating origin.
    this.lastUpdate = this.frameUpdate;
    Object.assign(this.frameUpdate, u); this.frameUpdate.focus = this.renderFocus; u = this.frameUpdate;
    const { t, focus } = u;
    this.lines.updateLanding(u);
    if (this.field) { const visible = u.referenceBody === this.sunId; this.field.setVisible(visible); if (visible) this.field.update(t, focus); }
    for (const [id, fx] of this.comets) fx.update(this.ephem.getBodyState(id, t).position, this.ephem.getBodyState('sun', t).position, focus, this.bodies.get(id)!.body.radius, this.au, t, smallBodyVisible(this.bodies.get(id)!.body.kind, u.referenceBody === this.sunId, this.target?.id === id || identity === id));
    this.lines.updateComms(u);
    this.lines.resize(u);
    this.camera.aspect = u.viewport.width / u.viewport.height;

    // Camera around focus (focus is at the scene origin).
    this.placeCamera(u);
    this.camera.near = Math.max(.1, this.renderedDistance * 1e-6);
    this.camera.far = this.renderedDistance * 1e6;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.spritePx = 2 * Math.tan(this.camera.fov * Math.PI / 360) / Math.max(1, u.viewport.height);
    this.vesselIcon.scale.setScalar(ICON_PX.vessel * this.spritePx);
    this.ghost.scale.setScalar(ICON_PX.ghost * this.spritePx);

    const sunPosition = this.ephem.getBodyState(this.sunId, t).position;
    place(this.sunLight, sunPosition, focus);
    place(this.sunGlow, sunPosition, focus);
    const glowSize = Math.max(this.bodies.get(this.sunId)!.body.radius*5, this.sunGlow.position.distanceTo(this.camera.position)*.025);
    this.sunGlow.scale.setScalar(glowSize);
    const v = this.projected;
    const w = u.viewport.width, h = u.viewport.height;
    let iconCount = 0, labelCount = 0;
    this.lines.beginFrame(u, this.renderedDistance);
    /** CSS px per world metre at unit distance from the camera. */
    const pxPerWorld1 = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    const diagonal = Math.hypot(w, h);
    const params = this.planetParams;
    params.origin = focus; params.sunPosition = sunPosition; params.time = t; params.dt = dt; params.viewportHeight = h;
    for (const vis of this.orderedBodies) {
      const pos = this.ephem.getBodyState(vis.body.id, t).position;
      place(vis.sphere, pos, focus);
      place(vis.icon, pos, focus);
      const parent = vis.body.parent ? this.bodies.get(vis.body.parent) : undefined;
      const parentPosition = parent ? this.ephem.getBodyState(parent.body.id, t).position : undefined;
      if (vis.orbitLine && parentPosition) place(vis.orbitLine, parentPosition, focus);
      const dist = vis.sphere.position.distanceTo(this.camera.position);
      const angular = vis.body.radius / Math.max(dist, 1);
      const orbitPx = vis.body.orbit ? vis.body.orbit.a / Math.max(dist, 1) * pxPerWorld1 : 1e9;
      const parentDistance = parentPosition ? Math.hypot(this.camera.position.x-(parentPosition.x-focus.x), this.camera.position.y-(parentPosition.y-focus.y), this.camera.position.z-(parentPosition.z-focus.z)) : 0;
      // Moons appear as soon as their orbit is a legible ring (sooner around the body being looked at), so the
      // Moon's orbit stays visible while planning a transfer from far out; tiny rings fade in rather than pop.
      const nearParent = !!parent && (parent.body.id === u.referenceBody || parent.body.id === identity || parentDistance < parent.body.soi * 40);
      const moonMin = nearParent ? 5 : 14;
      const visible = smallBodyVisible(vis.body.kind, u.referenceBody === this.sunId, this.target?.id === vis.body.id || identity === vis.body.id) && (vis.body.kind !== 'moon' || orbitPx > moonMin || vis.body.id === identity);
      const ringFade = vis.body.kind === 'moon' && vis.body.id !== identity ? Math.min(1, (orbitPx - moonMin) / (moonMin * 1.5)) : 1;
      vis.sphere.userData.mapVisible = visible;
      const resolved = visible && angular*h > 1.5;
      // Orientation only matters for a sphere that is drawn (or about to be, below).
      const rotation = resolved ? this.ephem.bodyRotation(vis.body.id, t) : undefined;
      if (rotation) {
        vis.sphere.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        if (vis.body.surface.preset !== 'irregular') vis.sphere.rotateX(Math.PI / 2);
        vis.sphere.updateMatrix();
      }
      if (resolved && !vis.renderer) {
        // Earth imagery follows the flight setting (capped at the bundled 4k level by farOnly); 96+ segments keep the
        // limb round when the camera is down near the surface.
        const quality = { ...QUALITY_PRESETS.low, bakedTextureWidth: this.quality.bakedTextureWidth,
          sphereSegments: Math.max(96, this.quality.sphereSegments),
          earth: { ...QUALITY_PRESETS.low.earth, textureQuality: this.quality.earth.textureQuality, nightLights: this.quality.earth.nightLights } };
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
        if (rotation) { params.bodyPosition = pos; params.bodyRotation = rotation; vis.renderer.update(params); }
      }
      this.surface.placeBody(vis.body.id, vis.sphere.position, resolved && !resource ? rotation : undefined);
      if (resolved) this.lines.occlude(vis.sphere.position, vis.body.radius);
      vis.icon.visible = visible && angular < .009;

      if (vis.orbitLine) {
        // Looking at the ground, other bodies' orbits are only lines streaking across the view.
        vis.orbitLine.visible = visible && this.surfaceBlend < 0.999;
        const hovered = this.hoverBody === vis, targeted = this.target?.kind === 'body' && this.target.id === vis.body.id;
        const style = (hovered ? 1 : 0) | (targeted ? 2 : 0);
        if (style !== vis.lineStyle) {
          vis.lineStyle = style;
          vis.orbitLine.material.color.setHex(targeted ? TARGET_COLOR : vis.familyColor);
          vis.orbitLine.material.linewidth = hovered || targeted ? WIDTH.highlight : vis.body.kind === 'moon' ? WIDTH.moon : WIDTH.planet;
        }
        vis.orbitLine.material.opacity = (hovered || targeted ? .95 : .62) * Math.max(0, ringFade) * (1 - this.surfaceBlend);
        // An orbit far larger than the screen (e.g. the focused planet's path round the Sun) is faint and fades
        // towards the screen edges instead of slicing across the view as a straight line.
        const radiusPx = vis.body.orbit ? vis.body.orbit.a * (1 + vis.body.orbit.e) / Math.max(dist, 1) * pxPerWorld1 : 0;
        orbitUniforms(vis.orbitLine).mapLarge.value = hovered || targeted ? 0 : smoothstep(diagonal * 1.5, diagonal * 6, radiusPx);
      }
      v.copy(vis.sphere.position).project(this.camera);
      const onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < .96 && Math.abs(v.y) < .94;
      vis.icon.visible &&= onScreen;
      const iconBox = vis.iconBox;
      iconBox.x = (v.x*.5+.5)*w-7; iconBox.y = (-v.y*.5+.5)*h-7;
      vis.icon.visible &&= placeLabel(iconBox, this.iconBoxes, iconCount);
      if (vis.icon.visible) {
        this.iconBoxes[iconCount] = iconBox;
        this.bodyIcons.set(iconCount++, v, 48/w, 48/h, this.target?.id === vis.body.id ? TARGET_COLOR : vis.familyColor);
      }
      const box = vis.labelBox;
      box.x = (v.x*.5+.5)*w+Math.max(12, angular*h/(2*Math.tan(this.camera.fov*Math.PI/360))+8); box.y = (-v.y*.5+.5)*h-9;
      const show = visible && (resolved || vis.icon.visible) && onScreen && placeLabel(box, this.labelBoxes, labelCount);
      setStyle(vis.label, 'display', show ? 'block' : 'none');
      if (show) {
        this.labelBoxes[labelCount++] = box;
        setPosition(vis.label, box.x, box.y + 9, ' translateY(-50%)');
        setStyle(vis.label, 'color', this.hoverBody === vis ? '#fff1c9' : '#d8e2ef');
      }
    }
    this.labelCount = labelCount;
    this.bodyIcons.finish(iconCount);
    this.updateSoiShells(u);
    const breadcrumbId = u.referenceBody ?? identity;
    const focusBody = this.bodies.get(breadcrumbId);
    if (focusBody && this.breadcrumb.dataset.focus !== breadcrumbId) {
      this.breadcrumb.dataset.focus = breadcrumbId;
      const chain: string[] = [];
      let body: Body | undefined = focusBody.body;
      while (body) { chain.unshift(body.name); body = body.parent ? this.bodies.get(body.parent)?.body : undefined; }
      this.breadcrumb.textContent = chain.join('  ›  ');
    }
    this.breadcrumb.style.display = focusBody && this.showBreadcrumb ? 'block' : 'none';

    this.updateExtras(u);

    // Vessel
    this.vesselIcon.visible = !!u.vessel;
    if (u.vessel) {
      place(this.vesselIcon, u.vessel.position, focus);
    }
    this.lines.updateTrajectory(u, this.renderedDistance, pxPerWorld1);
    this.hudCount = this.obstacles = this.hudRects ? this.hudRects.refresh(this.labels, now) : 0;
    this.updateNodes(u);
    this.updateGizmo(u, dt);
    this.updateMarkers(u);
    const frame = this.surfaceFrame;
    frame.width = w; frame.height = h; frame.pxPerWorld1 = pxPerWorld1; frame.boxes = this.labelBoxes; frame.count = this.markerLabelCount;
    this.surface.update(frame);
    if (this.pointer.inside && !this.drag && now - this.lastHoverAt > 100) this.setHover(this.computeHover(this.pointer.x, this.pointer.y));
    else if (this.drag?.kind === 'handle' && now - this.lastHoverAt > 80) this.setHover({ kind: 'handle', index: this.drag.index, nodeId: this.drag.nodeId });
    this.updateGhost(u);
  }

  /**
   * Orbit the camera round the focus. Yaw/pitch are inertial (ecliptic) angles at every zoom: zooming only changes the
   * distance, never the direction the camera looks from. The camera is kept outside the reference body.
   */
  private placeCamera(u: MapUpdate) {
    const d = this.renderedDistance, cp = Math.cos(this.pitch);
    const x = Math.cos(this.yaw) * cp, y = Math.sin(this.yaw) * cp, z = Math.sin(this.pitch);
    this.camera.position.set(x * d, y * d, z * d);
    this.surfaceBlend = 0;
    const ref = u.referenceBody ? this.bodies.get(u.referenceBody)?.body : undefined;
    if (ref) {
      const c = this.ephem.getBodyState(ref.id, u.t).position;
      const rx = u.focus.x - c.x, ry = u.focus.y - c.y, rz = u.focus.z - c.z;
      // Never inside the body: push the camera out along the body radius through it.
      const R = ref.radius * 1.01, cx = x * d + rx, cy = y * d + ry, cz = z * d + rz, cr = Math.hypot(cx, cy, cz);
      if (cr < R) this.camera.position.set(cx * R / cr - rx, cy * R / cr - ry, cz * R / cr - rz);
      this.surfaceBlend = 1 - smoothstep(ref.radius * 1.25, ref.radius * 1.6, cr);
    }
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
  }
  /**
   * Zoom towards the cursor round a body's centre: turn the camera so the ground first under the cursor stays under
   * it at the eased distance `r1`. `r0` is the distance of the frame the player saw when the wheel turned.
   */
  private turnToCursor(r0: number, r1: number, radius: number) {
    const a = this.zoomAnchor!, tanH = Math.tan(this.camera.fov * Math.PI / 360);
    const sx = a.x * tanH * this.camera.aspect, sy = a.y * tanH;
    if (!a.picked) {
      a.picked = pickSphere(this.yaw, this.pitch, r0, radius, sx, sy, a.ground);
      if (!a.picked) { this.zoomAnchor = null; return; }
    }
    if (!aimAt(this, r1, a.ground, sx, sy)) this.zoomAnchor = null;
  }
  /** Cursor (normalised device coordinates) of the last wheel zoom while it eases; null when not zooming to a point. */
  private zoomAnchor: { x: number; y: number; picked: boolean; ground: Vec3 } | null = null;
  /** Drag turn rate, radians per pixel. */
  private orbitRate = ORBIT_RATE;
  /** How close the camera is to the reference body's surface (1 = looking at the ground; fades other orbit lines). */
  private surfaceBlend = 0;
  private readonly poleScratch = new THREE.Vector3();
  private readonly quatScratch = new THREE.Quaternion();

  /** Faint SOI boundary for the hovered body and for every body the predicted path enters. */
  private updateSoiShells(u: MapUpdate) {
    let k = 0, ghosts = 0;
    const show = (vis: BodyVisual | undefined, opacity: number, time = u.t) => {
      if (!vis || !Number.isFinite(vis.body.soi) || k >= this.soiShells.length) return;
      for (let i = 0; i < k; i++) if (this.soiShells[i].userData.body === vis.body.id) return;
      const shell = this.soiShells[k++];
      shell.visible = true; shell.userData.body = vis.body.id;
      this.frame.scenePosition(ZERO, vis.body.id, u, shell.position, time); shell.scale.setScalar(vis.body.soi);
      shell.material.uniforms.uOpacity.value = opacity;
      // Where the encountered body will be: a ghost ring in its family colour.
      if (time !== u.t && ghosts < this.encounterGhosts.length) {
        const ghost = this.encounterGhosts[ghosts++];
        ghost.visible = true; ghost.position.copy(shell.position);
        ghost.scale.setScalar(ICON_PX.ghostBody * this.spritePx);
        const map = makeIconTexture(cssHex(vis.familyColor), true);
        if (ghost.material.map !== map) { ghost.material.map = map; ghost.material.needsUpdate = true; }
      }
    };
    show(this.hoverBody ?? undefined, 1);
    const patches = u.vessel?.patches ?? EMPTY_PATCHES;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      if (p.endReason === 'soiEnter' && p.nextBody && p.endTime > u.t) show(this.bodies.get(p.nextBody), .6, this.frame.patchFrameTime(u, patches[i + 1]));
    }
    for (let i = k; i < this.soiShells.length; i++) this.soiShells[i].visible = false;
    for (let i = ghosts; i < this.encounterGhosts.length; i++) this.encounterGhosts[i].visible = false;
  }

  // ---------- Maneuver nodes and gizmo ----------

  private nodePoints: MapPoint[] = [];
  /** True on-screen points of the nodes (nodeScreen holds where they are drawn, which may be nudged). */
  private nodeTruePoints: MapPoint[] = [];
  private nodeTrue = new Map<number, MapPoint>();
  private nodeLeaders: { el: HTMLDivElement; a: number; l: number; suffix: string }[] = [];
  private updateNodes(u: MapUpdate) {
    this.nodeScreen.clear(); this.nodeTrue.clear();
    let k = 0, gizmoAt = -1;
    const selected = this.gizmoNode(u), editable = !!(this.handlers.placeNode || this.handlers.nodesChanged);
    for (const n of u.vessel?.nodes ?? EMPTY_NODES) {
      const patch = this.patchAt(u, n.time);
      if (!patch) continue;
      let s = this.nodeIcons[k];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: nodeTexture('node'), sizeAttenuation: false, depthTest: false, transparent: true }));
        s.renderOrder = 13; this.nodeIcons[k] = s; this.scene.add(s);
      }
      s.visible = true;
      const texture = nodeTexture(n === selected ? 'selected' : 'node');
      if (s.material.map !== texture) s.material.map = texture;
      const hovered = (this.hover.kind === 'node' && this.hover.id === n.id) || (this.drag?.kind === 'node' && this.drag.nodeId === n.id);
      s.scale.setScalar((hovered ? ICON_PX.nodeHover : ICON_PX.node) * this.spritePx);
      this.frame.scenePosition(patchState(patch, n.time).position, patch.orbit.body, u, s.position, this.frame.patchFrameTime(u, patch));
      s.userData.nodeId = n.id;
      const truth = this.frame.toScreen(s.position, u, this.nodeTruePoints[k] ??= { x: 0, y: 0 }), point = this.nodePoints[k] ??= { x: 0, y: 0 };
      point.x = truth.x; point.y = truth.y;
      this.nodeTrue.set(n.id, truth);
      this.nodeScreen.set(n.id, point);
      if (editable && n === selected) gizmoAt = k;
      k++;
    }
    for (let i = k; i < this.nodeIcons.length; i++) this.nodeIcons[i].visible = false;
    // Nodes under a HUD panel are drawn (and grabbed) at the nearest clear spot, joined to the true point by a
    // leader line; drags still act on the true point (see Drag.offX). The gizmo node goes first and keeps its whole
    // gizmo clear; every nudged spot is reserved so later nodes and markers do not land on it.
    if (gizmoAt >= 0) this.nudgeNode(u, gizmoAt, GIZMO_CLEAR_PX);
    for (let i = 0; i < k; i++) if (i !== gizmoAt) this.nudgeNode(u, i, NODE_CLEAR_PX);
    for (let i = k; i < this.nodeLeaders.length; i++) setStyle(this.nodeLeaders[i].el, 'display', 'none');
  }

  private nudgeNode(u: MapUpdate, i: number, margin: number) {
    const truth = this.nodeTruePoints[i], point = this.nodePoints[i], rects = this.hudRects?.rects;
    const nudged = !!rects && Number.isFinite(truth.x)
      && nodeClearSpot(rects, this.obstacles, truth.x, truth.y, u.viewport.width, u.viewport.height, margin, NODE_CLEAR_PX, point);
    let leader = this.nodeLeaders[i];
    if (!nudged && !leader) return;
    if (!leader) {
      const el = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: '1px', height: '1.5px', transformOrigin: '0 0', pointerEvents: 'none', background: NODE_COLOR, opacity: '.8', display: 'none' });
      this.labels.appendChild(el);
      leader = this.nodeLeaders[i] = { el, a: NaN, l: -1, suffix: '' };
    }
    setStyle(leader.el, 'display', nudged ? 'block' : 'none');
    if (!nudged || !rects) return;
    this.fromScreen(point.x, point.y, this.nodeIcons[i].position, u, this.nodeIcons[i].position);
    const half = margin === GIZMO_CLEAR_PX ? HANDLE_OFFSET : ICON_PX.node / 2;
    const spot = rects[this.obstacles++] ??= { x: 0, y: 0, width: 0, height: 0 };
    spot.x = point.x - half; spot.y = point.y - half; spot.width = spot.height = 2 * half;
    const dx = truth.x - point.x, dy = truth.y - point.y, a = Math.round(Math.atan2(dy, dx) * 100), len = Math.round(Math.hypot(dx, dy));
    if (a !== leader.a || len !== leader.l) { leader.a = a; leader.l = len; leader.suffix = ` rotate(${a / 100}rad) scaleX(${len})`; }
    setPosition(leader.el, point.x, point.y, leader.suffix);
  }

  /** Scene point drawn at CSS-pixel (x, y), at the depth of `at`. */
  private fromScreen(x: number, y: number, at: THREE.Vector3, u: MapUpdate, out: THREE.Vector3): THREE.Vector3 {
    const p = this.projected.copy(at).project(this.camera);
    p.x = x / u.viewport.width * 2 - 1; p.y = 1 - y / u.viewport.height * 2;
    return out.copy(p.unproject(this.camera));
  }

  private updateGizmo(u: MapUpdate, dt: number) {
    const editable = !!(this.handlers.placeNode || this.handlers.nodesChanged);
    const node = editable ? this.gizmoNode(u) : undefined;
    const patch = node ? this.patchAt(u, node.time) : undefined;
    this.gizmoNodeId = node && patch ? node.id : null;
    const drag = this.drag;
    // Handles are rate controls: Δv keeps flowing while a handle is held out, even if the mouse is still.
    if (drag?.kind === 'handle' && node && drag.nodeId === node.id
      && applyHandle(node, this.gizmo[drag.index].handle, drag.pull, dt, this.fineTune) !== 0) this.handlers.nodesChanged?.();
    for (const g of this.gizmo) g.visible = g.line.visible = g.icon.visible = !!patch;
    if (!node || !patch) return;
    if (this.gizmoTime !== node.time || !this.gizmoOrbit || !sameOrbit(this.gizmoOrbit, patch.orbit)) {
      this.gizmoTime = node.time; this.gizmoOrbit = snapshotOrbit(patch.orbit);
      this.gizmoState = patchState(patch, node.time);
      this.gizmoDirs = { prograde: maneuverToInertialDv(this.gizmoState, { prograde: 1, normal: 0, radial: 0 }), normal: maneuverToInertialDv(this.gizmoState, { prograde: 0, normal: 1, radial: 0 }), radial: maneuverToInertialDv(this.gizmoState, { prograde: 0, normal: 0, radial: 1 }) };
    }
    const base = this.frame.scenePosition(this.gizmoState!.position, patch.orbit.body, u, this.gizmoBase, this.frame.patchFrameTime(u, patch));
    // A node nudged out from under a HUD panel carries its gizmo with it.
    const shown = this.nodeScreen.get(node.id), truth = this.nodeTrue.get(node.id);
    if (shown && truth && (shown.x !== truth.x || shown.y !== truth.y)) this.fromScreen(shown.x, shown.y, base, u, base);
    this.frame.toScreen(base, u, this.gizmoCenter);
    const worldPerPx = 2 * base.distanceTo(this.camera.position) * Math.tan(this.camera.fov * Math.PI / 360) / Math.max(1, u.viewport.height);
    // Constant screen size, but never much larger than the orbit the node sits on: zoomed far out a full-size
    // gizmo would bury the very trajectory being planned. Too small to edit: only the node marker remains.
    const at = this.gizmoState!.position, orbitPx = Math.hypot(at.x, at.y, at.z) / worldPerPx;
    const dragging = drag?.kind === 'handle';
    const show = orbitPx >= GIZMO_MIN_ORBIT_PX || dragging;
    // Constant screen distance at every zoom: zooming out to see the encounter must not crowd the handles onto
    // the node centre (which is what slides the node along the orbit).
    const offset = HANDLE_OFFSET;
    this.gizmoOffset = offset;
    this.gizmoIconPx = 24;
    for (let i = 0; i < this.gizmo.length; i++) {
      const g = this.gizmo[i], d = this.gizmoDirs![g.axis];
      const direction = this.gizmoDirection.set(d.x, d.y, d.z).multiplyScalar(g.sign).normalize();
      const held = drag?.kind === 'handle' && drag.index === i;
      // Foreshortened arms (handles pointing towards/away from the camera) are stretched to keep their distance;
      // one still too short points at the camera and is hidden. The held handle keeps its stretch while dragged.
      if (!held) {
        g.icon.position.copy(base).addScaledVector(direction, offset * worldPerPx);
        const s = this.frame.toScreen(g.icon.position, u, g.screen);
        g.stretch = handleStretch(Math.hypot(s.x - this.gizmoCenter.x, s.y - this.gizmoCenter.y), offset);
      }
      const px = (offset + (held ? Math.max(-offset * .7, Math.min(130, drag.pull)) : 0)) * g.stretch;
      g.line.position.copy(base);
      g.line.quaternion.copy(this.gizmoQuat.setFromUnitVectors(this.up, direction));
      g.line.scale.set(1, Math.max(1e-9, px * worldPerPx), 1);
      g.icon.position.copy(base).addScaledVector(direction, px * worldPerPx);
      g.icon.scale.setScalar((held || (this.hover.kind === 'handle' && this.hover.index === i) ? this.gizmoIconPx * 1.25 : this.gizmoIconPx) * this.spritePx);
      this.frame.toScreen(g.icon.position, u, g.screen);
      const armPx = Math.hypot(g.screen.x - this.gizmoCenter.x, g.screen.y - this.gizmoCenter.y);
      g.visible = g.line.visible = g.icon.visible = show && (held || armPx >= HANDLE_MIN_PX);
    }
  }

  private updateGhost(u: MapUpdate) {
    const h = this.hover, patch = h.kind === 'orbit' && !this.drag ? u.vessel?.patches[h.patch] : undefined;
    this.ghost.visible = !!patch;
    if (patch && h.kind === 'orbit') this.frame.scenePosition(patchState(patch, h.time).position, patch.orbit.body, u, this.ghost.position, this.frame.patchFrameTime(u, patch));
  }

  /** Sample the placeable part of each trajectory patch (from now, up to the next node or one revolution). */
  private rebuildTrajectoryPolys(u: MapUpdate) {
    const patches = u.vessel?.patches ?? EMPTY_PATCHES;
    this.polysVersion = this.lines.patchVersion; this.polysTime = u.t;
    let count = 0;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const from = Math.max(p.startTime, u.t + 1);
      const closed = patchDrawnClosed(p), T = period(p.orbit);
      const to = p.endReason !== 'maneuver' && closed ? from + T : p.endTime;
      if (!(to > from)) continue;
      const poly = this.trajectoryPolys[count] ??= { body: '', patch: 0, times: new Float64Array(241), points: new Float64Array(241 * 3), count: 0 };
      poly.body = p.orbit.body; poly.patch = i; poly.count = 241;
      for (let k = 0; k < 241; k++) {
        const time = from + (to - from) * k / 240, s = patchState(p, time).position;
        poly.times[k] = time; poly.points[k * 3] = s.x; poly.points[k * 3 + 1] = s.y; poly.points[k * 3 + 2] = s.z;
      }
      count++;
    }
    this.trajectoryPolys.length = count;
  }

  private readonly scratch = new THREE.Vector3();
  private readonly scratchPoint: MapPoint = { x: 0, y: 0 };
  private readonly markerCentre: MapPoint = { x: 0, y: 0 };
  /** Closest point of the active trajectory (future only) to a CSS-pixel position. */
  private hitTrajectory(x: number, y: number): { time: number; patch: number; distance: number } | null {
    const u = this.lastUpdate;
    if (!u?.vessel?.patches.length || !this.handlers.placeNode) return null;
    if (this.polysVersion !== this.lines.patchVersion || Math.abs(u.t - this.polysTime) > 1) this.rebuildTrajectoryPolys(u);
    let best: { time: number; patch: number; distance: number } | null = null;
    const line = this.screenLine;
    for (const poly of this.trajectoryPolys) {
      const b = this.frame.framedBodyPosition(poly.body, u, this.frame.patchFrameTime(u, u.vessel.patches[poly.patch]));
      line.n = poly.count;
      for (let k = 0; k < poly.count; k++) {
        this.scratch.set(b.x + poly.points[k * 3] - u.focus.x, b.y + poly.points[k * 3 + 1] - u.focus.y, b.z + poly.points[k * 3 + 2] - u.focus.z);
        const s = this.frame.toScreen(this.scratch, u, this.scratchPoint);
        line.x[k] = s.x; line.y[k] = s.y; line.t[k] = poly.times[k];
      }
      const hit = closestOnPolyline(line, x, y);
      if (hit && hit.time > u.t + 2 && (!best || hit.distance < best.distance)) best = { time: hit.time, patch: poly.patch, distance: hit.distance };
    }
    return best;
  }

  /** First time after `from` when a conic leaves its body's sphere of influence (Infinity when bound inside it). */
  private soiLimit(orbit: Orbit, from: number): number {
    const soi = this.bodies.get(orbit.body)?.body.soi ?? Infinity;
    if (!Number.isFinite(soi) || (orbit.e < 1 && apoapsisRadius(orbit) < soi)) return Infinity;
    const r = (t: number) => length(elementsToState(orbit, t).position);
    if (r(from) >= soi) return from;
    let lo = from, step = Number.isFinite(period(orbit)) ? period(orbit) / 64 : 600, hi = from + step;
    for (let i = 0; i < 400 && r(hi) < soi; i++) { lo = hi; step *= 1.25; hi += step; }
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (r(mid) < soi) lo = mid; else hi = mid; }
    return lo;
  }

  /** Slide a dragged node along its orbit to the point nearest the cursor. */
  private slideNode(d: Extract<Drag, { kind: 'node' }>, x: number, y: number) {
    const u = this.lastUpdate, node = u?.vessel?.nodes.find(n => n.id === d.nodeId);
    if (!u || !node) return;
    const [lo, hi] = slideWindow(node.time, d.period, d.earliest, d.latest);
    if (!(hi > lo)) return;
    const b = this.frame.framedBodyPosition(d.patch.orbit.body, u, this.frame.patchFrameTime(u, d.patch)), line = this.screenLine;
    const sample = (t0: number, t1: number, n: number) => {
      line.n = n + 1;
      for (let k = 0; k <= n; k++) {
        const time = t0 + (t1 - t0) * k / n, s = patchState(d.patch, time).position;
        this.scratch.set(b.x + s.x - u.focus.x, b.y + s.y - u.focus.y, b.z + s.z - u.focus.z);
        const p = this.frame.toScreen(this.scratch, u, this.scratchPoint);
        line.x[k] = p.x; line.y[k] = p.y; line.t[k] = time;
      }
      // ~6 px of preference across the window keeps the node on its current revolution where the orbit overlaps.
      return closestOnPolyline(line, x, y, { time: node.time, weight: 6 / (hi - lo) });
    };
    const coarse = sample(lo, hi, 480);
    if (!coarse) return;
    const step = (hi - lo) / 480;
    const fine = sample(Math.max(lo, coarse.time - step), Math.min(hi, coarse.time + step), 32);
    node.time = Math.max(lo, Math.min(hi, (fine ?? coarse).time));
    this.handlers.nodesChanged?.();
  }

  // ---------- Orbit markers ----------

  private bodyName = (id: string) => this.bodies.get(id)?.body.name ?? id;
  private bodyRadius = { radius: (id: string) => this.bodies.get(id)?.body.radius ?? 0, soi: (id: string) => this.bodies.get(id)?.body.soi ?? Infinity };

  private pushMarker(key: string, body: string, position: Vec3, caption: string, color: string, priority: number, glyph: MarkerGlyph, orbit?: OrbitMarker, detail?: string, dotOnly = false, time?: number) {
    const m = this.shown[this.shownCount] ??= { key: '', body: '', position, caption: '', color: '', priority: 0, glyph: 'dot' };
    m.key = key; m.body = body; m.position = position; m.caption = caption; m.color = color; m.priority = priority;
    m.orbit = orbit; m.detail = detail; m.dotOnly = dotOnly; m.time = time ?? orbit?.time; m.glyph = glyph; m.frameTime = undefined;
    this.shownCount++;
    return m;
  }

  private markerElement(i: number): MarkerElement {
    let el = this.markerEls[i];
    if (el) return el;
    const root = document.createElement('div'), dot = document.createElement('div'), text = document.createElement('div'), leader = document.createElement('div');
    Object.assign(root.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', display: 'none' });
    Object.assign(leader.style, { position: 'absolute', left: '0', top: '0', width: '1px', height: '1px', transformOrigin: '0 0', display: 'none', opacity: '.65' });
    Object.assign(dot.style, { position: 'absolute', left: `${-GLYPH_PX / 2}px`, top: `${-GLYPH_PX / 2}px`, width: `${GLYPH_PX}px`, height: `${GLYPH_PX}px`, lineHeight: '0' });
    Object.assign(text.style, { position: 'absolute', left: `${GLYPH_PX / 2 + 3}px`, top: '-9px', font: '600 12px system-ui, sans-serif', whiteSpace: 'pre', textShadow: LABEL_SHADOW, lineHeight: '17px', letterSpacing: '.02em' });
    root.appendChild(leader); root.appendChild(dot); root.appendChild(text);
    this.labels.appendChild(root);
    el = { root, dot, text, leader, leaderA: NaN, leaderL: -1, flipped: false, box: { x: 0, y: 0, width: 0, height: 17 }, content: '', color: '', glyph: '', caption: { x: 0, y: 0, width: 0, height: 0 }, measured: '', lines: 0 };
    this.markerEls[i] = el;
    return el;
  }

  private markerDetailText(m: ShownMarker, t: number) {
    return m.orbit ? markerDetail(m.orbit, t, this.bodyName) : m.detail ?? m.caption;
  }

  private updateMarkers(u: MapUpdate) {
    const patches = u.vessel?.patches ?? EMPTY_PATCHES;
    const key = `${this.lines.patchVersion}:${patches.length ? Math.floor(u.t) : 0}`;
    if (key !== this.orbitMarksKey) {
      this.orbitMarksKey = key;
      try { this.orbitMarks = orbitMarkers(patches, u.t, this.bodyRadius); } catch { this.orbitMarks = []; }
    }
    this.shownCount = 0;
    const planned = firstPlannedPatch(patches);
    for (const m of this.orbitMarks) {
      const apsis = m.kind === 'ap' || m.kind === 'pe';
      // Markers take the colour of the trajectory they sit on; an encounter takes the colour of the patch inside
      // the encountered body, so marker and arc read as one.
      const color = m.kind === 'impact' ? IMPACT_CSS : cssHex(patchColor(m.kind === 'encounter' ? m.patch + 1 : m.patch, planned));
      this.pushMarker(m.key, m.body, m.position, markerCaption(m, this.bodyName), color, apsis ? 1 : 2, m.kind, m).frameTime = this.frame.patchFrameTime(u, patches[m.patch]);
    }
    const markers = u.markers ?? EMPTY_MARKERS;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i], key = m.key ?? `ext:${i}`;
      this.pushMarker(key, m.body, m.position, m.label, m.color, 1, glyphForKey(key), undefined, m.detail, false, m.time);
    }
    const a = this.approach && this.bodies.has(this.approach.body) ? this.approach : null;
    if (a) {
      this.pushMarker('ca', a.body, a.positionA, a.label, TARGET_CSS, 2, 'approach', undefined, a.detail, false, a.time);
      this.pushMarker('ca:target', a.body, a.positionB, '', TARGET_CSS, 0, 'dot', undefined, a.detail, true, a.time);
    }
    this.approachLine.visible = !!a;
    if (a) {
      const pos = this.approachLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.frame.scenePosition(a.positionA, a.body, u, this.scratch); pos.setXYZ(0, this.scratch.x, this.scratch.y, this.scratch.z);
      this.frame.scenePosition(a.positionB, a.body, u, this.scratch); pos.setXYZ(1, this.scratch.x, this.scratch.y, this.scratch.z);
      pos.needsUpdate = true;
    }
    // Dots for every marker; captions in priority order (pinned first), decluttered against body labels.
    this.markerScreenCount = 0;
    const hudCount = this.hudCount, hudRects = this.hudRects?.rects ?? EMPTY_RECTS;
    let obstacles = this.obstacles;
    for (let i = 0; i < this.shownCount; i++) {
      const m = this.shown[i], el = this.markerElement(i);
      const s = this.frame.toScreen(this.frame.scenePosition(m.position, m.body, u, this.scratch, m.frameTime ?? u.t), u, this.scratchPoint);
      let on = s.x > -20 && s.y > -20 && s.x < u.viewport.width + 20 && s.y < u.viewport.height + 20;
      // Apsides of an orbit that is only a few pixels across are noise piled on the body icon: hide them until
      // the orbit is large enough to tell apart (pinned markers stay).
      // The focused body's own flyby periapsis always shows (it is what an encounter is planned for).
      if (on && (m.glyph === 'ap' || m.glyph === 'pe') && !this.pinned.has(m.key) && !(m.glyph === 'pe' && m.body === u.focusId && m.body !== patches[0]?.orbit.body)) {
        const sx = s.x, sy = s.y, c = this.frame.toScreen(this.frame.scenePosition(ZERO, m.body, u, this.scratch, m.frameTime ?? u.t), u, this.markerCentre);
        on = !(Math.hypot(c.x - sx, c.y - sy) < 16);
        s.x = sx; s.y = sy;
      }
      setStyle(el.root, 'display', on ? 'block' : 'none');
      el.box.x = NaN;
      if (!on) continue;
      // A marker under a HUD panel moves to the nearest clear spot, joined to its true point by a thin leader line;
      // the spot is reserved so a second covered marker does not land on top of it.
      let px = s.x, py = s.y, nudged = false;
      if (hudCount && coveredIndex(hudRects, hudCount, px, py, HUD_COVER_PX) >= 0
        && nudgeClear(hudRects, obstacles, px, py, u.viewport.width, u.viewport.height, HUD_CLEAR_PX, this.nudgeAt)) {
        px = this.nudgeAt.x; py = this.nudgeAt.y; nudged = true;
        const spot = hudRects[obstacles++] ??= { x: 0, y: 0, width: GLYPH_PX, height: GLYPH_PX };
        spot.x = px - GLYPH_PX / 2; spot.y = py - GLYPH_PX / 2; spot.width = GLYPH_PX; spot.height = GLYPH_PX;
      }
      setPosition(el.root, px, py);
      if (el.color !== m.color || el.glyph !== m.glyph) {
        el.color = m.color; el.glyph = m.glyph;
        el.dot.innerHTML = markerGlyphSvg(m.glyph, m.color); el.text.style.color = m.color; el.leader.style.background = m.color;
      }
      setStyle(el.leader, 'display', nudged ? 'block' : 'none');
      if (nudged) {
        const dx = s.x - px, dy = s.y - py, a = Math.round(Math.atan2(dy, dx) * 100), len = Math.round(Math.hypot(dx, dy));
        if (a !== el.leaderA || len !== el.leaderL) { el.leaderA = a; el.leaderL = len; el.leader.style.transform = `rotate(${a / 100}rad) scaleX(${len})`; }
      }
      el.box.x = px; el.box.y = py;
      const hit = this.markerScreen[this.markerScreenCount++] ??= { key: '', x: 0, y: 0 };
      hit.key = m.key; hit.x = px; hit.y = py;
    }
    for (let i = this.shownCount; i < this.markerEls.length; i++) setStyle(this.markerEls[i].root, 'display', 'none');
    // Captions: shown below only if they win placement this frame.
    const captioned = this.captioned;
    captioned.fill(false);
    let labelCount = this.labelCount;
    for (let pass = 3; pass >= 0; pass--) for (let i = 0; i < this.shownCount; i++) {
      const m = this.shown[i], el = this.markerEls[i], pinned = this.pinned.has(m.key);
      if (Number.isNaN(el.box.x) || (pinned ? 3 : m.priority) !== pass || m.dotOnly && !pinned) continue;
      const content = pinned ? this.markerDetailText(m, u.t) : m.caption;
      if (!content) continue;
      const box = el.caption;
      if (el.measured !== content) {
        el.measured = content;
        let lines = 0, longest = 0;
        for (let start = 0; start <= content.length; lines++) {
          let end = content.indexOf('\n', start);
          if (end < 0) end = content.length;
          longest = Math.max(longest, end - start);
          start = end + 1;
        }
        box.width = longest * 7 + 12; el.lines = lines;
      }
      box.x = el.box.x + GLYPH_PX / 2 + 3; box.y = el.box.y - 9; box.height = el.lines * 17 + (pinned ? 6 : 0);
      // A caption that would run under a HUD panel flips to the glyph's other side.
      const flip = hudCount > 0 && overlapsAny(box, hudRects, hudCount, 2);
      if (flip) box.x = el.box.x - GLYPH_PX / 2 - 3 - box.width;
      if (!pinned && (!placeLabel(box, this.labelBoxes, labelCount) || (flip && overlapsAny(box, hudRects, hudCount, 2)))) continue;
      this.labelBoxes[labelCount++] = box;
      captioned[i] = true;
      if (el.flipped !== flip) {
        el.flipped = flip;
        Object.assign(el.text.style, flip ? { left: 'auto', right: `${GLYPH_PX / 2 + 3}px`, textAlign: 'right' } : { left: `${GLYPH_PX / 2 + 3}px`, right: 'auto', textAlign: 'left' });
      }
      if (el.content !== content) { el.content = content; el.text.textContent = content; }
      setStyle(el.text, 'background', pinned ? '#0a1525dd' : 'none');
      setStyle(el.text, 'border', pinned ? `1px solid ${m.color}55` : 'none');
      setStyle(el.text, 'borderRadius', pinned ? '6px' : '0');
      setStyle(el.text, 'padding', pinned ? '3px 7px' : '0');
    }
    for (let i = 0; i < this.markerEls.length; i++) setStyle(this.markerEls[i].text, 'display', i < this.shownCount && captioned[i] ? 'block' : 'none');
    this.markerLabelCount = labelCount;
  }

  // ---------- Hover, tooltips and gestures ----------

  private computeHover(x: number, y: number): Hover {
    const man = this.hitManeuver(x, y);
    if (man.kind !== 'none') return man;
    for (let i = 0; i < this.markerScreenCount; i++) {
      const m = this.markerScreen[i];
      if (Math.hypot(m.x - x, m.y - y) < GLYPH_PX / 2 + 3) return { kind: 'marker', key: m.key };
    }
    const object = this.pickObject(x, y, false);
    if (object) return { kind: 'object', pick: object };
    const orbit = this.hitTrajectory(x, y);
    if (orbit && orbit.distance < 10) return { kind: 'orbit', ...orbit };
    const line = this.pickOrbitLine(x, y);
    return line ? { kind: 'object', pick: line } : NONE;
  }

  private tooltipText(h: Hover): string | null {
    const u = this.lastUpdate;
    if (!u) return null;
    switch (h.kind) {
      case 'handle': {
        const node = u.vessel?.nodes.find(n => n.id === h.nodeId), g = this.gizmo[h.index];
        if (!node) return null;
        const name = { prograde: ['Prograde', 'Retrograde'], normal: ['Normal', 'Anti-normal'], radial: ['Radial out', 'Radial in'] }[g.axis][g.sign > 0 ? 0 : 1];
        const total = `Δv ${Math.hypot(node.prograde, node.normal, node.radial).toFixed(1)} m/s`;
        if (this.drag?.kind === 'handle') return `${name} ${(node[g.axis] * g.sign).toFixed(1)} m/s · ${total}${this.fineTune ? ' · fine' : ''}`;
        return `${name} ${(node[g.axis] * g.sign).toFixed(1)} m/s · ${total}\nDrag outward to add Δv, back to remove · ${altKeyName()}+wheel for ${this.fineTune ? '0.01' : '0.1'} m/s steps`;
      }
      case 'node': {
        const node = u.vessel?.nodes.find(n => n.id === h.id);
        if (!node) return null;
        return `Maneuver · Δv ${Math.hypot(node.prograde, node.normal, node.radial).toFixed(1)} m/s\nT−${formatDuration(node.time - u.t)}\nClick for options · drag along the orbit to move`;
      }
      case 'marker': {
        for (let i = 0; i < this.shownCount; i++) if (this.shown[i].key === h.key) return `${this.markerDetailText(this.shown[i], u.t)}\n${this.pinned.has(h.key) ? 'Click to unpin' : 'Click to pin'}`;
        return null;
      }
      case 'object': {
        if (h.pick.kind === 'body') {
          const surface = this.surface.describe(this.pointer.x, this.pointer.y, { camera: this.camera, width: u.viewport.width, height: u.viewport.height });
          if (surface) return surface;
        }
        const extra = this.handlers.describe?.(h.pick) ?? null;
        if (h.pick.kind === 'vessel') return extra ?? h.pick.id;
        const b = this.bodies.get(h.pick.id)?.body;
        if (!b) return extra;
        const o = b.orbit;
        return `${b.name}\n${b.orbitalPeriod ? `Period ${formatDuration(b.orbitalPeriod)}` : 'Solar system primary'}${o ? `\nPe ${formatDistance(o.a*(1-o.e))} · Ap ${formatDistance(o.a*(1+o.e))}` : ''}${extra ? `\n${extra}` : ''}`;
      }
      case 'orbit': {
        const patch = u.vessel?.patches[h.patch];
        if (!patch) return null;
        const alt = length(patchState(patch, h.time).position) - (this.bodies.get(patch.orbit.body)?.body.radius ?? 0);
        return `T−${formatDuration(h.time - u.t)} · ${formatDistance(alt)}\nClick to add a maneuver node`;
      }
      default: return null;
    }
  }

  private setHover(h: Hover) {
    this.hover = h;
    this.lastHoverAt = performance.now();
    const body = h.kind === 'object' && h.pick.kind === 'body' ? this.bodies.get(h.pick.id) ?? null : null;
    this.hoverBody = body;
    // While a handle is held its live value stays visible; other drags hide the tooltip.
    const text = this.quiet || (this.drag && this.drag.kind !== 'handle') ? null : this.tooltipText(h);
    this.tooltip.style.display = text ? 'block' : 'none';
    if (text) {
      if (this.tooltip.textContent !== text) this.tooltip.textContent = text;
      const w = this.lastUpdate?.viewport.width ?? 1, hgt = this.lastUpdate?.viewport.height ?? 1;
      this.tooltip.style.left = `${Math.min(this.pointer.x + 18, w - 300)}px`;
      this.tooltip.style.top = `${Math.min(this.pointer.y + 18, hgt - 120)}px`;
    }
    if (this.element) this.element.style.cursor = this.drag?.kind === 'handle' || this.drag?.kind === 'node' ? 'grabbing'
      : h.kind === 'handle' || h.kind === 'node' ? 'grab' : h.kind === 'orbit' ? 'copy' : h.kind === 'none' ? '' : 'pointer';
  }

  /** Orbit line (body or other vessel) under a CSS-pixel position. */
  private pickOrbitLine(x: number, y: number): MapPick | null {
    const u = this.lastUpdate;
    if (!u) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / u.viewport.width * 2 - 1, 1 - y / u.viewport.height * 2), this.camera);
    ray.params.Line2 = { threshold: 7 };
    for (const [id, vis] of this.extras) if (vis.line?.visible && ray.intersectObject(vis.line)[0]) return { kind: 'vessel', id };
    for (const vis of this.orderedBodies) if (vis.orbitLine?.visible && ray.intersectObject(vis.orbitLine)[0]) return { kind: 'body', id: vis.body.id };
    return null;
  }

  /** Apsis readouts for UI. */
  static apsides(o: Orbit, bodyRadius: number) {
    return { pe: periapsisRadius(o) - bodyRadius, ap: apoapsisRadius(o) - bodyRadius };
  }

  /**
   * Mouse controls: left or right drag orbits the camera, the wheel zooms; maneuver and object gestures go to
   * `handlers`. Returns a disposer.
   */
  attachControls(el: HTMLElement, minDistance: () => number, enabled: () => boolean = () => true) {
    this.element = el;
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left; this.pointer.y = e.clientY - r.top;
      this.pointer.clientX = e.clientX; this.pointer.clientY = e.clientY;
      this.pointer.inside = pointerOnMap(el, e.target, this.pointer.x, this.pointer.y, r.width, r.height);
      return this.pointer;
    };
    const down = (e: PointerEvent) => {
      if (!enabled()) return;
      const p = local(e), u = this.lastUpdate;
      const h = this.computeHover(p.x, p.y);
      if (e.button === 0 && h.kind === 'handle') {
        const g = this.gizmo[h.index], dir = handleScreenDirection(g.screen.x - this.gizmoCenter.x, g.screen.y - this.gizmoCenter.y);
        this.drag = { kind: 'handle', nodeId: h.nodeId, index: h.index, x: e.clientX, y: e.clientY, dirX: dir.x, dirY: dir.y, pull: 0 };
        this.selectedNodeId = h.nodeId;
        e.preventDefault();
      } else if (e.button === 0 && h.kind === 'node' && u) {
        const node = u.vessel?.nodes.find(n => n.id === h.id), patch = node && this.patchAt(u, node.time);
        if (node && patch) {
          const shown = this.nodeScreen.get(node.id), truth = this.nodeTrue.get(node.id);
          this.drag = { kind: 'node', nodeId: node.id, x: e.clientX, y: e.clientY, moved: false, patch: { ...patch, orbit: snapshotOrbit(patch.orbit) },
            earliest: Math.max(u.t + 5, patch.startTime), latest: this.soiLimit(patch.orbit, Math.max(u.t, patch.startTime)), period: period(patch.orbit),
            offX: shown && truth ? truth.x - shown.x : 0, offY: shown && truth ? truth.y - shown.y : 0 };
          e.preventDefault();
        }
      }
      if (!this.drag) this.drag = { kind: 'camera', button: e.button, x: e.clientX, y: e.clientY, moved: false, hover: h };
      this.setHover(h);
    };
    let lx = 0, ly = 0;
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (!enabled()) { this.drag = null; return; }
      const d = this.drag;
      if (d?.kind === 'handle') { d.pull = handlePull(e.clientX - d.x, e.clientY - d.y, d.dirX, d.dirY); return; }
      if (d?.kind === 'node') {
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) { d.moved = true; this.tooltip.style.display = 'none'; }
        if (d.moved) this.slideNode(d, p.x + d.offX, p.y + d.offY);
        return;
      }
      if (d?.kind === 'camera') {
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) {
          d.moved = true; lx = d.x; ly = d.y; this.tooltip.style.display = 'none';
        }
        if (!d.moved) return;
        this.zoomAnchor = null;
        this.yaw -= (e.clientX - lx) * this.orbitRate;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + (e.clientY - ly) * this.orbitRate));
        lx = e.clientX; ly = e.clientY;
        return;
      }
      if (!p.inside) { if (this.hover.kind !== 'none' || this.tooltip.style.display !== 'none') this.setHover(NONE); return; }
      if (this.quiet && Math.hypot(p.x - this.quiet.x, p.y - this.quiet.y) > 8) this.quiet = null;
      this.setHover(this.computeHover(p.x, p.y));
    };
    const up = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d || !enabled()) return;
      const p = local(e);
      if (d.kind === 'node' && !d.moved) {
        this.selectedNodeId = d.nodeId;
        this.quiet = { x: p.x, y: p.y };
        this.handlers.nodeClicked?.(d.nodeId, this.nodeScreenPosition(d.nodeId) ?? { x: p.x, y: p.y });
      } else if (d.kind === 'camera' && !d.moved) {
        const h = this.computeHover(p.x, p.y);
        if (h.kind === 'marker' && d.button === 0) {
          if (!this.pinned.delete(h.key)) this.pinned.add(h.key);
        } else if (h.kind === 'object' && (d.button === 0 || d.button === 2)) {
          this.quiet = { x: p.x, y: p.y };
          this.handlers.objectMenu?.(h.pick, { x: p.x, y: p.y });
        } else if (h.kind === 'orbit' && d.button === 0) {
          const now = performance.now();
          if (now - this.lastPlaced > 450) { this.lastPlaced = now; this.handlers.placeNode?.(h.time); }
        } else if (h.kind === 'marker' && d.button === 2 && this.handlers.markerMenu) {
          const m = this.shown.slice(0, this.shownCount).find(x => x.key === h.key);
          this.quiet = { x: p.x, y: p.y };
          if (m) this.handlers.markerMenu({ key: m.key, label: m.orbit ? (m.orbit.kind === 'ap' ? 'Apoapsis' : m.orbit.kind === 'pe' ? 'Periapsis' : markerCaption(m.orbit, this.bodyName)) : m.key.startsWith('ca') ? 'Closest approach' : m.caption, time: m.time, pinned: this.pinned.has(m.key) }, { x: p.x, y: p.y });
        } else if (h.kind === 'orbit' && d.button === 2 && this.handlers.orbitMenu) {
          this.quiet = { x: p.x, y: p.y };
          this.handlers.orbitMenu(h.time, { x: p.x, y: p.y });
        } else if (h.kind === 'node' && d.button === 2) {
          this.selectedNodeId = h.id;
          this.quiet = { x: p.x, y: p.y };
          this.handlers.nodeClicked?.(h.id, this.nodeScreenPosition(h.id) ?? { x: p.x, y: p.y });
        } else this.handlers.emptyClick?.();
      }
      this.setHover(p.inside ? this.computeHover(p.x, p.y) : NONE);
    };
    const dblclick = (e: MouseEvent) => {
      if (!enabled()) return;
      const p = local(e), h = this.computeHover(p.x, p.y);
      if (h.kind === 'object') this.handlers.focus?.(h.pick);
    };
    const wheel = (e: WheelEvent) => {
      if (!enabled()) return;
      e.preventDefault();
      // The wheel always zooms (trackpad scrolls arrive as streams of small wheel events, and a stray scroll over
      // a handle must never change the burn). Alt/Option + wheel over a handle is the deliberate fine Δv step.
      if (e.altKey) {
        const p = local(e), h = this.computeHover(p.x, p.y), u = this.lastUpdate;
        if (h.kind === 'handle' && u) {
          const node = u.vessel?.nodes.find(n => n.id === h.nodeId);
          if (node && applyWheel(node, this.gizmo[h.index].handle, e.deltaY || e.deltaX, this.fineTune) !== 0) this.handlers.nodesChanged?.();
          this.setHover(h);
          return;
        }
      }
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, el.clientHeight || 800);
      this.distance = Math.max(minDistance(), Math.min(5e13, this.distance * factor));
      this.zoomCount++;
      const p = local(e), w = el.clientWidth || 1, h = el.clientHeight || 1;
      this.zoomAnchor = { x: p.x / w * 2 - 1, y: 1 - p.y / h * 2, picked: false, ground: { x: 0, y: 0, z: 0 } };
    };
    const menu = (e: Event) => e.preventDefault();
    const leave = () => { this.pointer.inside = false; if (!this.drag) this.setHover(NONE); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('dblclick', dblclick);
    el.addEventListener('contextmenu', menu);
    el.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('dblclick', dblclick);
      el.removeEventListener('contextmenu', menu);
      el.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      if (this.element === el) { el.style.cursor = ''; this.element = null; }
    };
  }

  /**
   * Make every lazily shown map object visible (true) for a shader pre-compile pass, then hide them again
   * (false), so the first node, gizmo or planned trajectory does not stall on a program compile.
   */
  setWarmup(on: boolean) {
    for (const o of this.warmObjects) o.visible = on;
  }

  /** Pin or unpin an orbit marker's detail label. */
  togglePin(key: string) { if (!this.pinned.delete(key)) this.pinned.add(key); }

  /** Show the built-in focus breadcrumb (hosts with their own focus readout turn it off). */
  showBreadcrumb = true;

  /** Camera distance drawn this frame (eased towards `distance`). */
  get viewDistance() { return this.renderedDistance || this.distance; }

  /** Start the eased camera distance from `d` (e.g. a zoom-out transition when the map opens). */
  animateFrom(d: number) {
    if (d > 0 && Number.isFinite(d)) this.renderedDistance = d;
  }

  setVisible(visible: boolean) {
    this.labels.style.display = visible ? 'block' : 'none';
    if (!visible) { this.drag = null; this.pointer.inside = false; this.setHover(NONE); this.ghost.visible = false; }
  }

  /**
   * CSS selector of the HUD blocks that sit above the map and take pointer events. Markers and captions under
   * them are nudged clear (empty disables it). The rectangles are measured only when the HUD changes.
   */
  setHudBlocks(selector: string) {
    if (selector && !this.hudRects) this.hudRects = new HudRectCache();
    this.hudRects?.setSelector(selector);
  }

  dispose() {
    this.hudRects?.dispose();
    for (const fx of this.comets.values()) fx.dispose();
    this.comets.clear();
    this.sunGlow.material.map?.dispose();
    for (const texture of this.resourceTextures.values()) texture.dispose();
    this.surface.dispose();
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

type SurfaceFrameArgs = Parameters<SurfaceLayers['update']>[0];
/** Drag turn rate far from a surface, radians per pixel. */
const ORBIT_RATE = 0.005;

function smoothstep(e0: number, e1: number, x: number) {
  const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
}
