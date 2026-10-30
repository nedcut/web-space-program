import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT } from '../src/game/store';
import { STOCK_CRAFTS, buildOrbiter, buildSoundingRocket } from '../src/editor/stockCrafts';
import { generateContracts, newProgression } from '../src/sim/science/progression';
import { careerScaleMultiplier } from '../src/sim/bodies/scale';
import { launchOptions } from '../src/ui/hub/quickLaunch';
import { nextGoal, researchFor } from '../src/ui/hub/nextGoal';
import { planFreeReturn } from '../src/game/autopilot';
import { arrivalPeriapsisAltitude } from '../src/game/planning/arrival';
import { buy, hop, sensor, toOrbit } from '../scripts/career/flights';
import { dvLeft } from '../scripts/career/planets';
import { flyFirstRocket } from '../scripts/career/bare-pod';

const career = (preset: 'standard' | 'challenging' | 'real' = 'standard') => new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT, 'career');

describe('first flights', () => {
  it('the stock Kestrel flown straight up at full throttle, SAS off, comes home with its science', () => {
    // The pilot only stages the parachute: the capsule must trim heat-shield first by itself.
    const w = career();
    const r = hop(w, sensor(buildSoundingRocket()), { sas: false });
    expect(r.ok, r.note).toBe(true);
    expect([...r.biomes].some(b => b.includes('/spaceHigh/'))).toBe(true);
    expect(w.progression.science).toBeGreaterThan(40);
  }, 240_000);

  it('the classic first rocket without a heat shield trims base first and lands under its chute', () => {
    // Capsule, chute, decoupler, tank, engine: straight up to ~110 km, everything staged on the way down.
    for (const mode of ['retrograde', 'off'] as const) {
      const w = career();
      const r = flyFirstRocket(mode, false, { world: w });
      console.log('GOLDEN bare', mode, JSON.stringify({ ...r, time: w.ut - DEFAULT_START_UT, parts: w.active?.state.parts.length }));
      expect(w.active?.state.destroyed).toBe(false);
      expect(w.crewFor()).toHaveLength(1);
      expect(['landed', 'splashed']).toContain(w.active?.state.situation);
      expect(r.lost, `${mode}: ${r.events.join('; ')}`).toBe(false);
      expect(r.touchdown, mode).toBeGreaterThan(5);
      expect(r.touchdown, mode).toBeLessThan(9);
      expect(r.apex, mode).toBeGreaterThan(100000);
      expect(r.apex, mode).toBeLessThan(120000);
      expect(r.maxG, mode).toBeGreaterThan(8);
      expect(r.maxG, mode).toBeLessThan(14);
      expect(w.ut - DEFAULT_START_UT, mode).toBeGreaterThan(470);
      expect(w.ut - DEFAULT_START_UT, mode).toBeLessThan(580);
      expect(w.active!.state.parts).toHaveLength(3);
      expect(r.events.some(e => e.startsWith('full')), mode).toBe(true);
    }
  }, 240_000);

  it('the classic first rocket also comes home on the Challenging and Real scales', () => {
    // Measured 2026-10-30: Challenging apex 73.0/74.5 km, 15.3/15.7 g; Real 48.1/49.7 km, 7.0/7.3 g; touchdown 6.93 m/s.
    const bounds = { challenging: { apex: [65000, 85000], g: [12, 19] }, real: { apex: [40000, 60000], g: [5, 10] } } as const;
    for (const preset of ['challenging', 'real'] as const) for (const mode of ['retrograde', 'off'] as const) {
      const w = career(preset);
      const r = flyFirstRocket(mode, false, { world: w });
      const at = `${preset}/${mode}: ${JSON.stringify({ apex: r.apex, maxG: r.maxG, touchdown: r.touchdown })}`;
      expect(r.lost, `${at} ${r.events.join('; ')}`).toBe(false);
      expect(w.active?.state.destroyed, at).toBe(false);
      expect(w.crewFor(), at).toHaveLength(1);
      expect(['landed', 'splashed'], at).toContain(w.active?.state.situation);
      expect(w.active!.state.parts, at).toHaveLength(3);
      expect(r.touchdown, at).toBeGreaterThan(5);
      expect(r.touchdown, at).toBeLessThan(9);
      expect(r.apex, at).toBeGreaterThan(bounds[preset].apex[0]);
      expect(r.apex, at).toBeLessThan(bounds[preset].apex[1]);
      expect(r.maxG, at).toBeGreaterThan(bounds[preset].g[0]);
      expect(r.maxG, at).toBeLessThan(bounds[preset].g[1]);
    }
  }, 120_000);

  it("the Earth test flight's surface objective waits for the capsule, not its spent stage", () => {
    const w = career();
    const c = w.progression.contracts.find(c => c.kind === 'return' && c.body === 'earth')!;
    w.acceptContract(c.id);
    let early = false;
    const r = flyFirstRocket('retrograde', true, { world: w, craft: buildSoundingRocket(), onTick: w => { if (c.landed && w.active?.state.situation === 'flying') early = true; } });
    expect(r.lost).toBe(false);
    expect(early).toBe(false);
    expect(c.landed).toBe(true);
  }, 240_000);

  it('a splashdown completes the Earth test flight and every scale can launch something at once', () => {
    const w = career();
    const c = w.progression.contracts.find(c => c.kind === 'return')!;
    expect(c.body).toBe('earth');
    expect(w.acceptContract(c.id)).toBe(true);
    const r = hop(w, sensor(buildSoundingRocket()), { pitch: 30 });
    expect(r.ok, r.note).toBe(true);
    expect([...r.biomes].some(b => b.startsWith('earth/splashed'))).toBe(true);
    expect(c.status).toBe('completed');
    // The debrief's recovery value is the hardware refund, not the contract reward paid at recovery.
    expect(w.lastRecoveryRefund).toBeGreaterThan(0);
    expect(w.lastRecoveryRefund).toBeLessThanOrEqual(r.cost);
    for (const preset of ['standard', 'challenging', 'real'] as const) {
      const universe = new Universe(preset);
      const stock = STOCK_CRAFTS.filter(s => s.scale === preset).map(s => ({ id: s.id, craft: s.build() }));
      const options = launchOptions({ pad: null, saved: [], stock, mode: 'career', progression: newProgression(careerScaleMultiplier(preset)), earth: universe.body('earth'), preset });
      expect(options.some(o => !o.blocked && !o.warning), preset).toBe(true);
    }
  }, 240_000);
});

