import { describe, expect, it } from 'vitest';
import { groupByProgram, previewCraft, programTitle, saveWhere, savedAgo } from '../src/ui/saveSummary';
import { bindingChanged, bindingClashes, matchesQuery, resetPatch } from '../src/ui/settingsModel';
import { defaultBindings } from '../src/input/bindings';
import { defaultSettings } from '../src/game/store';
import type { SaveSlot } from '../src/game/saveSlots';

const vessel = (id: string, name: string, body = 'moon', destroyed = false) => ({
  state: { id, name, destroyed, parts: [{ uid: 1, partId: 'pod', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, parent: null }] },
  mode: 'orbit', body,
});
const slot = (over: Partial<SaveSlot> & { programId: string; savedAt: number }): SaveSlot => ({
  id: `${over.programId}:${over.savedAt}`, name: 'Autosave', kind: 'auto',
  data: { version: 1, preset: 'standard', ut: 0, activeId: 'v1', nodes: [], vessels: [vessel('v1', 'Meridian I')], mode: 'career' },
  ...over,
} as SaveSlot);

describe('save summaries', () => {
  const now = new Date(2026, 9, 12, 15, 0).getTime();
  it('names programs from mode and start time instead of raw ids', () => {
    expect(programTitle(`career-${new Date(2026, 9, 3).getTime()}`, 'career', now)).toBe('Career program · started 3 Oct');
    expect(programTitle(`sandbox-${new Date(2025, 0, 9).getTime()}`, 'sandbox', now)).toBe('Sandbox program · started 9 Jan 2025');
    expect(programTitle('imported-x', 'science', now)).toBe('Science program');
    expect(programTitle('legacy-program', undefined, now)).toBe('Earlier program');
  });
  it('reports save age in words', () => {
    expect(savedAgo(now - 20_000, now)).toBe('just now');
    expect(savedAgo(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(savedAgo(new Date(2026, 9, 12, 9, 5).getTime(), now)).toBe('today 09:05');
    expect(savedAgo(new Date(2026, 9, 11, 22, 30).getTime(), now)).toBe('yesterday 22:30');
    expect(savedAgo(new Date(2026, 8, 30, 8, 0).getTime(), now)).toBe('30 Sep 08:00');
  });
  it('says where a save resumes, with vessel and body for flights', () => {
    expect(saveWhere(slot({ programId: 'p', savedAt: 1, scene: 'flight' }))).toBe('In flight · Meridian I · Moon');
    expect(saveWhere(slot({ programId: 'p', savedAt: 1, scene: 'spaceCenter' }))).toBe('Space Center');
    expect(saveWhere(slot({ programId: 'p', savedAt: 1 }))).toBe('Space Center');
  });
  it('groups saves per program, newest program and newest save first', () => {
    const groups = groupByProgram([
      slot({ programId: 'a', savedAt: 10 }), slot({ programId: 'b', savedAt: 30 }), slot({ programId: 'a', savedAt: 40, name: 'Before landing', kind: 'manual' }),
    ], now);
    expect(groups.map(g => g.programId)).toEqual(['a', 'b']);
    expect(groups[0].latest.name).toBe('Before landing');
    expect(groups[0].slots.map(s => s.savedAt)).toEqual([40, 10]);
  });
  it('pictures the active vessel in flight, else the editor draft', () => {
    expect(previewCraft(slot({ programId: 'p', savedAt: 1, scene: 'flight' }))?.parts[0]).toMatchObject({ uid: 1, partId: 'pod', parent: undefined });
    expect(previewCraft(slot({ programId: 'p', savedAt: 1, craft: null }))).toBeNull();
    const craft = { name: 'Draft', type: 'VAB' as const, version: 1 as const, parts: [{ uid: 1, partId: 'pod', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }] };
    expect(previewCraft(slot({ programId: 'p', savedAt: 1, craft }))).toBe(craft);
  });
});

describe('settings model', () => {
  it('matches every search word in label, hint or section', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('shad', 'Graphics', 'Shadows')).toBe(true);
    expect(matchesQuery('graphics shad', 'Graphics', 'Shadows')).toBe(true);
    expect(matchesQuery('volume shad', 'Graphics', 'Shadows')).toBe(false);
  });
  it('reports only clashes the player introduced, both ways', () => {
    expect(bindingClashes(defaultBindings()).size).toBe(0);
    const b = defaultBindings();
    b.toggleSas = ['Space'];
    const clashes = bindingClashes(b);
    expect(clashes.get('toggleSas')).toContain('stage');
    expect(clashes.get('stage')).toContain('toggleSas');
    expect(bindingChanged(b, 'toggleSas')).toBe(true);
    expect(bindingChanged(b, 'stage')).toBe(false);
  });
  it('per-tab reset restores only that tab', () => {
    const patch = resetPatch('Audio', defaultSettings());
    expect(Object.keys(patch).sort()).toEqual(['masterVolume', 'musicVolume', 'sfxVolume', 'uiVolume']);
    expect(patch.masterVolume).toBe(defaultSettings().masterVolume);
  });
});
