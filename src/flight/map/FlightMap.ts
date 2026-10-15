import { LandingPredictionDriver } from './LandingPredictionDriver';
import type { FlightController } from '../controller';
import type { WorldVessel } from '../../game/world';
import type { MapPick, MapPoint } from '../../render/map/MapView';
import { CLOSEST_APPROACH_LEAD, focusCycle, mapContextActions, pathPointWarpTime, nextFocus, pathPointActions, sameObject, type MapAction, type MapActionId, type MapObject, type MapPathPoint } from '../../ui/map/mapActions';
import { formatDuration } from '../../util/format';
import { isTyping, matches } from '../../input/bindings';
import { formatDistance, formatSpeed } from '../../util/format';
import { add, length, scale, sub, type Vec3 } from '../../util/vec3';
import { qConj, qRotate } from '../../util/quat';
import type { TrajectoryPatch } from '../../sim/orbit/api';
import { patchState } from '../../sim/orbit/numericalPrediction';
import { AutoFramer, UNDECIDED, ascentAngles, ascentFrame, ascentMinDistance, ascentPhase, firstTransition, pathFrameDistance } from './framing';
import { nodeSummary, patchAtNode } from './nodeInfo';
import { cycleNodeId, nodeKeyCommand, nudged } from '../../ui/map/nodeKeys';

export interface MapMenus {
  /** Node whose menu is open. */
  node: number | null;
  /** Right-click / click context menu for an object or a point on the predicted path. */
  context: { obj?: MapObject; point?: MapPathPoint; x: number; y: number } | null;
  /** Info card. */
  info: MapObject | null;
}

const FOCUS_KINDS = new Set(['star', 'planet', 'dwarf', 'moon']);

/**
 * Flight-scene map interaction state: camera focus (Tab cycling, double-click, Home), the node menu, context
 * menu actions and maneuver-node commands. `world.nodes` stays the single source of truth for maneuvers.
 */
export class FlightMap {
  /** Focused object; null frames the active vessel around its body. */
  focus: MapObject | null = null;
  /** Active vessel and body of an ascent in progress ('' once in orbit), and its current view. */
  private ascentKey = '';
  private ascent: { centre: Vec3; distance: number } | null = null;
  readonly landing: LandingPredictionDriver;
  menus: MapMenus = { node: null, context: null, info: null };
  private listeners = new Set<() => void>();
  private hinted = false;
  private readonly autoFrame = new AutoFramer();
  private readonly keydown = (e: KeyboardEvent) => {
    const c = this.c;
    if (!c.mapMode || c.paused || e.repeat || isTyping(e.target)) return;
    if (matches('mapFocusNext', e)) { e.preventDefault(); this.cycle(e.shiftKey ? -1 : 1); }
    else if (matches('mapFocusHome', e)) { e.preventDefault(); this.setFocus(null); }
    else if (e.code === 'Delete') {
      const id = this.menus.node ?? this.c.map.selectedNodeId;
      if (id !== null && this.world.nodes.some(n => n.id === id)) { e.preventDefault(); this.deleteNode(id); }
    }
  };
  /**
   * Node keys (see ui/map/nodeKeys) run in the capture phase and are consumed, so the arrows do not also orbit the
   * hidden flight camera. Held keys repeat. Only active with a node to edit, outside text fields and modals.
   */
  private readonly nodeKeydown = (e: KeyboardEvent) => {
    const c = this.c, w = this.world;
    if (!c.mapMode || c.paused || c.modalOpen || !w.nodes.length || isTyping(e.target)) return;
    if (e.target instanceof Element && e.target.closest('[aria-modal="true"]')) return;
    const cmd = nodeKeyCommand(e, c.map.fineTune);
    if (!cmd) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (cmd.kind === 'cycle') {
      if (e.repeat) return;
      const id = cycleNodeId(w.nodes, this.menus.node ?? c.map.selectedNodeId, cmd.dir);
      if (id !== null) this.openNode(id);
      return;
    }
    this.nudgeNode(cmd.axis, cmd.sign, cmd.step);
  };

