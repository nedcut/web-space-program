import { describe, expect, it } from 'vitest';
import { ballisticImpact, targetPlaneNodes, phaseAngle, suicideBurn, stateToElements, period, propagate, type Orbit } from '../src/sim/orbit';
import { dot, length, v3 } from '../src/util/vec3';

const circular: Orbit = { body: 'test', mu: 1e6, a: 1000, e: 0, i: Math.PI / 4, lan: 0, argPe: 0, m0: Math.PI / 4, epoch: 0 };
describe('pilot readout calculations', () => {
  it('finds ballistic contact and surface-relative impact speed', () => {
    const mu = 3.986e14, radius = 6.371e6;
    const o = stateToElements(mu, 'test', v3(radius + 1000, 0, 0), v3(-100, 1, 0), 0);
    const hit = ballisticImpact(o, 0, p => length(p) - radius, () => v3(0, 1, 0), 200);
    expect(hit).not.toBeNull();
    expect(hit!.time).toBeGreaterThan(5);
    expect(hit!.time).toBeLessThan(10);
    expect(length(hit!.position)).toBeCloseTo(radius, 3);
    expect(hit!.speed).toBeGreaterThan(100);
    const analytic = Math.sqrt(100 ** 2 + 2 * mu * (1 / radius - 1 / (radius + 1000)));
    expect(hit!.speed).toBeCloseTo(analytic, 1);
  });
  it('samples future terrain rather than using current radar altitude', () => {
    const o = { ...circular, i: 0 };
    const hit = ballisticImpact(o, 0, (p, t) => length(p) - (t > 20 ? 1001 : 990), undefined, 50);
    expect(hit!.time).toBeCloseTo(20, 5);
    expect(ballisticImpact(o, 0, p => length(p) - 900, undefined, period(o))).toBeNull();
  });
  it('reports immediate contact and respects a finite prediction horizon', () => {
    expect(ballisticImpact(circular, 0, () => -1)?.time).toBe(0);
    expect(ballisticImpact(circular, 0, () => 1, undefined, 5)).toBeNull();
  });
  it('solves suicide burn coast and braking distances including gravity', () => {
    const s = suicideBurn(1000, -100, 10, 30)!;
    expect(s.startAltitude).toBe(250);
    const coast = 100 * s.countdown + 5 * s.countdown ** 2;
    const speed = 100 + 10 * s.countdown;
    expect(coast + speed ** 2 / 40).toBeCloseTo(1000, 8);
    expect(s.burnTime).toBeCloseTo(speed / 20, 8);
    expect(suicideBurn(100, -100, 10, 30)?.overdue).toBe(true);
    expect(suicideBurn(1000, -100, 10, 10)).toBeNull();
    expect(suicideBurn(1000, 10, 10, 30)).toBeNull();
  });
  it('finds AN/DN with the correct direction and future time', () => {
    const nodes = targetPlaneNodes(circular, v3(0, 0, 1), 0);
    expect(nodes.map(n => n.kind)).toEqual(['DN', 'AN']);
    for (const n of nodes) {
      expect(n.time).toBeGreaterThan(0);
      expect(Math.abs(n.position.z)).toBeLessThan(1e-7);
      expect(Math.sign(dot(propagate(circular, n.time).velocity, v3(0, 0, 1)))).toBe(n.kind === 'AN' ? 1 : -1);
    }
    expect(nodes[1].time - nodes[0].time).toBeCloseTo(period(circular) / 2, 6);
    expect(targetPlaneNodes({ ...circular, i: 0 }, v3(0, 0, 1), 0)).toEqual([]);
    expect(targetPlaneNodes({ ...circular, e: 1.2, a: -1000 }, v3(0, 0, 1), 0)).toEqual([]);
  });
  it('computes signed phase in the reference plane and handles degeneracy', () => {
    expect(phaseAngle(v3(1, 0, 0), v3(0, 1, 20), v3(0, 0, 1))).toBeCloseTo(Math.PI / 2);
    expect(phaseAngle(v3(1, 0, 0), v3(0, -1, 0), v3(0, 0, 1))).toBeCloseTo(-Math.PI / 2);
    expect(phaseAngle(v3(1, 0, 0), v3(1, 0, 0), v3(0, 0, 1))).toBe(0);
    expect(phaseAngle(v3(), v3(1, 0, 0), v3(0, 0, 1))).toBeNull();
    expect(phaseAngle(v3(1, 0, 0), v3(0, 1, 0), v3())).toBeNull();
  });
});
