import { describe, expect, it } from 'vitest';
import { buildDebrief, debriefStatus, furthestReach } from '../src/ui/hub/debrief';
import { flightDebrief } from '../src/flight/exit';
import { facilityForBuilding, hubFacilities } from '../src/ui/hub/facilities';
import { launchBlocker, launchOptions } from '../src/ui/hub/quickLaunch';
import { STOCK_CRAFTS, buildSoundingRocket } from '../src/editor/stockCrafts';
import { Universe } from '../src/game/universe';
import { newProgression } from '../src/sim/science/progression';
import type { FlightRecord, Observation } from '../src/game/flightlog/recorder';

const record = (patch: Partial<FlightRecord> = {}): FlightRecord => ({
  id: 'r1', vesselId: 'v1', name: 'Meridian Orbiter', start: 100, samples: [], events: [], bodies: ['earth'], landedBodies: [], orbitBodies: [],
  stats: { maxAltitude: 85_200, maxSpeed: 0, maxG: 0, dvSpent: 0, distance: 0 }, launched: true, stages: 0, hotUnshielded: false, plane: false, ...patch,
});
const obs = (patch: Partial<Observation>) => ({ body: 'earth', prelaunch: false, stableOrbit: false, flying: true, splashed: false, ...patch }) as Observation;

describe('hub debrief', () => {
  it('names the furthest reach: other worlds beat home, landing beats orbit', () => {
    expect(furthestReach(record({ launched: false }))).toBeNull();
    expect(furthestReach(record())).toBe('Earth · suborbital');
    expect(furthestReach(record({ orbitBodies: ['earth'] }))).toBe('Earth · orbit');
    expect(furthestReach(record({ bodies: ['earth', 'moon', 'earth'], orbitBodies: ['earth', 'moon'] }))).toBe('Moon · orbit');
    expect(furthestReach(record({ bodies: ['earth', 'moon', 'mars'], landedBodies: ['moon'], orbitBodies: ['mars'] }))).toBe('Moon · landed');
    expect(furthestReach(record({ bodies: ['earth', 'moon'] }))).toBe('Moon · flyby');
  });

  it('describes where the vessel was left', () => {
    expect(debriefStatus(record({ outcome: 'recovered', last: obs({ flying: false }) })).status).toBe('Recovered on Earth');
    expect(debriefStatus(record({ outcome: 'lost' })).outcome).toBe('lost');
    expect(debriefStatus(record({ last: obs({ stableOrbit: true, body: 'moon' }) })).status).toBe('In orbit around Moon');
    expect(debriefStatus(record({ last: obs({ flying: false, splashed: true }) })).status).toBe('Splashed down on Earth');
    expect(debriefStatus(record({ last: obs({ prelaunch: true }) })).status).toBe('Still on the launch pad');
    expect(debriefStatus(record({ last: obs({}) }))).toEqual({ outcome: 'flying', status: 'In flight over Earth' });
  });

  it('reports program changes by mode and the recovery value in career', () => {
    const before = { science: 10, funds: 50_000, reputation: 2 };
    const after = { science: 14.5, funds: 58_000, reputation: 5 };
    const d = buildDebrief(record({ outcome: 'recovered', end: 400 }), { mode: 'career', ut: 999, before, after, recoveryValue: 6000, crew: ['Mei Chen'], craft: null });
    expect(d).toMatchObject({ science: 4.5, funds: 8000, reputation: 3, recoveryValue: 6000, duration: 300, kicker: 'Back from flight · recovered', crew: ['Mei Chen'] });
    const s = buildDebrief(record(), { mode: 'sandbox', ut: 160, before, after, recoveryValue: 6000, crew: [], craft: null });
    expect(s).toMatchObject({ science: null, funds: null, reputation: null, recoveryValue: null, duration: 60, kicker: 'Back from flight · in progress' });
    expect(buildDebrief(record(), { mode: 'science', ut: 0, before: null, after, crew: [], craft: null }).science).toBeNull();
  });

  it('builds from the world report and keeps a queued notice as a note', () => {
    const world = { latestReportId: 'r1', flightlog: { records: [record()] }, mode: 'sandbox' as const, ut: 200, progression: { science: 0, funds: 0, reputation: 0 } };
    expect(flightDebrief(world, { before: null, crew: [], recoveryValue: null, craft: null, note: 'Save failed' })).toMatchObject({ name: 'Meridian Orbiter', note: 'Save failed', maxAltitude: 85_200 });
    expect(flightDebrief({ ...world, latestReportId: null }, { before: null, crew: [], recoveryValue: null, craft: null, note: null })).toBeNull();
  });
});

describe('hub facilities', () => {
  it('maps every facility to its own building and closes the mode-specific ones', () => {
    const sandbox = hubFacilities('sandbox');
    expect(new Set(sandbox.map(f => f.building)).size).toBe(6);
    expect(sandbox.filter(f => !f.closed).map(f => f.id)).toEqual(['editor', 'launch', 'flightlog', 'tracking']);
    expect(hubFacilities('science').filter(f => !f.closed).map(f => f.id)).toContain('research');
    expect(hubFacilities('career').every(f => !f.closed)).toBe(true);
    expect(facilityForBuilding(sandbox, 'dish')?.id).toBe('tracking');
    expect(facilityForBuilding(sandbox, 'control')?.closed).toBe('Career programs');
    expect(hubFacilities('sandbox', true)[1].title).toBe('Runway');
  });
});

describe('Launch Pad picker', () => {
  const earth = new Universe('standard').body('earth');
  it('lists the editor craft first, then saved, then stock, with the launch rules applied', () => {
    const pad = buildSoundingRocket();
    const stock = STOCK_CRAFTS.filter(s => s.scale === 'standard').slice(0, 3).map(s => ({ id: s.id, craft: s.build() }));
    const rows = launchOptions({ pad, saved: [{ id: 'a', craft: { ...pad, name: 'Copy' } }], stock, mode: 'sandbox', progression: newProgression(), earth });
    expect(rows.map(r => r.source)).toEqual(['pad', 'saved', 'stock', 'stock', 'stock']);
    expect(rows[0].info).toMatch(/parts · .* m\/s$/);
    expect(rows.every(r => r.blocked === null)).toBe(true);
    expect(launchOptions({ pad: { ...pad, parts: [] }, saved: [], stock: [], mode: 'sandbox', progression: newProgression(), earth })).toEqual([]);
  });

  it('blocks uncontrollable vehicles and locked parts', () => {
    const pad = buildSoundingRocket();
    const probeless = { ...pad, parts: pad.parts.filter(p => !/pod|probe|core/i.test(p.partId)) };
    expect(launchBlocker(probeless, 'sandbox', newProgression())).toMatch(/command pod or probe core/);
    const locked = STOCK_CRAFTS.find(s => s.needsResearch)!.build();
    expect(launchBlocker(locked, 'career', newProgression())).toMatch(/^Research required/);
    expect(launchBlocker(locked, 'sandbox', newProgression())).toBeNull();
  });
});
