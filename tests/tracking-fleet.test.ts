import { describe, expect, it } from 'vitest';
import {
  classifyParts, cleanVesselName, earliestEvent, filterFleet, groupFleet, kindCounts, listKey, sortFleet,
  type FleetEntry, type PartLike,
} from '../src/ui/tracking/fleet';
import { loadTrackingPrefs, saveTrackingPrefs, DEFAULT_PREFS } from '../src/ui/tracking/prefs';
import { PART_CATALOG } from '../src/data/parts';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { buildOrbiter } from '../src/editor/stockCrafts';

const part = (...modules: PartLike['def']['modules']): PartLike => ({ def: { modules } });
const core = part({ type: 'command', crew: 0 });
const pod = part({ type: 'command', crew: 2 });

describe('classifyParts', () => {
  it('reads kinds from modules', () => {
    expect(classifyParts([core])).toBe('probe');
    expect(classifyParts([pod])).toBe('ship');
    expect(classifyParts([part({ type: 'engine' })])).toBe('debris');
    expect(classifyParts([part({ type: 'command', crew: 2, controllable: false })])).toBe('debris');
    expect(classifyParts([pod, part({ type: 'dockingPort' }), part({ type: 'dockingPort' })])).toBe('station');
    expect(classifyParts([pod, part({ type: 'dockingPort' }), part({ type: 'dockingPort' })], { landed: true })).toBe('base');
    expect(classifyParts([pod, part({ type: 'dockingPort' })])).toBe('ship');
    expect(classifyParts([core, part({ type: 'landingLeg' })])).toBe('lander');
    expect(classifyParts([core, part({ type: 'wheel' }), part({ type: 'wheel' })])).toBe('rover');
    expect(classifyParts([pod, part({ type: 'wheel' }), part({ type: 'liftingSurface' }), part({ type: 'liftingSurface' })])).toBe('plane');
    expect(classifyParts([pod, part({ type: 'intake' })])).toBe('plane');
    expect(classifyParts([pod], { eva: true })).toBe('astronaut');
  });
  it('classifies a real stock vessel', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    const v = w.launch(buildOrbiter());
    expect(['probe', 'ship']).toContain(classifyParts(v.state.parts));
  });
});

const e = (id: string, o: Partial<FleetEntry> = {}): FleetEntry => ({ id, kind: 'probe', name: id, body: 'earth', bodyName: 'Earth', status: 'Orbiting', order: 0, ...o });
const fleet = [
  e('Relay 10', { order: 0, kind: 'probe', next: { label: 'SOI', time: 500 } }),
  e('Relay 2', { order: 1, kind: 'probe' }),
  e('Hub', { order: 2, kind: 'station', body: 'moon', bodyName: 'Moon', next: { label: 'Maneuver', time: 200 } }),
  e('Stage', { order: 3, kind: 'debris' }),
];

describe('fleet list', () => {
  it('filters by words over name, body and kind, and drops hidden kinds', () => {
    const none = new Set<never>();
    expect(filterFleet(fleet, { query: 'relay', hidden: none }).map(x => x.id)).toEqual(['Relay 10', 'Relay 2']);
    expect(filterFleet(fleet, { query: 'moon', hidden: none }).map(x => x.id)).toEqual(['Hub']);
    expect(filterFleet(fleet, { query: 'stations', hidden: none }).map(x => x.id)).toEqual(['Hub']);
    expect(filterFleet(fleet, { query: 'relay 2', hidden: none }).map(x => x.id)).toEqual(['Relay 2']);
    expect(filterFleet(fleet, { query: '', hidden: new Set(['debris'] as const) }).map(x => x.id)).not.toContain('Stage');
  });
  it('sorts by next event, natural name and launch order', () => {
    expect(sortFleet(fleet, 'next').map(x => x.id)).toEqual(['Hub', 'Relay 10', 'Relay 2', 'Stage']);
    expect(sortFleet(fleet, 'name').map(x => x.id)).toEqual(['Hub', 'Relay 2', 'Relay 10', 'Stage']);
    expect(sortFleet([...fleet].reverse(), 'launch').map(x => x.order)).toEqual([0, 1, 2, 3]);
  });
  it('groups by body in tree order and by kind in kind order', () => {
    const rank = (id: string) => ({ sun: 0, earth: 1, moon: 2 } as Record<string, number>)[id] ?? 9;
    expect(groupFleet(sortFleet(fleet, 'name'), 'body', rank).map(g => [g.label, g.entries.length])).toEqual([['Earth', 3], ['Moon', 1]]);
    expect(groupFleet(fleet, 'type').map(g => g.label)).toEqual(['Stations', 'Probes', 'Debris']);
    expect(groupFleet(fleet, 'none')[0].entries).toHaveLength(4);
    expect(groupFleet([], 'none')).toEqual([]);
    expect(kindCounts(fleet).get('probe')).toBe(2);
  });
  it('picks the earliest future event', () => {
    expect(earliestEvent(100, [null, { label: 'a', time: 50 }, { label: 'b', time: 300 }, { label: 'c', time: 200 }])?.label).toBe('c');
    expect(earliestEvent(100, [{ label: 'a', time: 50 }])).toBeUndefined();
  });
  it('maps list keys', () => {
    expect(listKey('ArrowDown', -1, 3)).toEqual({ index: 0 });
    expect(listKey('ArrowDown', 2, 3)).toEqual({ index: 2 });
    expect(listKey('ArrowUp', -1, 3)).toEqual({ index: 2 });
    expect(listKey('ArrowUp', 0, 3)).toEqual({ index: 0 });
    expect(listKey('End', 0, 3)).toEqual({ index: 2 });
    expect(listKey('PageDown', 0, 30)).toEqual({ index: 10 });
    expect(listKey('Enter', 1, 3)).toEqual({ action: 'fly' });
    expect(listKey('f', 1, 3)).toEqual({ action: 'focus' });
    expect(listKey('F2', 1, 3)).toEqual({ action: 'rename' });
    expect(listKey('Delete', 1, 3)).toEqual({ action: 'terminate' });
    expect(listKey('Enter', -1, 3)).toBeNull();
    expect(listKey('ArrowDown', 0, 0)).toBeNull();
    expect(listKey('x', 0, 3)).toBeNull();
  });
  it('cleans vessel names', () => {
    expect(cleanVesselName('  Hub   One ')).toBe('Hub One');
    expect(cleanVesselName('x'.repeat(100))).toHaveLength(60);
  });
});

describe('tracking prefs', () => {
  it('round-trips and rejects junk', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadTrackingPrefs(s)).toEqual(DEFAULT_PREFS);
    saveTrackingPrefs({ group: 'type', sort: 'name', hidden: [] }, s);
    expect(loadTrackingPrefs(s)).toEqual({ group: 'type', sort: 'name', hidden: [] });
    store.set('wsp.tracking.v1', JSON.stringify({ group: 'x', sort: 1, hidden: ['debris', 'bogus'] }));
    expect(loadTrackingPrefs(s)).toEqual({ group: 'body', sort: 'next', hidden: ['debris'] });
    store.set('wsp.tracking.v1', '{');
    expect(loadTrackingPrefs(s)).toEqual(DEFAULT_PREFS);
  });
});
