import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { RESOURCES } from '../src/data/resources';
import { facilityProblem, launchMass, launchProblem } from '../src/data/technology';
import { DEFAULT_START_UT } from '../src/game/store';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { craftStats } from '../src/editor/core/stats';
import { contractSlots, facilityLevel, levelFor, LEGACY_FACILITIES, NEW_PROGRAM_FACILITIES, ownedLevel, scienceBonus, upgradeCost, upgradeFacility } from '../src/sim/science/facilities';
import { generateContracts, newProgression } from '../src/sim/science/progression';
import { nextGoal } from '../src/ui/hub/nextGoal';
import type { ScalePresetId } from '../src/sim/bodies/scale';
import type { CraftDef } from '../src/sim/vessel/types';
import { qIdentity } from '../src/util/quat';
import { v3 } from '../src/util/vec3';

const stock = (id: string) => STOCK_CRAFTS.find(s => s.id === id)!.build();
const career = (preset: ScalePresetId = 'standard') => new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT, 'career');
const pod = (): CraftDef => ({ name: 'Pod', type: 'VAB', version: 1, parts: [
  { uid: 1, partId: 'pod-lantern-1', position: v3(), rotation: qIdentity() },
  { uid: 2, partId: 'sensor-thermal', position: v3(0, 0, 0.7), rotation: qIdentity(), parent: 1, attachNode: 'srf' },
] });
/** Levels needed by a stock craft on its own scale: [pad, hall]. */
const needs = (id: string) => {
  const s = STOCK_CRAFTS.find(s => s.id === id)!, c = s.build();
  return [levelFor('pad', launchMass(c, PART_CATALOG), s.scale), levelFor('hall', c.parts.length, s.scale)];
};

describe('facility limits', () => {
  it('counts launch mass exactly as the editor does', () => {
    const densities = Object.fromEntries(Object.values(RESOURCES).map(r => [r.id, r.density]));
    for (const s of STOCK_CRAFTS) { const c = s.build(); expect(launchMass(c, PART_CATALOG), s.id).toBeCloseTo(craftStats(c, PART_CATALOG, densities).totalMass, 6); }
  });
  it('flies the Moon route to the first flyby at level 1; landers need a level-2 pad (and hall on larger scales)', () => {
    for (const id of ['stock-kestrel', 'stock-firstlight', 'stock-meridian', 'stock-kestrel-challenging', 'stock-meridian-challenging', 'stock-kestrel-real', 'stock-meridian-real'])
      expect(needs(id), id).toEqual([1, 1]);
    expect(needs('stock-selene')).toEqual([2, 1]);
    expect(needs('stock-selene-challenging')).toEqual([2, 2]);
    expect(needs('stock-selene-real')).toEqual([2, 2]);
    // Nothing stock needs more than level 3, and level 3 takes anything.
    for (const s of STOCK_CRAFTS) expect(Math.max(...needs(s.id)), s.id).toBeLessThanOrEqual(3);
  });
  it('blocks a career launch past the pad limit with the level needed, and launches after the upgrade', () => {
    const w = career();
    w.progression.unlocked = ['foundation', 'propulsion-0', 'propulsion-1', 'structures-0', 'structures-1', 'guidance-0', 'energy-0'];
    w.progression.funds = 200_000;
    const selene = stock('stock-selene');
    const block = facilityProblem(selene, PART_CATALOG, 'career', w.progression, 'standard')!;
    expect(block).toMatchObject({ facility: 'pad', level: 2 });
    expect(launchProblem(selene, PART_CATALOG, 'career', w.progression, 'standard')).toContain('Launch Pad');
    expect(() => w.launch(selene)).toThrow('Launch Pad');
    expect(w.progression.funds).toBe(200_000);
    expect(w.upgradeFacility('pad')).toBe(true);
    expect(w.progression.funds).toBe(160_000);
    expect(() => w.launch(selene)).not.toThrow();
  });
  it('limits part count in the Integration Hall', () => {
    const p = newProgression(), big = pod();
    for (let i = 0; i < 30; i++) big.parts.push({ uid: 10 + i, partId: 'sensor-thermal', position: v3(0, i * 0.1, 0.7), rotation: qIdentity(), parent: 1, attachNode: 'srf' });
    expect(facilityProblem(big, PART_CATALOG, 'career', p, 'standard')).toMatchObject({ facility: 'hall', level: 2 });
    p.facilities!.hall = 2;
    expect(facilityProblem(big, PART_CATALOG, 'career', p, 'standard')).toBeNull();
  });
  it('has no limits outside careers', () => {
    const p = newProgression();
    for (const mode of ['sandbox', 'science'] as const) {
      expect(facilityLevel(p, mode, 'pad')).toBe(3);
      expect(facilityProblem(stock('stock-hearthlight'), PART_CATALOG, mode, p, 'standard')).toBeNull();
      expect(scienceBonus({ facilities: { ...NEW_PROGRAM_FACILITIES, lab: 3 } }, mode)).toBe(0);
    }
    const sandbox = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'sandbox');
    expect(() => sandbox.launch(stock('stock-hearthlight'))).not.toThrow();
    expect(sandbox.upgradeFacility('pad')).toBe(false);
  });
});

