import { describe, expect, it } from 'vitest';
import { adaptiveSamples, sampleConic, soiExitTime } from '../src/render/map/conicSampling';
import { elementsToState, period, type Orbit } from '../src/sim/orbit';
import type { Vec3 } from '../src/util/vec3';

const MU = 3.986e14;
const maxTurn = (pts: Vec3[]) => {
  let worst = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1], m = pts[i], b = pts[i + 1];
    const u = [m.x - a.x, m.y - a.y, m.z - a.z], v = [b.x - m.x, b.y - m.y, b.z - m.z];
    const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
    worst = Math.max(worst, Math.acos(Math.min(1, c)));
  }
  return worst;
};

describe('adaptive conic sampling', () => {
  it('keeps an eccentric ellipse smooth around periapsis without uniform-time chords', () => {
    const o: Orbit = { body: 'earth', mu: MU, a: 4e7, e: 0.97, i: 0.2, lan: 0, argPe: 1, m0: 0, epoch: 0 };
    const pts = sampleConic(o, Infinity, 0, null);
    expect(maxTurn(pts)).toBeLessThan(3 * Math.PI / 180);
    // Uniform time sampling with the same count would turn tens of degrees per vertex at periapsis.
    const uniform = Array.from({ length: pts.length }, (_, k) => elementsToState(o, period(o) * k / (pts.length - 1)).position);
    expect(maxTurn(uniform)).toBeGreaterThan(10 * Math.PI / 180);
  });
  it('clips hyperbolic legs at the sphere of influence', () => {
    const o: Orbit = { body: 'earth', mu: MU, a: -2e7, e: 1.4, i: 0, lan: 0, argPe: 0, m0: -3, epoch: 0 };
    const soi = 9e8, exit = soiExitTime(o, soi, 0);
    expect(Number.isFinite(exit)).toBe(true);
    const pts = sampleConic(o, soi, 0, null);
    for (const p of pts) expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(soi * 1.001);
    expect(maxTurn(pts)).toBeLessThan(3 * Math.PI / 180);
  });
  it('respects the point budget', () => {
    const pts = adaptiveSamples(t => ({ x: Math.cos(t * 50), y: Math.sin(t * 50), z: 0 }), 0, 100, { initial: 10, maxPoints: 200 });
    expect(pts.length).toBeLessThanOrEqual(200);
  });
});
