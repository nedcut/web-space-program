import { expect, it, vi } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT } from '../src/game/store';
import { buildMoonLander } from '../src/editor/stockCrafts';
import { length } from '../src/util/vec3';
import { toOrbit, toMoon, captureMoon, landMoon, moonAscent, moonHome, deorbitAndRecover } from '../scripts/career/flights';
import { dvLeft } from '../scripts/career/planets';

// Standard scale, default epoch + 11 days (ocean return), stock hardware, actual assist burns and rails coasts.
// Baselines and margins are documented in DECISIONS.md; no injected orbit/fuel or disabled damage.
it('golden Selene: pad → Moon capture/landing → ascent → Earth entry → crewed splashdown', () => {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 11 * 86400, 'sandbox');
  w.launch(buildMoonLander());
  const crew = w.crewFor().map(c => c.id);
  const biomes = new Set<string>();
  const checkpoint = (phase: string, body: string, parts: number, dv: [number, number], pe?: [number, number], ap?: [number, number]) => {
    const v = w.active!;
    const o = w.orbitSummary(v);
    const values = { phase, body: v.body, parts: v.state.parts.length, dv: dvLeft(w), pe: o.pe, ap: o.ap, time: w.ut - DEFAULT_START_UT - 11 * 86400 };
    const message = JSON.stringify(values);
    console.log('GOLDEN Selene', message);
    expect(v.body, message).toBe(body);
    expect(v.state.destroyed, message).toBe(false);
    expect(v.state.parts.length, message).toBe(parts);
    expect(w.crewFor().map(c => c.id), message).toEqual(crew);
    expect(values.dv, message).toBeGreaterThan(dv[0]);
    expect(values.dv, message).toBeLessThan(dv[1]);
    if (pe) { expect(o.pe, message).toBeGreaterThan(pe[0]); expect(o.pe, message).toBeLessThan(pe[1]); }
    if (ap) { expect(o.ap, message).toBeGreaterThan(ap[0]); expect(o.ap, message).toBeLessThan(ap[1]); }
  };
  expect(crew).toHaveLength(1);
  expect(toOrbit(w, biomes, 90000, 4)).toBeNull();
  checkpoint('parking', 'earth', 20, [3300, 4200], [80000, 100000], [80000, 105000]);
  expect(toMoon(w, biomes, 4)).toBeNull();
  checkpoint('arrival', 'moon', 20, [2400, 3100], [20000, 40000]);
  expect(captureMoon(w, biomes, 2)).toBeNull();
  checkpoint('capture', 'moon', 20, [2200, 2800], [20000, 40000], [20000, 40000]);
  w.stageActive(); w.stageActive();
  expect(landMoon(w, biomes, 2)).toBeNull();
  checkpoint('landing', 'moon', 16, [1100, 1600]);
  expect(w.active!.state.situation).toBe('landed');
  expect(length(w.surfaceVelocity(w.active!))).toBeLessThan(1);
  expect(moonAscent(w, biomes, 2)).toBeNull();
  checkpoint('ascent', 'moon', 16, [450, 850], [25000, 35000], [25000, 35000]);
  expect(moonHome(w, biomes, 0)).toBeNull();
  checkpoint('return', 'earth', 16, [250, 550], [15000, 25000]);
  // Observe the real recovery boundary; do not replace recovery or bypass entry physics.
  const recover = w.recoverActive.bind(w);
  const spy = vi.spyOn(w, 'recoverActive').mockImplementation(() => {
    checkpoint('splashdown', 'earth', 4, [-1, 1]);
    const events = w.flightlog.records.find(r => r.vesselId === w.active!.state.id)!.events;
    const splash = events.find(e => e.kind === 'splashdown' && e.body === 'earth');
    console.log('GOLDEN Selene touchdown', JSON.stringify(splash));
    expect(splash).toBeDefined();
    expect(splash!.speed).toBeGreaterThan(0);
    expect(splash!.speed).toBeLessThan(10);
    expect(w.active!.state.situation).toBe('splashed');
    expect(length(w.surfaceVelocity(w.active!))).toBeLessThan(0.5);
    return recover();
  });
  try {
    expect(deorbitAndRecover(w, biomes)).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    expect(w.ut - DEFAULT_START_UT - 11 * 86400).toBeGreaterThan(280000);
    expect(w.ut - DEFAULT_START_UT - 11 * 86400).toBeLessThan(350000);
    expect(w.crew.map(c => c.id)).toEqual(crew);
  } finally { spy.mockRestore(); }
}, 180_000);