describe('buying upgrades', () => {
  it('charges the scaled price, steps one level at a time and refuses without funds or at the top', () => {
    const p = newProgression();
    expect(upgradeCost(p, 'pad')).toBe(40_000);
    expect(upgradeCost(p, 'pad', 10.24)).toBe(409_600);
    p.funds = 39_999;
    expect(upgradeFacility(p, 'career', 'pad')).toBe(false);
    p.funds = 1_000_000;
    expect(upgradeFacility(p, 'career', 'pad')).toBe(true);
    expect(upgradeFacility(p, 'career', 'pad')).toBe(true);
    expect(p.funds).toBe(1_000_000 - 40_000 - 180_000);
    expect(upgradeCost(p, 'pad')).toBeNull();
    expect(upgradeFacility(p, 'career', 'pad')).toBe(false);
    expect(upgradeFacility(p, 'science', 'lab')).toBe(false);
  });
  it('Mission Control adds commission slots and better rewards', () => {
    const w = career();
    w.progression.contracts = [...generateContracts(1, 0), ...generateContracts(2, 1)].map((c, i) => ({ ...c, id: `c${i}` }));
    for (const c of w.progression.contracts.slice(0, 3)) expect(w.acceptContract(c.id)).toBe(true);
    expect(w.acceptContract('c3')).toBe(false);
    w.progression.funds = 1e6;
    w.upgradeFacility('control');
    expect(contractSlots(w.progression, 'career')).toBe(4);
    expect(w.acceptContract('c3')).toBe(true);
    const base = generateContracts(5, 2), better = generateContracts(5, 2, false, 1, undefined, 1.25);
    expect(better.map(c => c.reward)).toEqual(base.map(c => Math.round(c.reward * 1.25)));
    expect(better.map(c => c.advance)).toEqual(base.map(c => c.advance));
  });
  it('the Research Lab adds its bonus to credited science', () => {
    const run = (lab: number) => {
      const w = career(); w.commsSettings.enabled = false;
      w.progression.facilities!.lab = lab;
      w.launch(pod());
      w.runExperiment(2, 'temperature');
      w.recoverActive();
      return w.progression.science;
    };
    expect(run(1)).toBeCloseTo(8);
    expect(run(2)).toBeCloseTo(8 * 1.15);
    expect(run(3)).toBeCloseTo(8 * 1.3);
  });
});

describe('saves', () => {
  it('starts new careers at level 1 and round-trips levels', () => {
    const w = career();
    expect(w.progression.facilities).toEqual(NEW_PROGRAM_FACILITIES);
    w.progression.funds = 1e6; w.upgradeFacility('lab');
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), PART_CATALOG);
    expect(ownedLevel(back.progression, 'lab')).toBe(2);
    expect(ownedLevel(back.progression, 'pad')).toBe(1);
  });
  it('migrates careers saved before upgrades without taking anything away', () => {
    const w = career();
    const saved = JSON.parse(JSON.stringify(serializeWorld(w)));
    delete saved.progression.facilities;
    const back = deserializeWorld(saved, PART_CATALOG);
    expect(back.progression.facilities).toEqual(LEGACY_FACILITIES);
    back.progression.unlocked = ['foundation', 'propulsion-0', 'propulsion-1', 'structures-0', 'structures-1', 'guidance-0', 'energy-0'];
    expect(facilityProblem(stock('stock-selene'), PART_CATALOG, 'career', back.progression, 'standard')).toBeNull();
    expect(contractSlots(back.progression, 'career')).toBe(3);
    // A progression record without levels (hand-made or very old) reads the same way.
    expect(ownedLevel({}, 'pad')).toBe(3);
  });
});

describe('next goal', () => {
  it('names the pad upgrade when it is what stands between the program and the Moon landing', () => {
    const p = newProgression();
    p.milestones = ['first-orbit', 'first-moon-flyby'];
    p.archive = { x: { body: 'earth', situation: 'landed', biome: 'Launch Complex', experiment: 'temperature', runs: 1, science: 8 } };
    p.unlocked = ['foundation', 'propulsion-0', 'propulsion-1', 'structures-0', 'structures-1', 'guidance-0', 'energy-0'];
    p.funds = 100_000;
    const goal = nextGoal(p, 'career', 'standard')!;
    expect(goal.upgrade).toMatchObject({ facility: 'pad', level: 2 });
    expect(goal.detail).toContain('Launch Pad');
    expect(goal.detail).toContain('40,000 cr');
    p.facilities!.pad = 2;
    expect(nextGoal(p, 'career', 'standard')!.upgrade).toBeUndefined();
  });
});