  constructor(private c: FlightController) {
    this.landing = new LandingPredictionDriver(c);
    c.map.handlers = {
      placeNode: (time) => this.placeNode(time),
      nodesChanged: () => this.sortNodes(),
      nodeClicked: (id) => { this.menus = { ...this.menus, node: this.menus.node === id ? null : id, context: null }; this.emit(); },
      objectMenu: (pick, at) => this.openContext(pick, at),
      focus: (pick) => { this.setFocus(pick); this.closeMenus(); },
      emptyClick: () => this.closeMenus(),
      describe: (pick) => this.describe(pick),
      markerMenu: (m, at) => this.openPoint({ label: m.label, time: m.time, key: m.key, pinned: m.pinned }, at),
      orbitMenu: (time, at) => this.openPoint({ label: `T−${formatDuration(time - this.world.ut)}`, time, orbit: true }, at),
    };
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keydown', this.nodeKeydown, true);
  }

  dispose() {
    this.landing.dispose();
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keydown', this.nodeKeydown, true);
    this.listeners.clear();
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach(fn => fn()); }

  closeMenus() {
    if (!this.menus.node && !this.menus.context && !this.menus.info) return;
    this.menus = { node: null, context: null, info: null };
    this.emit();
  }

  closeInfo() { this.menus = { ...this.menus, info: null }; this.emit(); }

  /**
   * Map opened or closed: drop menus. A focus the player picked stays, with its view, until they change it (for the
   * flight scene's lifetime, not saved); following the active vessel frames its orbit again.
   */
  reset() {
    const f = this.focus, w = this.world;
    if (f && !(f.kind === 'body' ? w.universe.bodies.has(f.id) : f.id !== w.activeId && w.vessels.has(f.id))) this.focus = null;
    if (!this.focus) this.frameOrbit();
    this.menus = { node: null, context: null, info: null };
    this.emit();
  }

  private get world() { return this.c.world; }

  // ---------- Focus ----------

  /**
   * Focus position/identity for this frame; invalid focus falls back to the active vessel. `patches` is the path
   * the map draws this frame (no prediction is started here).
   */
  focusFrame(active: WorldVessel, origin: Vec3, patches: readonly TrajectoryPatch[]): { position: Vec3; focusId: string; referenceBody: string } {
    const f = this.focus, w = this.world;
    if (this.pendingBiome) this.lookAtPendingBiome();
    if (f?.kind === 'body' && w.universe.bodies.has(f.id)) return { position: w.universe.ephem.getBodyState(f.id, w.ut).position, focusId: f.id, referenceBody: f.id };
    const v = f?.kind === 'vessel' && f.id !== w.activeId ? w.vessels.get(f.id) : undefined;
    if (v) return { position: v.state.position, focusId: `vessel:${v.state.id}`, referenceBody: v.body };
    if (f && !(f.kind === 'vessel' && f.id === w.activeId)) this.focus = null;
    const bodyState = w.universe.ephem.getBodyState(active.body, w.ut);
    const thrusting = active.state.telemetry.thrust > 0;
    // Following the vessel: frame the new primary after an SOI change, and an encounter/escape (or its loss on
    // capture) as it appears on the flown path, unless the player has zoomed since.
    const ascentWas = this.ascentKey;
    const ascent = this.ascentView(active);
    const i = firstTransition(patches, active.body);
    // Reaching orbit (or landing again) changes what the map centres on: frame the new view.
    if (this.ascentKey !== ascentWas) this.frameActive(patches);
    else if (this.autoFrame.update(active.body, i === UNDECIDED ? null : patches[i], this.c.map.zoomCount, performance.now(), thrusting)) this.frameActive(patches);
    if (ascent) {
      if (thrusting) this.c.map.distance = Math.max(this.c.map.distance, ascent.distance);
      return { position: add(bodyState.position, ascent.centre), focusId: `ascent:${active.body}`, referenceBody: active.body };
    }
    // The local body remains central; enlarge the frame only if a burn carries the vessel out of view.
    if (thrusting) {
      const dx = origin.x - bodyState.position.x, dy = origin.y - bodyState.position.y, dz = origin.z - bodyState.position.z;
      this.c.map.distance = Math.max(this.c.map.distance, Math.sqrt(dx * dx + dy * dy + dz * dz) * 2.8);
    }
    // Zooming never moves the focus: close views come from zooming towards the cursor (MapView) round the centre.
    return { position: bodyState.position, focusId: active.body, referenceBody: active.body };
  }

