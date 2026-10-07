import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { TECH_NODES, launchCost, launchProblem, unlockTech } from '../src/data/technology';
import { buildFoundationOrbiter, buildOrbiter, buildSoundingRocket } from '../src/editor/stockCrafts';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { ascentGuidance, coastUntil, executeNode, planCircularization, planTransferToBody, runAutopilot } from '../src/game/autopilot';
import { acceptContract, evaluateContracts, generateContracts, newProgression, requestRecoveryGrant } from '../src/sim/science/progression';
import { careerScaleMultiplier } from '../src/sim/bodies/scale';
import { requireIntactFlight } from './helpers/structural';

describe('career progression invariants', () => {
  it('starting equipment actually reaches Standard orbit, with a funded early contract', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'career');
    requireIntactFlight(w);
    const craft = buildFoundationOrbiter();
    expect(launchProblem(craft, PART_CATALOG, 'career', w.progression)).toBeNull();
    const contract = w.progression.contracts.find(c => c.kind === 'orbit')!;
    w.acceptContract(contract.id); w.launch(craft);
    expect(runAutopilot(w, ascentGuidance(w, { targetApoapsis: 90000 }), { maxTime: 900 })).toBe(true);
    expect(runAutopilot(w, executeNode(w, planCircularization(w, 'apoapsis')), { maxTime: 1200 })).toBe(true);
    expect(w.orbitSummary(w.active!).pe).toBeGreaterThan(w.universe.body('earth').atmosphere!.height);
    expect(contract.status).toBe('completed');
    expect(w.progression.science).toBeGreaterThanOrEqual(20);
    expect(w.progression.funds).toBeGreaterThan(60000);
  }, 120000);
  it('first research supports a real Moon flyby and pays its new milestone', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'career');
    requireIntactFlight(w); w.progression.science = 20;
    expect(w.unlockTech('propulsion-0')).toBe(true); expect(w.unlockTech('energy-0')).toBe(true);
    expect(launchProblem(buildOrbiter(), PART_CATALOG, 'career', w.progression)).toBeNull();
    w.launch(buildOrbiter());
    expect(runAutopilot(w, ascentGuidance(w, { targetApoapsis: 90000, minStage: 2 }), { maxTime: 900 })).toBe(true);
    expect(runAutopilot(w, executeNode(w, planCircularization(w, 'apoapsis'), { minStage: 2 }), { maxTime: 1200 })).toBe(true);
    const plan = planTransferToBody(w, 'moon', { periapsisAltitude: 30000 }); expect(plan).not.toBeNull();
    expect(runAutopilot(w, executeNode(w, plan!.node, { minStage: 2 }), { maxTime: 2e6 })).toBe(true);
    coastUntil(w, plan!.encounterTime + 1000, { stopOnSoi: true });
    expect(w.active!.body).toBe('moon'); expect(w.progression.milestones).toContain('first-moon-flyby');
    expect(w.progression.science).toBeGreaterThanOrEqual(55);
    const funds = w.progression.funds;
    w.onEnteredSoi(w.active!); expect(w.progression.funds).toBe(funds);
  }, 120000);
  it('offers ten early contracts without lunar hardware dependencies, then gates lunar landing', () => {
    for (let batch = 0; batch < 4; batch++) {
      for (const c of generateContracts(20300720, batch)) expect(c.body).toBe('earth');
    }
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'career');
    const next = () => { for (const c of w.progression.contracts) if (c.status === 'offered') w.abandonContract(c.id); w.refreshContracts(); return w.progression.contracts.slice(-3); };
    w.progression.milestones.push('first-orbit');
    expect(next().every(c => c.body === 'earth')).toBe(true);
    w.progression.science = 100; unlockTech(w.progression, 'propulsion-0');
    expect(next().find(c => c.kind === 'flyby')?.body).toBe('moon');
    w.progression.milestones.push('first-moon-flyby'); unlockTech(w.progression, 'propulsion-1');
    expect(next().some(c => c.kind === 'return' && c.body === 'moon')).toBe(false);
    unlockTech(w.progression, 'structures-0'); unlockTech(w.progression, 'structures-1');
    expect(next().some(c => c.kind === 'return' && c.body === 'moon')).toBe(true);
  });
  it('bankruptcy has a repeatable recovery path at every scale, even with occupied contract slots', () => {
    for (const preset of ['standard', 'challenging', 'real'] as const) {
      const p = newProgression(careerScaleMultiplier(preset));
      p.contracts = generateContracts(1); for (const c of p.contracts) acceptContract(p, c.id, 0);
      for (let loss = 0; loss < 3; loss++) {
        p.funds = -100000;
        expect(requestRecoveryGrant(p, careerScaleMultiplier(preset))).toBe(true);
        expect(launchProblem(buildFoundationOrbiter(), PART_CATALOG, 'career', p)).toBeNull();
        expect(p.funds).toBeGreaterThan(launchCost(buildSoundingRocket(), PART_CATALOG));
        expect(requestRecoveryGrant(p, careerScaleMultiplier(preset))).toBe(false);
      }
      expect(p.reputation).toBe(-15);
    }
  });
  it('pays flyby contracts only on the target SOI event', () => {
    const p = newProgression(); p.contracts = generateContracts(1, 1, false, 1, { orbit: true, lunar: false, landing: false });
    const c = p.contracts.find(c => c.kind === 'flyby')!; acceptContract(p, c.id, 0);
    evaluateContracts(p, { type: 'soi', body: 'earth', vesselId: 'test' }); expect(c.status).toBe('active');
    evaluateContracts(p, { type: 'soi', body: 'moon', vesselId: 'test' }); expect(c.status).toBe('completed');
    expect(TECH_NODES.find(n => n.id === 'propulsion-0')!.parts).toContain('eng-zephyr');
  });
});
