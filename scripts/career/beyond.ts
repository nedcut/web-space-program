/**
 * Past the Moon: probes to Venus and Mars at their launch seasons. Each mission launches a few days before its season,
 * waits in a parking orbit, departs, trims and arrives; missions interleave in time order (a Venus probe cruises
 * while the Mars probe waits), switching the active vessel as a player would in the Tracking Station.
 * Hardware is picked by stock id from what the build offers (the Petrel planetary probe; on builds without it, the
 * closest stock design), so the same route measures any build.
 */
import { STOCK_CRAFTS } from '../../src/editor/stockCrafts';
import { researchFor } from '../../src/ui/hub/nextGoal';
import { createUniverse } from '../../src/sim/bodies';
import { createEphemeris } from '../../src/sim/orbit';
import { nextLaunchSeason } from '../../src/sim/orbit/season';
import { coastUntil } from '../../src/game/autopilot';
import type { ScalePreset } from '../../src/sim/bodies/scale';
import { buy, entryTrim, sensor, toOrbit } from './flights';
import { arrive, atmosphericLanding, capture, correct, depart, dvLeft, flyby, planDeparture, survey, type Departure } from './planets';
import type { Career } from './playthrough';

const DAY = 86400;
/** Planetary probes per scale, best first. */
const PROBES: Record<ScalePreset, string[]> = {
  standard: ['stock-petrel', 'stock-cinderbloom'],
  challenging: ['stock-petrel-challenging', 'stock-duskwing-challenging'],
  real: ['stock-petrel-real', 'stock-tern-real'],
};
/** Ascent: parking orbit and the lowest stage it may fire (the probe's own stages stay for the cruise). */
const ASCENT: Record<string, { parking: number; minStage: number }> = {
  'stock-petrel': { parking: 85000, minStage: 2 }, 'stock-petrel-challenging': { parking: 140000, minStage: 2 },
  'stock-petrel-real': { parking: 220000, minStage: 2 }, 'stock-cinderbloom': { parking: 85000, minStage: 1 },
  'stock-duskwing-challenging': { parking: 140000, minStage: 1 }, 'stock-tern-real': { parking: 220000, minStage: 2 },
};

interface Mission {
  target: 'venus' | 'mars' | 'venus-landing'; craft: string; season: number;
  state: 'pending' | 'parked' | 'cruise' | 'done'; vessel?: string; departure?: Departure;
  trims: number[]; cost: number; dv: number; trimDv: number; biomes: Set<string>; got: string[];
}