  /** Biome to show once its map has been built (see showBiome). */
  private pendingBiome: { body: string; biome: string } | null = null;

  /**
   * Turn the map to a biome of `body`: focus the body and look down on the region of that biome nearest the
   * active vessel (or its largest). Waits for the body's biome map when it is still being built.
   */
  showBiome(body: string, biome: string) {
    this.setFocus({ kind: 'body', id: body });
    this.pendingBiome = { body, biome };
    this.lookAtPendingBiome();
  }

  private lookAtPendingBiome() {
    const p = this.pendingBiome, w = this.world;
    if (!p) return;
    if (this.focus?.kind !== 'body' || this.focus.id !== p.body) { this.pendingBiome = null; return; }
    const v = w.active;
    let near: Vec3 | undefined;
    if (v && v.body === p.body) {
      const rel = sub(v.state.position, w.universe.ephem.getBodyState(p.body, w.ut).position);
      near = qRotate(qConj(w.universe.ephem.bodyRotation(p.body, w.ut)), rel);
    }
    const anchor = this.c.map.biomeAnchor(p.body, p.biome, near && length(near) > 0 ? scale(near, 1 / length(near)) : undefined);
    if (!anchor) return;
    this.pendingBiome = null;
    this.c.map.lookAtSurface(p.body, anchor, w.ut);
  }

  /** Change focus (null = active vessel) and frame the new object. */
  setFocus(obj: MapObject | null) {
    const w = this.world, map = this.c.map;
    const active = w.active;
    if (obj?.kind === 'vessel' && obj.id === w.activeId) obj = null;
    if (obj?.kind === 'body' && !w.universe.bodies.has(obj.id)) return;
    if (obj?.kind === 'vessel' && !w.vessels.has(obj.id)) return;
    this.focus = obj;
    if (obj?.kind === 'body') {
      const b = w.universe.body(obj.id);
      // A body the predicted path enters is framed by its SOI, so the flyby and its periapsis are in view.
      const encountered = Number.isFinite(b.soi) && w.trajectory().some(p => p.orbit.body === b.id) && b.id !== active?.body;
      map.distance = Math.max(b.radius * (b.kind === 'star' ? 8 : 5), this.minDistance() * 1.5, encountered ? b.soi * 1.8 : 0);
    } else if (obj) {
      const v = w.vessels.get(obj.id);
      if (v) map.distance = this.vesselFrameDistance(v);
    } else this.frameActive(w.mapTrajectory());
    this.emit();
  }

  /** Frame the active vessel's orbit and the first SOI change on its path (map opened, "Frame active orbit"). */
  frameOrbit() {
    const v = this.world.active;
    if (!v) return;
    this.focus = null;
    this.frameActive(this.world.mapTrajectory());
    if (this.ascent) {
      const rs = this.world.relativeState(v);
      const north = qRotate(this.world.universe.ephem.bodyRotation(v.body, this.world.ut), { x: 0, y: 0, z: 1 });
      Object.assign(this.c.map, ascentAngles(rs.position, rs.velocity, north));
    }
  }

  private frameActive(patches: readonly TrajectoryPatch[]) {
    const v = this.world.active;
    if (!v) return;
    const i = firstTransition(patches, v.body), transition = patches[i];
    const ascent = this.ascentView(v);
    this.c.map.distance = ascent ? ascent.distance : this.vesselFrameDistance(v, transition);
    this.autoFrame.framed(v.body, i === UNDECIDED ? null : transition, this.c.map.zoomCount, performance.now());
  }

