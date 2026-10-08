import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/editor/session';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { resetSubassemblyCache } from '../src/editor/subassemblies';
import { game } from '../src/game/store';
import { qIdentity } from '../src/util/quat';
import { v3 } from '../src/util/vec3';

afterEach(() => { vi.useRealTimers(); resetSubassemblyCache(); });

function boosterSession() {
  vi.useFakeTimers();
  const session = new EditorSession();
  const e = session.editor;
  const pod = e.addRoot('pod-lantern-1');
  const tank = e.attachPart('tank-1-long', pod.uid, 'bottom', 'top');
  e.attachPart('eng-sirocco', tank.uid, 'bottom', 'top');
  e.setSymmetry({ mode: 'radial', count: 4 });
  const latch = e.surfaceAttach('dec-radial', tank.uid, v3(0.625, 0, 0), v3(1, 0, 0));
  e.surfaceAttach('srb-roman-candle', latch.uid, v3(0, 0, 0.12), v3(0, 0, 1));
  e.setSymmetry({ mode: 'radial', count: 1 });
  return { session, tank: session.getSnapshot().craft.parts.find(p => p.uid === tank.uid)!, latch };
}
const surface = (parentUid: number, y: number) => ({ kind: 'surface' as const, parentUid, position: v3(0.7, y, 0), rotation: qIdentity(), point: v3(0.625, y, 0), normal: v3(1, 0, 0) });

describe('editor session (WP2)', () => {
  it('picks up a booster set with its symmetry, places it as a set and restores the player setting', () => {
    const { session, tank, latch } = boosterSession();
    session.cycleSymmetry(); // player setting x2
    expect(session.getSnapshot().symmetry).toBe(2);
    session.pickUp(latch.uid);
    expect(session.getSnapshot().symmetry).toBe(4);
    expect(session.getSnapshot().craft.parts.some(p => p.partId === 'srb-roman-candle')).toBe(false);
    expect(session.place(surface(tank.uid, tank.position.y - 1))).toBe(true);
    expect(session.getSnapshot().craft.parts.filter(p => p.partId === 'srb-roman-candle')).toHaveLength(4);
    expect(session.getSnapshot().symmetry).toBe(2);
    // One undo returns to before the pick-up (never back to holding).
    const placed = session.getSnapshot().craft;
    session.undo();
    expect(session.getSnapshot().held).toBeNull();
    expect(session.getSnapshot().craft.parts.find(p => p.uid === latch.uid)!.position.y).toBeCloseTo(latch.position.y, 9);
    session.redo();
    expect(session.getSnapshot().held).toBeNull();
    expect(session.getSnapshot().craft).toEqual(placed);
  });

  it('Alt-copies a set, and undo removes the placed copy', () => {
    const { session, tank, latch } = boosterSession();
    const before = session.getSnapshot().craft;
    session.copyPart(latch.uid);
    expect(session.getSnapshot().held?.kind).toBe('assembly');
    expect(session.getSnapshot().symmetry).toBe(4);
    session.place(surface(tank.uid, tank.position.y + 1));
    expect(session.getSnapshot().craft.parts.length).toBe(before.parts.length + 8);
    session.undo();
    expect(session.getSnapshot().held).toBeNull();
    expect(session.getSnapshot().craft).toEqual(before);
  });

  it('deletes the hovered part with an Undo toast', () => {
    const { session, latch } = boosterSession();
    const before = session.getSnapshot().craft;
    session.deletePart(latch.uid, true);
    const toast = session.getSnapshot().toasts.at(-1)!;
    expect(toast.text).toMatch(/Deleted Side Latch and 7 attached parts|Deleted Side Latch/);
    expect(toast.action?.label).toBe('Undo');
    toast.action!.run();
    expect(session.getSnapshot().craft).toEqual(before);
  });

  it('saves subassemblies and drops them back with their symmetry', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    try {
      const { session, tank, latch } = boosterSession();
      const sub = session.subassemblyFrom(latch.uid)!;
      expect(sub.symmetry).toEqual({ mode: 'radial', count: 4 });
      session.deletePart(latch.uid);
      session.pickSubassembly(sub);
      expect(session.getSnapshot().symmetry).toBe(4);
      session.place(surface(tank.uid, tank.position.y));
      expect(session.getSnapshot().craft.parts.filter(p => p.partId === 'dec-radial')).toHaveLength(4);
    } finally { vi.unstubAllGlobals(); }
  });

  it('offers reference bodies and keeps launch checks on Earth', () => {
    vi.useFakeTimers();
    const session = new EditorSession(STOCK_CRAFTS.find(s => s.id === 'stock-selene')!.build());
    const bodies = session.getSnapshot().dvBodies.map(b => b.id);
    expect(bodies).toContain('moon');
    expect(bodies).toContain('mars');
    expect(bodies).not.toContain('sun');
    expect(bodies).not.toContain('jupiter');
    const earthFirst = session.getSnapshot().stageStats.get(0)!.twrAsl;
    session.setDvBody('moon');
    expect(session.getSnapshot().dvBody).toBe('moon');
    expect(session.getSnapshot().stageStats.get(0)!.twrAsl).toBeGreaterThan(earthFirst * 4);
    expect(session.launchStageStats().get(0)!.twrAsl).toBeCloseTo(earthFirst, 9);
    void game;
  });

  it('switches tools and commits a gizmo transform as one undo step', () => {
    const { session, latch } = boosterSession();
    session.setTool('offset');
    session.setGizmo(latch.uid);
    expect(session.getSnapshot().gizmoUid).toBe(latch.uid);
    const y0 = latch.position.y;
    session.transformPart(latch.uid, { offset: v3(0, 0.2, 0) }, true, 'g1');
    session.transformPart(latch.uid, { offset: v3(0, 0.2, 0) }, true, 'g1');
    expect(session.getSnapshot().craft.parts.find(p => p.uid === latch.uid)!.position.y).toBeCloseTo(y0 + 0.4, 9);
    session.undo();
    expect(session.getSnapshot().craft.parts.find(p => p.uid === latch.uid)!.position.y).toBeCloseTo(y0, 9);
    session.setTool('reroot');
    expect(session.getSnapshot().gizmoUid).toBeNull();
  });
});
