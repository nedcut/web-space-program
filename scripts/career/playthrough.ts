/**
 * Headless career playthrough with real flights: npx tsx scripts/career/playthrough.ts [standard|challenging|real]
 * A player-like route (accept what can be done, decline what cannot, research toward the next goal) flown through
 * World and the autopilot building blocks. Prints a ledger row per flight and the program state at the end.
 */
import '../earth-data/register';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { DEFAULT_START_UT } from '../../src/game/store';
import { TECH_NODES } from '../../src/data/technology';
import { buildFoundationOrbiter, buildMoonLander, buildOrbiter, buildSoundingRocket } from '../../src/editor/stockCrafts';
import type { ScalePreset } from '../../src/sim/bodies/scale';
import type { CraftDef } from '../../src/sim/vessel/types';
import { captureMoon, deorbitAndRecover, descend, doScience, hop, landMoon, moonAscent, moonHome, sensor, toMoon, toOrbit, buy } from './flights';

export interface LedgerRow { flight: number; name: string; ok: boolean; note: string; cost: number; funds: number; science: number; reputation: number; days: number; research: string; contracts: string }

export function playCareer(preset: ScalePreset = 'standard', log = (s: string) => console.log(s)) {
  const w = new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT, 'career');
  const p = w.progression;
  const t0 = w.ut;
  const rows: LedgerRow[] = [];
  const done = new Set<string>();
  let flight = 0;

  // Contract desk: accept anything on offer that is plausible now; decline the rest and ask for more.
  const desk = (canDo: (kind: string, body: string, biome?: string) => boolean) => {
    for (let round = 0; round < 6; round++) {
      for (const c of p.contracts.filter(c => c.status === 'offered')) {
        if (canDo(c.kind, c.body, c.biome) && p.contracts.filter(c => c.status === 'active').length < 3) w.acceptContract(c.id);
        else w.abandonContract(c.id);
      }
      const before = p.contracts.length;
      w.refreshContracts();
      if (p.contracts.length === before) break;
      if (p.contracts.filter(c => c.status === 'active').length >= 3) break;
    }
  };
  const research = (ids: string[]) => {
    const got: string[] = [];
    for (const id of ids) if (!p.unlocked.includes(id) && w.unlockTech(id)) got.push(id);
    return got;
  };
  const record = (name: string, ok: boolean, note: string, cost: number, got: string[]) => {
    const active = p.contracts.filter(c => c.status === 'active').map(c => c.title).join('; ');
    const row: LedgerRow = { flight: ++flight, name, ok, note, cost, funds: Math.round(p.funds), science: +p.science.toFixed(1), reputation: p.reputation,
      days: +((w.ut - t0) / 86400).toFixed(1), research: got.join(' ') || '—', contracts: active };
    rows.push(row);
    log(`#${row.flight} ${name} ${ok ? 'OK' : 'FAIL'} cost ${cost} → funds ${row.funds} sci ${row.science} rep ${row.reputation} day ${row.days} | research ${row.research} | ${note} | active: ${active}`);
    for (const m of w.messages) if (/Contract|Milestone|First|Discovered|science ·/.test(m.text)) done.add(m.text);
  };
  const orbitFlight = (name: string, craft: CraftDef, minStage = 0) => {
    const biomes = new Set<string>();
    const { cost, problem } = buy(w, craft);
    if (problem) return { cost, err: problem, biomes };
    doScience(w);
    const err = toOrbit(w, biomes, 90000 * (preset === 'standard' ? 1 : preset === 'challenging' ? 1.35 : 1.8), minStage) ?? deorbitAndRecover(w, biomes);
    return { cost, err, biomes };
  };

  log(`== ${preset}: funds ${p.funds}, offers: ${p.contracts.map(c => c.title).join(' | ')}`);
  const earthOnly = (kind: string, body: string, biome?: string) => body === 'earth' && (kind !== 'science' || biome === 'Launch Complex' || biome === 'Oceans' || biome === 'Shores');
  desk(earthOnly);

  // 1–2: sounding hops with the starting thermometer (what a new player can build immediately).
  for (let i = 0; i < 2; i++) {
    const r = hop(w, sensor(buildSoundingRocket()));
    record(`Kestrel hop ${i + 1}`, r.ok, r.note, r.cost, research(i === 0 ? ['propulsion-0', 'energy-0'] : ['discovery-0']));
    desk(earthOnly);
  }
  // 3: first orbit on starting parts.
  {
    const r = orbitFlight('Firstlight orbit', sensor(buildFoundationOrbiter()));
    record('Firstlight orbit', !r.err, r.err ?? [...r.biomes].join(', '), r.cost, research(['propulsion-0', 'energy-0', 'discovery-0']));
  }
  desk((kind, body) => body === 'earth' || kind === 'flyby');
  // 4: Moon flyby and return with Meridian.
  {
    const biomes = new Set<string>();
    const craft = sensor(buildOrbiter());
    const { cost, problem } = buy(w, craft);
    let err = problem;
    if (!err) err = toOrbit(w, biomes, 90000, 2) ?? toMoon(w, biomes, 2, 60000) ?? moonHome(w, biomes, 0) ?? deorbitAndRecover(w, biomes);
    record('Meridian Moon flyby', !err, err ?? [...biomes].join(', '), cost, research(['propulsion-1', 'structures-0', 'structures-1', 'guidance-0']));
  }
  desk(() => true);
  // 5: Selene landing and return.
  {
    const biomes = new Set<string>();
    const craft = sensor(buildMoonLander());
    const { cost, problem } = buy(w, craft);
    let err = problem;
    if (!err) {
      err = toOrbit(w, biomes, 90000, 4) ?? toMoon(w, biomes, 4) ?? captureMoon(w, biomes, 2);
      if (!err) { w.stageActive(); w.stageActive(); err = landMoon(w, biomes, 2) ?? moonAscent(w, biomes, 2) ?? moonHome(w, biomes, 0) ?? deorbitAndRecover(w, biomes); }
    }
    record('Selene Moon landing', !err, err ?? [...biomes].join(', '), cost, research([]));
  }
  void descend;
  const affordable = TECH_NODES.filter(n => !p.unlocked.includes(n.id) && n.requires.every(r => p.unlocked.includes(r)) && n.cost <= p.science).map(n => n.id);
  log(`end: funds ${Math.round(p.funds)} science ${p.science.toFixed(1)} rep ${p.reputation} unlocked ${p.unlocked.join(' ')} milestones ${p.milestones.join(' ')} affordable ${affordable.join(' ')}`);
  log(`contracts: ${p.contracts.map(c => `${c.title}=${c.status}`).join(' | ')}`);
  return { rows, world: w };
}

if (process.argv[1]?.endsWith('playthrough.ts')) playCareer((process.argv[2] as ScalePreset) ?? 'standard');