  /**
   * From the ground until orbit the active vessel's view is centred between it and its apoapsis instead of on the
   * body's centre (which puts a climbing rocket at the bottom edge of the frame). Null once it has reached orbit.
   */
  private ascentView(v: WorldVessel): { centre: Vec3; distance: number } | null {
    const w = this.world, b = w.universe.body(v.body), rs = w.relativeState(v);
    const key = `${v.state.id}:${v.body}`;
    const landed = v.mode === 'prelaunch' || v.state.situation !== 'flying';
    const on = ascentPhase(this.ascentKey === key, landed, rs.position, rs.velocity, b.gm, b.radius + (b.atmosphere?.height ?? 0));
    this.ascentKey = on ? key : '';
    this.ascent = on ? ascentFrame(rs.position, rs.velocity, b.gm, b.radius) : null;
    return this.ascent;
  }

  /** Local orbit of `v`, widened to include the SOI change ending patch `p` (an encounter or escape). */
  private vesselFrameDistance(v: WorldVessel, p?: TrajectoryPatch): number {
    const w = this.world, body = w.universe.body(v.body);
    let orbit;
    try { orbit = w.orbitOf(v); } catch { /* on the launch pad */ }
    let reach = 0;
    if (p?.nextBody) {
      const at = length(patchState(p, p.endTime).position);
      reach = p.endReason === 'soiEnter' ? at + (w.universe.bodies.get(p.nextBody)?.soi ?? 0) : Math.max(at, Number.isFinite(body.soi) ? body.soi : 0);
    }
    return pathFrameDistance(body.radius, length(w.relativeState(v).position), orbit, reach);
  }

  /** Planning preserves the local orbit; the complete transfer overview is an explicit action. */
  frameTransfer(_targetId: string) { this.frameOrbit(); this.emit(); }

  frameTransferOverview(targetId: string) {
    const w = this.world, active = w.active, target = w.universe.bodies.get(targetId);
    if (!active || !target?.orbit) return;
    this.focus = { kind: 'body', id: active.body };
    const reach = target.parent === active.body ? target.orbit.a * (1 + target.orbit.e) + target.soi : w.universe.body(active.body).soi;
    this.c.map.distance = Math.max(w.universe.body(active.body).radius * 4, reach * 2.6);
    this.emit();
  }

  /** Closest allowed camera distance for the current focus. */
  minDistance(): number {
    const w = this.world, f = this.focus;
    if (f?.kind === 'body' && w.universe.bodies.has(f.id)) return centredMinDistance(w.universe.body(f.id));
    const v = f?.kind === 'vessel' ? w.vessels.get(f.id) ?? w.active : w.active;
    if (!v) return 1500;
    const b = w.universe.body(v.body);
    const map = this.c.map;
    if (!f || f.id === w.activeId) return this.ascent ? ascentMinDistance(this.ascent.centre, map.yaw, map.pitch, b.radius) : centredMinDistance(b);
    const r = length(sub(v.state.position, w.universe.ephem.getBodyState(b.id, w.ut).position));
    return b.radius * (b.solidSurface && r < b.radius * 1.6 ? 0.12 : 1.15);
  }

  /** Focus objects in Tab order. */
  focusList(): MapObject[] {
    const w = this.world, wv = w.active;
    if (!wv) return [];
    const body = w.universe.body(wv.body);
    const trajectory: string[] = [];
    for (const p of w.trajectory()) { trajectory.push(p.orbit.body); if (p.nextBody) trajectory.push(p.nextBody); }
    const kind = w.targetKind();
    const children = body.children.map(id => w.universe.body(id)).filter(b => FOCUS_KINDS.has(b.kind))
      .sort((a, b) => (a.orbit?.a ?? 0) - (b.orbit?.a ?? 0)).map(b => b.id);
    return focusCycle({ activeVessel: wv.state.id, activeBody: wv.body, trajectoryBodies: trajectory, target: kind ? { kind, id: w.targetId! } : null, children });
  }

  cycle(dir: 1 | -1) {
    const w = this.world;
    const current = this.focus ?? (w.activeId ? { kind: 'vessel' as const, id: w.activeId } : null);
    const next = nextFocus(this.focusList(), current, dir);
    if (next && !sameObject(next, current)) this.setFocus(next);
  }

  // ---------- Context menu ----------

  private openContext(obj: MapObject, at: MapPoint) {
    this.menus = { node: null, info: null, context: { obj, x: at.x, y: at.y } };
    this.emit();
  }