describe('contract desk', () => {
  it('never offers a duplicate of an active commission and replaces stale offers when capability grows', () => {
    const w = career(), p = w.progression;
    for (const c of p.contracts.filter(c => c.status === 'offered')) w.acceptContract(c.id);
    expect(w.refreshContracts()).toBe(true);
    const active = p.contracts.filter(c => c.status === 'active');
    for (const offer of p.contracts.filter(c => c.status === 'offered'))
      expect(active.some(a => a.kind === offer.kind && a.body === offer.body && a.biome === offer.biome)).toBe(false);
    // Offers on the desk are kept until capability changes; the first orbit plus first research brings the Moon.
    expect(w.refreshContracts()).toBe(false);
    p.science = 10;
    w.emitProgress({ type: 'orbit', body: 'earth', vesselId: 'x' });
    expect(w.unlockTech('propulsion-0')).toBe(true);
    expect(p.contracts.some(c => c.status === 'offered' && c.kind === 'flyby' && c.body === 'moon')).toBe(true);
    // Accepted commissions are never swept away with the stale offers (the orbit one just completed).
    expect(active.every(a => p.contracts.includes(a) && (a.status === 'active' || (a.kind === 'orbit' && a.status === 'completed')))).toBe(true);
  });

  it('pays home-planet test flights and field surveys the same on every scale; orbital work scales', () => {
    const at = (m: number) => generateContracts(20300720, 0, false, m);
    const [orbit1, return1, field1] = at(1), [orbit100, return100, field100] = at(careerScaleMultiplier('real'));
    expect(return100.reward).toBe(return1.reward);
    expect(field100.reward).toBe(field1.reward);
    expect(orbit100.reward).toBe(orbit1.reward * 100);
    expect(Number.isInteger(at(careerScaleMultiplier('challenging'))[0].advance)).toBe(true);
    expect(newProgression(careerScaleMultiplier('challenging')).funds).toBe(614400);
    // Accepting then abandoning never makes money, at any scale or batch.
    for (const m of [1, 10.24, 100]) for (let batch = 0; batch < 6; batch++)
      for (const c of generateContracts(7, batch, batch > 3, m, { orbit: batch > 1, lunar: batch > 2, landing: batch > 2 })) expect(c.penalty).toBeGreaterThanOrEqual(c.advance);
  });
});

