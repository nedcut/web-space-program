/**
 * Map-object focus cycling and context-menu actions shared by the flight map and Fleet Tracking.
 * Pure data in, data out: callers resolve the world state and execute the chosen action.
 */
export interface MapObject { kind: 'body' | 'vessel'; id: string }

export const sameObject = (a: MapObject | null | undefined, b: MapObject | null | undefined) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;

export interface FocusCycleInput {
  activeVessel?: string | null;
  /** Body whose SOI the active vessel is in. */
  activeBody?: string;
  /** Bodies the predicted trajectory passes through, in order. */
  trajectoryBodies?: readonly string[];
  target?: MapObject | null;
  /** Natural satellites of the active body (nearest first). */
  children?: readonly string[];
}

/** Tab order: active vessel, its body, bodies along the trajectory, the target, then the body's moons. */
export function focusCycle(o: FocusCycleInput): MapObject[] {
  const out: MapObject[] = [];
  const push = (item: MapObject | null | undefined) => { if (item && !out.some(x => sameObject(x, item))) out.push(item); };
  if (o.activeVessel) push({ kind: 'vessel', id: o.activeVessel });
  if (o.activeBody) push({ kind: 'body', id: o.activeBody });
  for (const id of o.trajectoryBodies ?? []) push({ kind: 'body', id });
  push(o.target);
  for (const id of o.children ?? []) push({ kind: 'body', id });
  return out;
}

/** Next (dir 1) or previous (dir -1) focus; an unknown current focus starts from the list's first entry. */
export function nextFocus(list: readonly MapObject[], current: MapObject | null, dir: 1 | -1): MapObject | null {
  if (!list.length) return null;
  const i = list.findIndex(x => sameObject(x, current));
  if (i < 0) return list[dir > 0 ? Math.min(1, list.length - 1) : list.length - 1];
  return list[(i + dir + list.length) % list.length];
}

export type MapActionId = 'focus' | 'target' | 'untarget' | 'warpApproach' | 'warpSoi' | 'switch' | 'info' | 'addNode' | 'warpPoint' | 'pin' | 'unpin';
export interface MapAction { id: MapActionId; label: string }

export interface MapActionContext {
  activeId?: string | null;
  /** Body whose SOI the active vessel is in (not targetable). */
  activeBody?: string | null;
  targetId?: string | null;
  canTarget?: boolean;
  canSwitch?: boolean;
  canWarp?: boolean;
  /** Closest approach to the current target, if one is predicted. */
  approach?: { id: string; time: number } | null;
  /** Upcoming SOI transitions of the predicted trajectory (body entered or left). */
  soiChanges?: readonly { body: string; time: number }[];
  now?: number;
  name?: (o: MapObject) => string;
}

export function mapContextActions(obj: MapObject, c: MapActionContext): MapAction[] {
  const out: MapAction[] = [{ id: 'focus', label: 'Focus view' }];
  const isActive = obj.kind === 'vessel' && obj.id === c.activeId;
  const name = c.name?.(obj) ?? obj.id;
  if (c.canTarget && !isActive && !(obj.kind === 'body' && obj.id === c.activeBody)) {
    out.push(c.targetId === obj.id ? { id: 'untarget', label: 'Unset target' } : { id: 'target', label: 'Set as target' });
  }
  if (c.canWarp && c.activeId) {
    const now = c.now ?? -Infinity;
    if (c.approach && c.approach.id === obj.id && c.approach.time > now + 5) out.push({ id: 'warpApproach', label: 'Warp to closest approach' });
    if (obj.kind === 'body' && c.soiChanges?.some(s => s.body === obj.id && s.time > now + 5)) out.push({ id: 'warpSoi', label: `Warp to ${name} SOI change` });
  }
  if (c.canSwitch && obj.kind === 'vessel' && !isActive) out.push({ id: 'switch', label: 'Switch to vessel' });
  out.push({ id: 'info', label: 'Info' });
  return out;
}

/** A point on the predicted path: a marker (Ap, Pe, encounter…) or a spot on the orbit line. */
export interface MapPathPoint { label: string; time?: number; key?: string; pinned?: boolean; orbit?: boolean }

/** Actions for a right-clicked path point: add a node (orbit line), warp there, pin/unpin (markers). */
export function pathPointActions(p: MapPathPoint, c: { now: number; canWarp: boolean; canPlan: boolean }): MapAction[] {
  const out: MapAction[] = [];
  const future = p.time !== undefined && Number.isFinite(p.time) && p.time > c.now + 5;
  if (p.orbit && c.canPlan && future) out.push({ id: 'addNode', label: 'Add maneuver node here' });
  if (c.canWarp && future) out.push({ id: 'warpPoint', label: p.orbit ? 'Warp here' : `Warp to ${p.label}` });
  if (p.key) out.push(p.pinned ? { id: 'unpin', label: 'Unpin label' } : { id: 'pin', label: 'Pin label' });
  return out;
}
