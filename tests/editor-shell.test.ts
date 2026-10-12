import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/editor/session';
import { filterLibrary, matchesQuery } from '../src/editor/ui/library';
import type { LibraryCraft } from '../src/game/saves';
import type { CraftDef } from '../src/sim/vessel/types';

afterEach(() => { vi.useRealTimers(); });

const craft = (name: string, parts = 1): CraftDef => ({ name, type: 'VAB', version: 1, parts: Array.from({ length: parts }, (_, uid) => ({ uid, partId: 'pod-lantern-1' })) as unknown as CraftDef['parts'] });
const item = (id: string, name: string, extra: Partial<LibraryCraft> = {}): LibraryCraft => ({ id, craft: craft(name, extra.craft?.parts.length ?? 1), folder: '', tags: [], updatedAt: 0, ...extra });

describe('craft library filtering (UX-6)', () => {
  const items = [
    item('a', 'Kite 2', { folder: 'Probes', tags: ['moon'], updatedAt: 3 }),
    item('b', 'kite 10', { updatedAt: 1, craft: craft('kite 10', 5) }),
    item('c', 'Heavy Lifter', { folder: 'Launchers', tags: ['cargo', 'moon'], updatedAt: 2 }),
  ];
  it('matches every word in any order across name, folder and tags', () => {
    expect(matchesQuery('Heavy Lifter Launchers cargo', 'cargo heavy')).toBe(true);
    expect(matchesQuery('Heavy Lifter', 'heavy probe')).toBe(false);
    expect(filterLibrary(items, { query: 'moon' }).map(i => i.id)).toEqual(['a', 'c']);
    expect(filterLibrary(items, { query: 'moon', folder: 'Probes' }).map(i => i.id)).toEqual(['a']);
  });
  it('sorts by recent (default), natural name order and part count', () => {
    expect(filterLibrary(items, {}).map(i => i.id)).toEqual(['a', 'c', 'b']);
    expect(filterLibrary(items, { sort: 'name' }).map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(filterLibrary(items, { sort: 'parts' }).map(i => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('editor unsaved-changes indicator (UX-6)', () => {
  it('is clean for an empty or freshly loaded craft and dirty after an edit or rename', () => {
    vi.useFakeTimers();
    const session = new EditorSession();
    expect(session.getSnapshot().dirty).toBe(false);
    session.editor.addRoot('pod-lantern-1');
    expect(session.getSnapshot().dirty).toBe(true);
    session.load(session.currentCraft(), false);
    expect(session.getSnapshot().dirty).toBe(false);
    session.setName('Renamed');
    expect(session.getSnapshot().dirty).toBe(true);
    session.setName(session.getSnapshot().craft.name);
    expect(session.getSnapshot().dirty).toBe(false);
    // UI-only updates keep the cached flag.
    session.toggleCoM();
    expect(session.getSnapshot().dirty).toBe(false);
  });
  it('markSaved clears the flag until the next change; undoing back to the baseline is clean again', () => {
    vi.useFakeTimers();
    const session = new EditorSession();
    const pod = session.editor.addRoot('pod-lantern-1');
    session.markSaved();
    expect(session.getSnapshot().dirty).toBe(false);
    session.editor.attachPart('tank-1-long', pod.uid, 'bottom', 'top');
    expect(session.getSnapshot().dirty).toBe(true);
    session.undo();
    expect(session.getSnapshot().dirty).toBe(false);
  });
});