describe('hub next goal', () => {
  it('walks a new program from commissions to a sounding hop, orbit, the Moon and beyond', () => {
    const p = newProgression();
    p.contracts = generateContracts(1, 0);
    expect(nextGoal(p, 'career', 'standard')?.action).toBe('missions');
    p.contracts[0].status = 'active';
    expect(nextGoal(p, 'career', 'standard')?.title).toBe('Fly a sounding rocket');
    p.archive['temperature/earth/landed/Launch Complex'] = { body: 'earth', biome: 'Launch Complex', situation: 'landed', experiment: 'temperature', runs: 1, science: 8 };
    expect(nextGoal(p, 'career', 'standard')).toMatchObject({ title: 'Reach orbit', action: 'launch', recommendedStockId: 'stock-firstlight' });
    p.milestones.push('first-orbit');
    expect(nextGoal(p, 'career', 'standard')).toMatchObject({ title: 'Fly to the Moon', action: 'launch' });
    expect(nextGoal(p, 'career', 'standard')!.detail).toMatch(/20 more science/);
    p.science = 25;
    expect(nextGoal(p, 'career', 'standard')).toMatchObject({ action: 'research' });
    expect(researchFor('stock-selene', p, 'career').cost).toBe(110);
    p.milestones.push('first-moon-flyby', 'first-moon');
    expect(nextGoal(p, 'career', 'standard')?.title).toBe('Send a probe to Mars');
    expect(nextGoal(p, 'sandbox', 'standard')).toBeNull();
    expect(researchFor('stock-meridian-challenging', newProgression(), 'career').cost).toBe(280);
  });
});

describe('free return', () => {
  it('plans a Moon flyby that falls back into the entry corridor with no return burn', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 11 * 86400, 'science');
    w.progression.unlocked.push('propulsion-0', 'energy-0');
    expect(buy(w, buildOrbiter()).problem).toBeNull();
    expect(toOrbit(w, new Set(), 90000, 2)).toBeNull();
    console.log('GOLDEN orbit', JSON.stringify({ ...w.orbitSummary(w.active!), dv: dvLeft(w), time: w.ut - DEFAULT_START_UT - 11 * 86400, parts: w.active!.state.parts.length }));
    const orbit = w.orbitSummary(w.active!);
    expect(orbit.pe).toBeGreaterThan(80000); // safely above the 70 km atmosphere
    expect(orbit.pe).toBeLessThan(100000);
    expect(orbit.ap).toBeGreaterThan(80000);
    expect(orbit.ap).toBeLessThan(100000);
    expect(dvLeft(w)).toBeGreaterThan(1200);
    expect(dvLeft(w)).toBeLessThan(1700);
    expect(w.ut - DEFAULT_START_UT - 11 * 86400).toBeGreaterThan(250);
    expect(w.ut - DEFAULT_START_UT - 11 * 86400).toBeLessThan(350);
    expect(w.active!.state.parts).toHaveLength(9);
    expect(w.active!.state.destroyed).toBe(false);
    expect(w.crewFor()).toHaveLength(1);
    const plan = planFreeReturn(w, 'moon');
    expect(plan).not.toBeNull();
    const entry = arrivalPeriapsisAltitude(w, 'moon', 'earth', w.ut);
    expect(Math.abs(plan!.returnPerigee! - entry)).toBeLessThan(5000);
    expect(plan!.dv).toBeLessThan(1100);
    expect(w.nodes).toHaveLength(1);
  }, 240_000);
});