  private openPoint(point: MapPathPoint, at: MapPoint) {
    this.menus = { node: null, info: null, context: { point, x: at.x, y: at.y } };
    this.emit();
  }

  pointActions(point: MapPathPoint): MapAction[] {
    const c = this.c;
    return pathPointActions(point, { now: this.world.ut, canWarp: !c.network && !c.assist, canPlan: !!this.world.active && this.world.active.mode !== 'prelaunch' });
  }

  runPoint(id: MapActionId, point: MapPathPoint) {
    this.menus = { ...this.menus, context: null };
    if (id === 'addNode' && point.time !== undefined) this.placeNode(point.time);
    else if (id === 'warpPoint' && point.time !== undefined) this.warp(point.orbit ? 'Selected point' : point.label, pathPointWarpTime(point)!);
    else if ((id === 'pin' || id === 'unpin') && point.key) this.c.map.togglePin(point.key);
    this.emit();
  }

  name(obj: MapObject): string {
    const w = this.world;
    return obj.kind === 'vessel' ? w.vessels.get(obj.id)?.state.name ?? obj.id : w.universe.bodies.get(obj.id)?.name ?? obj.id;
  }

  private soiChanges() {
    const out: { body: string; time: number }[] = [];
    for (const p of this.world.trajectory()) {
      if (p.endReason === 'soiEnter' && p.nextBody) out.push({ body: p.nextBody, time: p.endTime });
      if (p.endReason === 'soiExit') out.push({ body: p.orbit.body, time: p.endTime });
    }
    return out;
  }

  actions(obj: MapObject): MapAction[] {
    const w = this.world, c = this.c;
    const ca = w.targetId && !w.preciseGravity ? w.closestApproach() : null;
    return mapContextActions(obj, {
      activeId: w.activeId, activeBody: w.active?.body, targetId: w.targetId,
      canTarget: true, canSwitch: !c.network, canWarp: !c.network && !c.assist,
      approach: ca && w.targetId ? { id: w.targetId, time: ca.time } : null,
      soiChanges: this.soiChanges(), now: w.ut, name: (o) => this.name(o),
    });
  }

  run(id: MapActionId, obj: MapObject) {
    const w = this.world, c = this.c;
    this.menus = { ...this.menus, context: null };
    switch (id) {
      case 'focus': this.setFocus(obj); break;
      case 'target': c.setTarget(obj.id); break;
      case 'untarget': c.setTarget(null); break;
      case 'warpApproach': {
        const ca = w.closestApproach();
        if (ca) this.warp('Closest approach', ca.time - CLOSEST_APPROACH_LEAD);
        break;
      }
      case 'warpSoi': {
        const soi = this.soiChanges().find(s => s.body === obj.id && s.time > w.ut);
        if (soi) this.warp(`${this.name(obj)} SOI change`, soi.time - 5);
        break;
      }
      case 'switch':
        if (w.switchTo(obj.id)) { this.focus = null; c.map.selectedNodeId = null; w.message(`Switched to ${w.active!.state.name}`); }
        break;
      case 'info': this.menus = { ...this.menus, info: obj }; break;
    }
    this.emit();
  }

  private warp(label: string, time: number) {
    const c = this.c;
    if (c.network || c.paused) return;
    if (c.assist) return void c.world.message('Assist is controlling time warp', 'warn');
    const err = c.warpDriver.startAt(c.world, label, time);
    c.world.message(err ?? `Warping to ${label}`, err ? 'warn' : 'info', 2);
  }

  /** Tooltip lines for hovered bodies/vessels: distance and relative speed from the active vessel. */
  describe(pick: MapPick): string | null {
    const w = this.world, wv = w.active;
    const own = wv && pick.kind === 'vessel' && pick.id === wv.state.id;
    let state: { position: Vec3; velocity: Vec3 } | null = null;
    let name = this.name(pick);
    if (pick.kind === 'vessel') {
      const v = w.vessels.get(pick.id);
      if (!v) return null;
      state = v.state;
      name = `${v.state.name}${own ? ' (active)' : ''}\n${w.universe.body(v.body).name} · ${v.mode === 'prelaunch' ? 'prelaunch' : v.state.situation}`;
    } else if (w.universe.bodies.has(pick.id)) state = w.universe.ephem.getBodyState(pick.id, w.ut);
    if (!wv || !state || own) return pick.kind === 'vessel' ? name : null;
    const d = length(sub(state.position, wv.state.position)), rel = length(sub(state.velocity, wv.state.velocity));
    const lines = `Distance ${formatDistance(d)}\nRelative speed ${formatSpeed(rel)}${w.targetId === pick.id ? '\nTarget' : ''}`;
    return pick.kind === 'vessel' ? `${name}\n${lines}` : lines;
  }

