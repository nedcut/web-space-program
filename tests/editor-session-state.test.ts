import { afterEach, describe, expect, it, vi } from 'vitest';

// Saving is held open by the test so a load can happen while it is in flight.
const pendingSaves: Array<() => void> = [];
vi.mock('../src/game/saves', () => ({
  saveCraft: () => new Promise<void>(resolve => { pendingSaves.push(resolve); }),
  listCrafts: async () => [],
  deleteCraft: async () => undefined,
}));

const { EditorSession } = await import('../src/editor/session');
const { STOCK_CRAFTS } = await import('../src/editor/stockCrafts');

const stock = (id: string) => STOCK_CRAFTS.find(s => s.id === id)!.build();
afterEach(() => { vi.useRealTimers(); pendingSaves.length = 0; });

describe('editor session state stays consistent', () => {
  it('loading another craft drops the selection and inspector panels of the old one', () => {
    vi.useFakeTimers();
    const session = new EditorSession(stock('stock-selene'));
    const uid = session.getSnapshot().craft.parts[1].uid;
    session.openPanel(uid);
    session.setTool('offset');
    expect(session.getSnapshot().gizmoUid).toBe(uid);
    session.load(stock('stock-meridian'), false);
    // Part uids are small per-craft integers: the new craft has a part with the same uid.
    expect(session.getSnapshot().craft.parts.some(p => p.uid === uid)).toBe(true);
    expect(session.getSnapshot().selectedUids).toEqual([]);
    expect(session.getSnapshot().panels).toEqual([]);
    expect(session.getSnapshot().gizmoUid).toBeNull();
    session.dispose();
  });

  it('picking a part from the palette while another tool is active switches to the place tool', () => {
    vi.useFakeTimers();
    const session = new EditorSession(stock('stock-kestrel'));
    session.openPanel(session.getSnapshot().craft.parts[0].uid);
    session.setTool('offset');
    session.pickNew('tank-1-long');
    expect(session.getSnapshot().held?.kind).toBe('new');
    expect(session.getSnapshot().tool).toBe('place');
    expect(session.getSnapshot().gizmoUid).toBeNull();
    session.cancelHeld();
    session.setTool('reroot');
    session.pickNew('tank-1-long');
    expect(session.getSnapshot().tool).toBe('place');
    session.dispose();
  });

  it('holding a subassembly or merged craft puts the editor in build mode with the place tool', () => {
    vi.useFakeTimers();
    const session = new EditorSession(stock('stock-kestrel'));
    const sub = session.subassemblyFrom(session.getSnapshot().craft.parts.at(-1)!.uid)!;
    session.setMode('actions');
    session.setTool('rotate');
    session.pickSubassembly(sub);
    expect(session.getSnapshot().held?.kind).toBe('assembly');
    expect(session.getSnapshot().mode).toBe('build');
    expect(session.getSnapshot().tool).toBe('place');
    session.cancelHeld();
    session.setTool('reroot');
    session.setMode('actions');
    session.mergeCraft(stock('stock-tender'));
    expect(session.getSnapshot().held?.kind).toBe('assembly');
    expect(session.getSnapshot().mode).toBe('build');
    expect(session.getSnapshot().tool).toBe('place');
    session.dispose();
  });

  it('undoing a pick-up and placement keeps the tool the player switched to', () => {
    vi.useFakeTimers();
    const session = new EditorSession(stock('stock-kestrel'));
    const symmetry = session.getSnapshot().symmetry;
    const uid = session.getSnapshot().craft.parts.at(-1)!.uid;
    session.pickUp(uid);
    expect(session.place({ kind: 'park', position: { x: 4, y: 0, z: 0 } })).toBe(true);
    session.setTool('offset');
    session.setGizmo(session.getSnapshot().craft.parts[0].uid);
    session.undo();
    expect(session.getSnapshot().held).toBeNull();
    expect(session.getSnapshot().detached).toEqual([]);
    expect(session.getSnapshot().tool).toBe('offset');
    expect(session.getSnapshot().gizmoUid).toBe(session.getSnapshot().craft.parts[0].uid);
    expect(session.getSnapshot().symmetry).toBe(symmetry);
    session.redo();
    expect(session.getSnapshot().detached).toHaveLength(1);
    expect(session.getSnapshot().tool).toBe('offset');
    session.dispose();
  });

  it('a save that finishes after another craft was loaded does not mark the new craft unsaved', async () => {
    vi.useFakeTimers();
    const session = new EditorSession(stock('stock-kestrel'));
    session.setName('Changed');
    expect(session.getSnapshot().dirty).toBe(true);
    const saving = session.save();
    session.load(stock('stock-meridian'), false);
    expect(session.getSnapshot().dirty).toBe(false);
    pendingSaves.shift()!();
    await saving;
    expect(session.getSnapshot().dirty).toBe(false);
    // A save with no load in between still records the saved baseline.
    session.setName('Renamed');
    const again = session.save();
    pendingSaves.shift()!();
    await again;
    expect(session.getSnapshot().dirty).toBe(false);
    session.dispose();
  });

  it('dispose cancels pending toast timers', () => {
    vi.useFakeTimers();
    const session = new EditorSession(stock('stock-kestrel'));
    session.toast('one');
    session.toast('two', 'warn', { label: 'Undo', run: () => {} });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
