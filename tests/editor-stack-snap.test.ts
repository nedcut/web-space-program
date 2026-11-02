import { describe, expect, it } from 'vitest';
import { CURSOR_SNAP_PX, findStackSnap, SNAP_PX, type ProjectFn } from '../src/editor/scene/stackSnap';
import type { WorldAttachNode } from '../src/editor/core';
import { v3, type Vec3 } from '../src/util/vec3';

/** Side view: 1 m = 133 px, so a 1.5 m tank's end node sits 100 px from its centre. */
const PX_PER_M = 133;
const project: ProjectFn = (p, out) => { out.x = p.x * PX_PER_M; out.y = -p.y * PX_PER_M; return true; };
const node = (uid: number, id: string, position: Vec3, direction: Vec3, size = 1): WorldAttachNode => ({ uid, id, position, direction, size });
const UP = v3(0, 1, 0), DOWN = v3(0, -1, 0);

// Pod (uid 1) with a free bottom node at the origin.
const podBottom = node(1, 'bottom', v3(0, 0, 0), DOWN);
// Held 1.5 m tank, centred on the cursor (held-space positions).
const tankTop = node(-1, 'top', v3(0, 0.75, 0), UP);
const tankBottom = node(-1, 'bottom', v3(0, -0.75, 0), DOWN);
const tank = [tankTop, tankBottom];
const noJoints: (WorldAttachNode & { occupant: number })[] = [];
const none = new Map<WorldAttachNode, WorldAttachNode>();

describe('editor stack snap choice', () => {
  it('stacks a tall part when the cursor is on a free craft node (F1)', () => {
    // The held top node is 100 px from the pod node, beyond SNAP_PX: only the cursor rule can snap.
    expect(0.75 * PX_PER_M).toBeGreaterThan(SNAP_PX);
    const snap = findStackSnap(v3(0.05, -0.05, 0), tank, [podBottom], noJoints, none, project);
    expect(snap?.parent).toBe(podBottom);
    expect(snap?.child).toBe(tankTop);
    expect(snap?.childAt.position.y).toBeCloseTo(0.7);
  });

  it('leaves the cursor away from free nodes to surface attachment', () => {
    // Beside the pod, level with its bottom node but clear of the cursor radius.
    const x = (CURSOR_SNAP_PX + 8) / PX_PER_M;
    expect(findStackSnap(v3(x, 0, 0), tank, [podBottom], noJoints, none, project)).toBeNull();
  });

  it('still snaps a short part by its own node', () => {
    // A 0.4 m part held below the pod: cursor 70 px away, its top node 43 px away.
    const shortTop = node(-1, 'top', v3(0, 0.2, 0), UP);
    const snap = findStackSnap(v3(0, -70 / PX_PER_M, 0), [shortTop], [podBottom], noJoints, none, project);
    expect(snap?.parent).toBe(podBottom);
  });

  it('keeps orientation: the cursor rule needs a facing held node', () => {
    const podTop = node(1, 'top', v3(0, 0, 0), UP);
    const upOnly = [node(-1, 'top', v3(0, 0.75, 0), UP)];
    expect(findStackSnap(v3(0, 0, 0), upOnly, [podTop], noJoints, none, project)).toBeNull();
  });

  it('prefers the free node under the cursor over a farther one near a held node', () => {
    // Engine bottom node elsewhere, 30 px from the held tank's top node; the pod node is under the cursor.
    const other = node(2, 'bottom', v3(2, 0.75 - 30 / PX_PER_M, 0), DOWN);
    const snap = findStackSnap(v3(0, 0, 0), [{ ...tankTop, position: v3(2, 0.75, 0) }, tankBottom], [other, podBottom], noJoints, none, project);
    expect(snap?.parent).toBe(podBottom);
  });

  it('still inserts into an occupied joint near a held node', () => {
    const joint = { ...node(1, 'bottom', v3(0, 0, 0), DOWN), occupant: 3 };
    const through = new Map([[tankTop, tankBottom]]);
    const snap = findStackSnap(v3(0, -0.75 + 10 / PX_PER_M, 0), tank, [], [joint], through, project);
    expect(snap?.occupant).toBe(3);
    expect(snap?.through).toBe(tankBottom);
  });
});