  // ---------- Maneuver nodes ----------

  /** Keep `world.nodes` in time order: readouts and executors treat `nodes[0]` as the next burn. */
  private sortNodes() {
    const nodes = this.world.nodes;
    for (let i = 1; i < nodes.length; i++) if (nodes[i].time < nodes[i - 1].time) {
      this.world.nodes = [...nodes].sort((a, b) => a.time - b.time);
      return;
    }
  }

  private placeNode(time: number) {
    const w = this.world;
    if (!w.active || w.active.mode === 'prelaunch') return;
    const n = w.addNode(time);
    this.sortNodes();
    this.c.map.selectedNodeId = n.id;
    this.menus = { ...this.menus, node: null, context: null };
    if (!this.hinted) {
      this.hinted = true;
      w.message('Node added: drag the coloured handles to add Δv, drag the node to move it, click it for options', 'info', 5);
    }
    this.emit();
  }

  /**
   * Keyboard Δv step on the selected node (the open editor's node, else the gizmo's); with neither, the next burn is
   * selected and edited.
   */
  nudgeNode(axis: 'prograde' | 'normal' | 'radial', sign: 1 | -1, step: number) {
    const w = this.world, map = this.c.map;
    const id = this.menus.node ?? map.selectedNodeId;
    const node = w.nodes.find(n => n.id === id) ?? [...w.nodes].sort((a, b) => a.time - b.time)[0];
    if (!node) return;
    node[axis] = nudged(node[axis], sign, step);
    w.nodes = [...w.nodes];
    if (map.selectedNodeId !== node.id) { map.selectedNodeId = node.id; this.emit(); }
  }

  /** Show the gizmo on a node. */
  selectNode(id: number) { this.c.map.selectedNodeId = id; this.emit(); }

  /** Select a node and open its menu. */
  openNode(id: number) {
    this.c.map.selectedNodeId = id;
    this.menus = { node: id, context: null, info: null };
    this.emit();
  }

  deleteNode(id: number) {
    this.world.removeNode(id);
    if (this.c.map.selectedNodeId === id) this.c.map.selectedNodeId = null;
    if (this.menus.node === id) this.menus = { ...this.menus, node: null };
    this.emit();
  }

  /** Move a node by whole revolutions of the orbit it sits on. */
  shiftOrbit(id: number, dir: 1 | -1) {
    const w = this.world, node = w.nodes.find(n => n.id === id);
    if (!node) return;
    const T = nodeSummary(w, node).orbitPeriod;
    if (!Number.isFinite(T)) return void w.message('Not on a closed orbit', 'warn', 2);
    const time = node.time + dir * T;
    if (time < w.ut + 5) return void w.message('Node would be in the past', 'warn', 2);
    node.time = time;
    w.nodes = [...w.nodes];
    this.sortNodes();
  }

  warpToNode(id: number) {
    const w = this.world, node = w.nodes.find(n => n.id === id);
    if (!node) return;
    const burn = nodeSummary(w, node).burn;
    this.warp('Maneuver', node.time - 30 - (Number.isFinite(burn) ? burn / 2 : 0));
  }

  /** True when a node is still on the predicted path (otherwise it cannot show a gizmo). */
  nodeVisible(id: number) {
    const node = this.world.nodes.find(n => n.id === id);
    return !!node && !!patchAtNode(this.world.trajectory(), node);
  }
}

/** Closest camera distance from a body's centre: a regional view 0.1 R above solid ground, 0.15 R above cloud tops. */
function centredMinDistance(b: { radius: number; solidSurface?: boolean }): number {
  return b.radius * (b.solidSurface ? 1.1 : 1.15);
}
