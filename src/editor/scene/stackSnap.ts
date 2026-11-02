import { add, type Vec3 } from '../../util/vec3';
import type { WorldAttachNode } from '../core';

/** Stack snap radius between a held node and a craft node, screen px. */
export const SNAP_PX = 64;
/**
 * The cursor on a free craft node also snaps, whatever the held part's size: a tall tank is centred on the cursor,
 * so its own node can be far from where the player points. Tighter than SNAP_PX so side mounts keep working.
 */
export const CURSOR_SNAP_PX = 40;

export interface ScreenPoint { x: number; y: number }
/** Craft-frame point to screen px; false when behind the camera. */
export type ProjectFn = (p: Vec3, out: ScreenPoint) => boolean;
export interface StackSnap { child: WorldAttachNode; childAt: WorldAttachNode; parent: WorldAttachNode; through?: WorldAttachNode; occupant?: number }

const facing = (a: WorldAttachNode, b: WorldAttachNode) => a.direction.x * b.direction.x + a.direction.y * b.direction.y + a.direction.z * b.direction.z;
const dist = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Best node to snap to: a free craft node, or an occupied joint to insert into (`through`/`occupant` set).
 * `C` is the cursor in the craft frame (held nodes are relative to it). A free node counts as near when either the
 * held node or the cursor is near it; among held nodes facing the same craft node, the nearer one wins.
 */
export function findStackSnap(
  C: Vec3, heldNodes: readonly WorldAttachNode[], craftNodes: readonly WorldAttachNode[],
  jointNodes: readonly (WorldAttachNode & { occupant: number })[], heldThrough: ReadonlyMap<WorldAttachNode, WorldAttachNode>,
  project: ProjectFn,
): StackSnap | null {
  if (!heldNodes.length) return null;
  let best: StackSnap | null = null, bestRank = Infinity;
  const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 }, pc = { x: 0, y: 0 };
  const cursorOn = project(C, pc);
  for (const h of heldNodes) {
    const childAt: WorldAttachNode = { ...h, position: add(h.position, C) };
    if (!project(childAt.position, pa)) continue;
    for (const c of craftNodes) {
      // Keep the player's orientation: only nodes that face each other (within ~60 degrees).
      if (facing(h, c) > -0.5) continue;
      if (!project(c.position, pb)) continue;
      const dh = dist(pa, pb), dc = cursorOn ? dist(pc, pb) : Infinity;
      const d = dh <= SNAP_PX ? Math.min(dh, dc) : dc <= CURSOR_SNAP_PX ? dc : Infinity;
      if (d === Infinity) continue;
      // The held-node distance breaks ties between held nodes that the cursor rule rates the same.
      const rank = d + (h.size === c.size ? 0 : SNAP_PX * 0.6) + dh * 1e-3;
      if (rank < bestRank) { best = { child: h, childAt, parent: c }; bestRank = rank; }
    }
    // Occupied joints: insert between (a free node at the same distance wins).
    const through = heldThrough.get(h);
    if (!through) continue;
    for (const j of jointNodes) {
      if (facing(h, j) > -0.5) continue;
      if (!project(j.position, pb)) continue;
      const d = dist(pa, pb);
      if (d > SNAP_PX * 0.75) continue;
      const rank = d + SNAP_PX * 0.2 + (h.size === j.size ? 0 : SNAP_PX * 0.6);
      if (rank < bestRank) { best = { child: h, childAt, parent: j, through, occupant: j.occupant }; bestRank = rank; }
    }
  }
  return best;
}