export function planetPhase(c: Career) {
  const { w, preset, log } = c, p = w.progression;
  const has = (id: string) => STOCK_CRAFTS.some(s => s.id === id && s.scale === preset);
  const probe = PROBES[preset].find(has);
  if (!probe) { log('planets: no planetary probe on this scale'); return; }

  // Research the probe (grinding the scale's usual science flight while short), then instruments as science allows.
  const need = () => researchFor(probe, p, 'career');
  for (let k = 0; k < 8 && need().cost > p.science; k++) {
    log(`planets: ${probe} needs ${need().nodes.join(' ')} (${need().cost}), ${p.science.toFixed(0)} banked: another science flight`);
    if (!c.grind()) break;
  }
  if (need().cost > p.science) { log(`planets: ${probe} still needs ${need().cost} science (${p.science.toFixed(0)} banked); stop`); return; }
  const got = c.research(need().nodes);
  got.push(...c.research(['discovery-1', 'discovery-2'].filter(id => (id === 'discovery-1' || p.unlocked.includes('discovery-1')))));
  log(`planets: research ${got.join(' ')} → ${p.science.toFixed(0)} banked`);
  const desk = (kind: string, body: string) => body === 'earth' || ((body === 'venus' || body === 'mars') && (kind === 'flyby' || kind === 'orbit'));
  c.desk(desk);

  const bodies = createUniverse(preset), ephem = createEphemeris(bodies);
  const season = (to: string) => nextLaunchSeason(bodies, ephem, 'earth', to, w.ut)?.departure ?? w.ut;
  const missions: Mission[] = (['venus', 'mars'] as const).map(target => ({ target, craft: probe, season: season(target), state: 'pending', trims: [], cost: 0, dv: 0, trimDv: 0, biomes: new Set<string>(), got: [] }));
  // Research bought for the probes shows on the first ledger row of the phase.
  let unreported = got;
  // The Venus lander (Standard) follows once its research is affordable: a third mission in the next Venus season.
  const lander = has('stock-cinderbloom') && probe !== 'stock-cinderbloom';

  const atmo = (id: string) => w.universe.body(id).atmosphere?.height ?? 0;
  // Arrive in the low-space band (above the air, below twice its height) where orbital science is richest.
  const periapsis = (m: Mission) => m.target === 'venus-landing' ? undefined : m.craft === 'stock-cinderbloom' && m.target === 'venus' ? undefined : atmo(m.target === 'venus' ? 'venus' : 'mars') * 1.5;
  const eventTime = (m: Mission) => m.state === 'pending' ? Math.max(w.ut, m.season - 5 * DAY)
    : m.state === 'parked' ? m.departure!.time - DAY
    : m.trims.length ? m.trims[0] : m.departure!.encounter - DAY;
  const finish = (m: Mission, ok: boolean, note: string) => {
    m.state = 'done';
    m.got = [...unreported, ...m.got]; unreported = [];
    c.record(`${PRETTY[m.craft] ?? m.craft} → ${m.target === 'venus-landing' ? 'Venus surface' : m.target === 'venus' ? 'Venus' : 'Mars'}`, ok,
      `${note} · departure ${m.dv.toFixed(0)} m/s, trims ${m.trimDv.toFixed(0)} m/s · ${[...m.biomes].filter(b => !b.startsWith('earth')).join(', ')}`.slice(0, 260), m.cost, m.got);
    c.desk(desk);
  };
  const focus = (m: Mission) => { if (w.active?.state.id !== m.vessel) w.switchTo(m.vessel!); };

  for (let guard = 0; guard < 60; guard++) {
    if (lander && !missions.some(m => m.target === 'venus-landing')) {
      const cost = researchFor('stock-cinderbloom', p, 'career');
      if (p.milestones.includes('first-venus') && cost.cost <= p.science) {
        const got = c.research(cost.nodes);
        log(`planets: Venus lander research ${got.join(' ')}`);
        missions.push({ target: 'venus-landing', craft: 'stock-cinderbloom', season: season('venus'), state: 'pending', trims: [], cost: 0, dv: 0, trimDv: 0, biomes: new Set<string>(), got });
      }
    }
    const open = missions.filter(m => m.state !== 'done');
    if (!open.length) break;
    const m = open.sort((a, b) => eventTime(a) - eventTime(b))[0];
    if (w.active) coastUntil(w, eventTime(m));
    else for (let k = 0; k < 100 && w.ut < eventTime(m) - 1; k++) w.advanceRailsTo(eventTime(m));
    const target = m.target === 'venus-landing' ? 'venus' : m.target;
    if (m.state === 'pending') {
      const stock = STOCK_CRAFTS.find(s => s.id === m.craft && s.scale === preset)!;
      const craft = stock.build();
      if (m.craft.startsWith('stock-petrel') || m.craft === 'stock-tern-real') {
        if (p.unlocked.includes('discovery-1')) sensor(craft, 'sensor-magnetic', 1);
        if (p.unlocked.includes('discovery-2')) sensor(craft, 'sensor-gravity', 2);
      }
      const bought = buy(w, c.ready(craft));
      if (bought.problem) { finish(m, false, bought.problem); continue; }
      m.cost = bought.cost;
      const a = ASCENT[m.craft];
      const err = toOrbit(w, m.biomes, a.parking, a.minStage);
      if (err) { finish(m, false, err); continue; }
      m.vessel = w.active!.state.id;
      const d = planDeparture(w, target, periapsis(m));
      if (typeof d === 'string') { finish(m, false, d); continue; }
      m.departure = d; m.state = 'parked';
      log(`  ${m.target}: launched day ${((w.ut - c.t0) / DAY).toFixed(1)}, departure day ${((d.time - c.t0) / DAY).toFixed(1)}`);
    } else if (m.state === 'parked') {
      focus(m);
      const d = planDeparture(w, target, m.departure!.periapsis, m.departure!.time);
      if (typeof d === 'string') { finish(m, false, d); continue; }
      const dv = depart(w, 0);
      if (typeof dv === 'string') { finish(m, false, dv); continue; }
      m.dv = dv; m.departure = d; m.state = 'cruise'; m.vessel = w.active!.state.id;
      coastUntil(w, w.ut + 120 * DAY, { stopOnSoi: true });
      const span = d.encounter - w.ut;
      m.trims = [0.05, 0.6, 0.9].map(f => w.ut + span * f);
    } else if (m.trims.length) {
      focus(m);
      const at = m.trims.shift()!;
      const used = correct(w, m.departure!, Math.max(at, w.ut + 600), 0);
      m.vessel = w.active!.state.id;
      if (typeof used === 'number') m.trimDv += used;
      else if (used !== 'no contact') { finish(m, false, used); continue; }
    } else {
      focus(m);
      const err = arrive(w, m.biomes, m.departure!);
      if (err) { finish(m, false, err); continue; }
      const arrivedDay = ((w.ut - c.t0) / DAY).toFixed(1);
      if (!w.canControl()) { finish(m, true, `arrived day ${arrivedDay}, no signal (dish out of range): no capture, no science`); continue; }
      if (m.target === 'venus-landing' || (m.craft === 'stock-cinderbloom' && m.target === 'venus')) {
        const trim = entryTrim(w, 0);
        const landed = trim.err ?? atmosphericLanding(w, m.biomes);
        finish(m, !landed, `arrived day ${arrivedDay}, ${landed ? `entry: ${landed}` : `landed on Venus (${w.active?.state.parts.map(q => q.partId).join(' ')})`}`);
        continue;
      }
      // Capture into the low-space band when the kick stage can pay; otherwise science on the flyby.
      const band = Math.max(2 * atmo(target), w.universe.body(target).radius * 0.25) * 0.95;
      const cap = capture(w, m.biomes, band, 0);
      const science = cap.err ? flyby(w, m.biomes) : survey(w, m.biomes, 6);
      const o = w.orbitSummary(w.active!);
      finish(m, true, `arrived day ${arrivedDay}, ${cap.err ? `flyby (${cap.err})` : `orbit ${(o.pe / 1000).toFixed(0)}×${(o.ap / 1000).toFixed(0)} km`}, ${science.toFixed(0)} science sent, Δv left ${dvLeft(w).toFixed(0)}`);
    }
  }
}

const PRETTY: Record<string, string> = {
  'stock-petrel': 'Petrel', 'stock-petrel-challenging': 'Petrel', 'stock-petrel-real': 'Petrel', 'stock-cinderbloom': 'Cinderbloom',
  'stock-duskwing-challenging': 'Duskwing', 'stock-tern-real': 'Tern',
};
