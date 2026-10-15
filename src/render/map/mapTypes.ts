import type { Network } from '../../sim/comms/network';
import type { TrajectoryPatch, ManeuverNode, Orbit } from '../../sim/orbit/api';
import type { Vec3 } from '../../util/vec3';

export interface MapMarkerInput {
  body: string;
  position: Vec3;
  /** Caption drawn next to the marker. */
  label: string;
  color: string;
  /** Stable identity (keeps a pinned marker pinned across frames). */
  key?: string;
  /** Hover / pinned detail (defaults to the label). */
  detail?: string;
  /** UT of the event the marker stands for (enables "warp here"). */
  time?: number;
}

export interface MapUpdate {
  landing?: { body: string; points: Vec3[]; times: number[]; impact: { time: number; position: Vec3; speed: number } | null };
  comms?: Network;
  t: number;
  /** Optional stable identity enables focus animation while the object moves. */
  focusId?: string;
  /** Body ancestry to display when the focus is a vessel. */
  referenceBody?: string;
  /** Heliocentric position of the focused object (float64). */
  focus: Vec3;
  /** Active vessel trajectory (patched conics) and its heliocentric position. */
  vessel?: { id?: string; position: Vec3; patches: TrajectoryPatch[]; nodes: ManeuverNode[] };
  markers?: MapMarkerInput[];
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
  /** Hover / pinned detail (defaults to the label). */
  detail?: string;
  /** UT of closest approach. */
  time?: number;
}

/** A body or vessel under the cursor. */
export interface MapPick { kind: 'body' | 'vessel'; id: string }
/** CSS pixels relative to the map's element. */
export interface MapPoint { x: number; y: number }

/** Callbacks from map gestures. Absent handlers disable the gesture (e.g. node editing in Fleet Tracking). */
export interface MapHandlers {
  /** Click on the active trajectory: add a maneuver node at `time`. Enables ghost nodes and the gizmo. */
  placeNode?(time: number): void;
  /** A node's Δv or time was changed by a gizmo gesture. */
  nodesChanged?(): void;
  /** Click on a node centre (without dragging it). */
  nodeClicked?(id: number, at: MapPoint): void;
  /** Left click or right click on a body/vessel icon or orbit. */
  objectMenu?(pick: MapPick, at: MapPoint): void;
  /** Double click on a body/vessel icon or orbit. */
  focus?(pick: MapPick): void;
  /** Click on empty space (close menus). */
  emptyClick?(): void;
  /** Extra tooltip lines for a hovered body/vessel (distance, relative speed…). */
  describe?(pick: MapPick): string | null;
  /** Right click on an orbit marker (Ap, Pe, encounter, closest approach…). */
  markerMenu?(marker: { key: string; label: string; time?: number; pinned: boolean }, at: MapPoint): void;
  /** Right click on the active trajectory at `time`. */
  orbitMenu?(time: number, at: MapPoint): void;
}
