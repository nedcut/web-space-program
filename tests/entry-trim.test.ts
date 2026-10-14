import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT } from '../src/game/store';
import { buildOrbiter, buildMoonLander } from '../src/editor/stockCrafts';
import { buildVessel } from '../src/sim/vessel/assembly';
import { cloneVessel } from '../src/sim/vessel/assembly';
import { entryCorridor, enteringDragPerMass, entryDragPerMass, findEntry, planEntryTrim } from '../src/game/planning/entry';
import { createPlannerHandler } from '../src/game/planning/handler';
import { planningSnapshot } from '../src/game/planning/client';
import { applyEntryTrim } from '../src/game/planning/apply';
import type { PlannerEvent } from '../src/game/planning/protocol';
import { arrivalPeriapsisAltitude } from '../src/game/planning/arrival';
import { planFreeReturn } from '../src/game/autopilot';
import { length } from '../src/util/vec3';
import { trimAndEnter } from '../scripts/career/trim-check';
import { buy, deorbitAndRecover, entryTrim, freeReturnFlyby, toOrbit } from '../scripts/career/flights';

const capsule = () => {
  const craft = buildMoonLander();
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const above = (uid: number): boolean => { const p = byUid.get(uid)!; return !p.partId.startsWith('dec-') && (p.parent === undefined || above(p.parent)); };
  return buildVessel({ ...craft, parts: craft.parts.filter(p => above(p.uid)) }, PART_CATALOG);
};

describe('entry corridor model', () => {
  it('matches the flight integrator: skip edge and the lunar-return target on every scale', () => {
    // Skip edges measured with the full rigid-body capsule (tests/entry-corridor.test.ts setup): 24.2 / 38.3 / ~60 km.
    const measured = { standard: 24200, challenging: 38300, real: 60200 };
    const kd = entryDragPerMass(capsule());
    for (const scale of ['standard', 'challenging', 'real'] as const) {
      const u = new Universe(scale), earth = u.body('earth');
      const ra = length(u.ephem.getRelativeState('moon', DEFAULT_START_UT).position);
      const c = entryCorridor(earth, -earth.gm / (ra + earth.radius), kd)!;
      expect(Math.abs(c.shallow - measured[scale]), scale).toBeLessThan(1500);
      expect(c.steep).toBeLessThan(c.target);
      // The planned periapsis sits close to the 25 kPa design altitude validated in the flight tests.
      const design = arrivalPeriapsisAltitude({ universe: u, ut: DEFAULT_START_UT } as never, 'moon', 'earth', DEFAULT_START_UT);
      expect(Math.abs(c.target - design), scale).toBeLessThan(2500);
    }
  });

  it('measures what enters: the capsule after its service stage is dropped, without touching the vessel', () => {
    const v = buildVessel(buildOrbiter(), PART_CATALOG);
    const parts = v.parts.length, stage = v.nextStage, mass = v.mass;
    const whole = entryDragPerMass(v), entering = enteringDragPerMass(v);
    expect(v.parts.length).toBe(parts);
    expect(v.nextStage).toBe(stage);
    expect(v.mass).toBe(mass);
    expect(Math.abs(entering - entryDragPerMass(capsule())) / entering).toBeLessThan(0.15);
    expect(entering).toBeGreaterThan(whole);
    expect(enteringDragPerMass(cloneVessel(v))).toBe(entering);
  });

  it('does not treat a parking orbit as an entry', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'science');
    w.progression.unlocked.push('propulsion-0', 'energy-0');
    expect(buy(w, buildOrbiter()).problem).toBeNull();
    expect(toOrbit(w, new Set(), 90000, 2)).toBeNull();
    expect(findEntry(w.trajectory(), id => w.universe.body(id))).toBeNull();
  }, 240_000);
});

describe('entry trim', () => {
  for (const scale of ['standard', 'challenging', 'real'] as const) {
    for (const offset of [15000, -8000]) {
      it(`moves a ${offset > 0 ? 'skipping' : 'steep'} Moon return into the corridor and captures in one pass (${scale})`, () => {
        const r = trimAndEnter(scale, offset * (scale === 'real' ? 2 : 1));
        expect(r.err).toBeNull();
        const plan = r.plan!;
        expect(plan.dv).toBeLessThan(5);
        expect(plan.after).toBeGreaterThan(plan.corridor.steep);
        expect(plan.after).toBeLessThan(plan.corridor.shallow);
        // Flown with the real integrator: no skip, hypersonic deceleration under the corridor's g limit.
        expect(r.exited).toBe(false);
        expect(r.maxG!).toBeGreaterThan(2);
        expect(r.maxG!).toBeLessThan(plan.corridor.gLimit);
      }, 240_000);
    }
  }

  it('runs in the planner worker protocol and keeps existing nodes', async () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 11 * 86400, 'science');
    w.progression.unlocked.push('propulsion-0', 'energy-0');
    expect(buy(w, buildOrbiter()).problem).toBeNull();
    expect(toOrbit(w, new Set(), 90000, 2)).toBeNull();
    // A deorbit node that leaves the periapsis well above the corridor: the trim is planned after it.
    const deorbit = w.addNode(w.ut + 600); deorbit.prograde = -8;
    expect(findEntry(w.trajectory(), id => w.universe.body(id))).toBeNull();
    deorbit.prograde = -60;
    const before = findEntry(w.trajectory(), id => w.universe.body(id));
    expect(before).not.toBeNull();
    const snapshot = planningSnapshot(w);
    const events: PlannerEvent[] = [];
    await createPlannerHandler(e => events.push(e), async () => {})({ type: 'plan', id: 1, operation: 'entry', snapshot, args: { dragPerMass: enteringDragPerMass(w.active!.state) } });
    const done = events.find(e => e.type === 'result');
    expect(done && done.type === 'result' && done.result).toBeTruthy();
    const plan = (done as Extract<PlannerEvent, { type: 'result' }>).result as NonNullable<ReturnType<typeof planEntryTrim>>;
    expect(plan.node.time).toBeGreaterThan(deorbit.time);
    applyEntryTrim(w, snapshot, plan);
    expect(w.nodes).toHaveLength(2);
    expect(w.nodes[0].id).toBe(deorbit.id);
    const after = findEntry(w.trajectory(), id => w.universe.body(id))!;
    expect(Math.abs(after.periapsis - plan.after)).toBeLessThan(500);
  }, 240_000);

  it('a Standard free return, trimmed on the way home, lands on its parachute', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + 11 * 86400, 'science');
    w.progression.unlocked.push('propulsion-0', 'energy-0');
    expect(buy(w, buildOrbiter()).problem).toBeNull();
    expect(toOrbit(w, new Set(), 90000, 2)).toBeNull();
    expect(planFreeReturn(w, 'moon')).not.toBeNull();
    w.nodes = [];
    const biomes = new Set<string>();
    expect(freeReturnFlyby(w, biomes, 0)).toBeNull();
    expect(w.active!.body).toBe('earth');
    // Already trimmed by the flyby helper (the planner's Entry trim): a second one is (nearly) free. One-pass capture
    // itself is flown in the cases above.
    const again = entryTrim(w, 0);
    expect(again.err).toBeNull();
    expect(again.plan!.dv).toBeLessThan(0.5);
    expect(deorbitAndRecover(w, biomes)).toBeNull();
  }, 600_000);
});
