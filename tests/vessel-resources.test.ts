import { describe, expect, it } from 'vitest';
import { buildVessel, drawResource, flowGroups, neutralInput, stepVessel, activateNextStage } from '../src/sim/vessel';
import { TEST_CATALOG, stackCraft, vacuumEnv, NOSE_UP } from '../src/sim/vessel/testing';

const env = vacuumEnv();

describe('resource flow', () => {
  it('drains the tank farthest from the root first, then the next', () => {
    const v = buildVessel(stackCraft(['capsule', 'tank', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    const [upper, lower] = v.parts.filter((p) => p.partId === 'tank');
    activateNextStage(v);
    let t = 0;
    for (let i = 0; i < 250; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    expect(lower.resources.liquidFuel!).toBeLessThan(710);
    expect(upper.resources.liquidFuel).toBe(710);
    expect(upper.resources.oxidizer).toBe(1290);
    for (let i = 0; i < 3000 && (lower.resources.liquidFuel ?? 0) > 0; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    expect(lower.resources.liquidFuel).toBe(0);
    for (let i = 0; i < 100; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    expect(upper.resources.liquidFuel!).toBeLessThan(710);
  });

  it('respects the mixture ratio', () => {
    const v = buildVessel(stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    const tank = v.parts.find((p) => p.partId === 'tank')!;
    activateNextStage(v);
    let t = 0;
    for (let i = 0; i < 300; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 0.7 }), env, t);
    const dLf = 710 - tank.resources.liquidFuel!;
    const dOx = 1290 - tank.resources.oxidizer!;
    expect(dLf).toBeGreaterThan(0);
    expect(dOx / dLf).toBeCloseTo(0.645 / 0.355, 9);
  });

  it('decouplers block crossfeed; engine flames out when its stage runs dry', () => {
    const v = buildVessel(
      stackCraft(['capsule', 'tank', { partId: 'decoupler', stage: 0 }, 'tank-small', { partId: 'engine', stage: 1 }]),
      TEST_CATALOG,
      { orientation: NOSE_UP },
    );
    const eng = v.parts.find((p) => p.partId === 'engine')!;
    const upper = v.parts.find((p) => p.partId === 'tank')!;
    const groups = flowGroups(v, eng.uid, 'liquidFuel').flat();
    expect(groups).not.toContain(upper.uid);
    activateNextStage(v);
    let t = 0;
    for (let i = 0; i < 2000 && !eng.engine!.flamedOut; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    expect(eng.engine!.flamedOut).toBe(true);
    expect(upper.resources.liquidFuel).toBe(710);
    expect(upper.resources.oxidizer).toBe(1290);
  });

  it('flames out when any single propellant is exhausted', () => {
    const craft = stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]);
    craft.parts[1].resources = { liquidFuel: 710, oxidizer: 20 };
    const v = buildVessel(craft, TEST_CATALOG, { orientation: NOSE_UP });
    const eng = v.parts.find((p) => p.engine)!;
    activateNextStage(v);
    let t = 0;
    for (let i = 0; i < 200 && !eng.engine!.flamedOut; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    expect(eng.engine!.flamedOut).toBe(true);
    expect(v.parts[1].resources.oxidizer).toBe(0);
    expect(v.parts[1].resources.liquidFuel!).toBeGreaterThan(690);
  });

  it("'all' resources draw evenly from everywhere, 'none' only from own part", () => {
    const v = buildVessel(stackCraft(['capsule', 'probe', { partId: 'srb', stage: 0 }]), TEST_CATALOG);
    const [cap, probe, srb] = v.parts;
    // EC: capsule 100, probe 1000 -> proportional draw
    drawResource(v, cap.uid, 'electricCharge', 110);
    expect(cap.resources.electricCharge).toBeCloseTo(90, 9);
    expect(probe.resources.electricCharge).toBeCloseTo(900, 9);
    expect(flowGroups(v, srb.uid, 'solidFuel')).toEqual([[srb.uid]]);
    expect(drawResource(v, cap.uid, 'solidFuel', 10)).toBe(0);
  });
});
