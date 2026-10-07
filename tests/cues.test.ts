import { describe, expect, it } from 'vitest';
import { enqueueNotification, whyCantStage, whyCantWarp } from '../src/game/cues';
import { preflightChecks } from '../src/editor/checks';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { computeStageStats } from '../src/editor/ui/dv';
import { buildVessel } from '../src/sim/vessel/assembly';
import { stageExplanation, throttleExplanation } from '../src/flight/cues';
import { HintTracker } from '../src/flight/hints';

const stage = { locked: false, control: true, eva: false, remaining: true, useful: false, engines: true, fuel: true };
describe('action explanations', () => {
  it('prioritizes lock and authority and permits separator-only stages', () => {
    expect(whyCantStage({ ...stage, locked: true, control: false })).toContain('locked');
    expect(whyCantStage({ ...stage, control: false })).toContain('signal');
    expect(whyCantStage({ ...stage, remaining: false })).toContain('remaining');
    expect(whyCantStage({ ...stage, fuel: false })).toContain('propellant');
    expect(whyCantStage({ ...stage, engines: false })).toContain('no engines');
    expect(whyCantStage({ ...stage, engines: false, fuel: false, useful: true })).toBeNull();
  });
  it('distinguishes atmosphere, thrust and encounter refusal', () => {
    const context = { thrusting: false, inAtmosphere: true, landed: false };
    expect(whyCantWarp(context)).toContain('atmosphere');
    expect(whyCantWarp({ ...context, thrusting: true })).toContain('thrusting');
    expect(whyCantWarp({ ...context, nearSoi: true })).toContain('sphere');
    expect(whyCantWarp({ ...context, inAtmosphere: false, accelerating: true })).toContain('acceleration');
    expect(whyCantWarp({ ...context, landed: true })).toBeNull();
  });
  it('explains unstaged and dry stock engines without mutating the vessel', () => {
    const v = buildVessel(STOCK_CRAFTS[0].build(), PART_CATALOG);
    expect(throttleExplanation(v)).toContain('not staged');
    expect(stageExplanation(v, false, true)).toBeNull();
    for (const p of v.parts) { for (const r of Object.keys(p.resources)) p.resources[r as keyof typeof p.resources] = 0; if (p.engine) p.engine.ignited = true; }
    expect(throttleExplanation(v)).toContain('propellant');
  });
});
it('bounds messages and suppresses repeated notifications after dismissal', () => {
  const msg = { id: 1, text: 'No fuel', level: 'warn' as const, expires: 4000 };
  const first = enqueueNotification([], new Map(), msg, 0);
  expect(first.messages).toHaveLength(1);
  expect(enqueueNotification([], first.history, { ...msg, id: 2 }, 5000).messages).toHaveLength(0);
  expect(enqueueNotification([], first.history, { ...msg, expires: 13000 }, 9000).messages).toHaveLength(1);
  let result = first;
  for (let i = 2; i < 9; i++) result = enqueueNotification(result.messages, result.history, { ...msg, id: i, text: String(i) }, i);
  expect(result.messages.map(m => m.id)).toEqual([5, 6, 7, 8]);
});
describe('preflight checks', () => {
  it('does not claim the starter rocket is missing engine, fuel, control or lift', () => {
    const craft = STOCK_CRAFTS[0].build();
    const checks = preflightChecks(craft, PART_CATALOG, computeStageStats(craft, PART_CATALOG).get(0));
    expect(checks.filter(c => /^(first-engine|fuel-|control|twr|order-)/.test(c.id))).toEqual([]);
  });
  it('finds missing fuel paths and highlights the engines', () => {
    const craft = STOCK_CRAFTS[0].build();
    for (const p of craft.parts) p.resources = { liquidFuel: 0, oxidizer: 0, solidFuel: 0 };
    const checks = preflightChecks(craft, PART_CATALOG);
    expect(checks.filter(c => c.id.startsWith('fuel-')).length).toBeGreaterThan(0);
    expect(checks.filter(c => c.id.startsWith('fuel-')).every(c => c.uids.length > 0)).toBe(true);
  });
  it('handles an empty editor', () => {
    expect(preflightChecks({ name: '', version: 1, type: 'VAB', parts: [] }, PART_CATALOG)).toEqual([]);
  });
});
it('dismissed contextual tips persist through a new tracker and obey settings', () => {
  let saved: string[] = [];
  const tracker = new HintTracker(new Set(), seen => { saved = [...seen]; });
  const input = { enabled: true, flying: false, map: true, altitude: 0, surfaceSpeed: 0, apoapsis: 0, periapsis: 0, timeToAp: 0, atmosphereHeight: 1, throttle: 0, hasThrust: false };
  expect(tracker.update(input)?.id).toBe('map');
  tracker.dismiss();
  expect(saved).toEqual(['map']);
  expect(tracker.update(input)).toBeNull();
  expect(tracker.update({ ...input, enabled: false, eva: true })).toBeNull();
});
