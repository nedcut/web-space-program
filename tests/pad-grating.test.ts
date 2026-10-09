import { describe, it, expect } from 'vitest';
import { padGrating, GRATING_PITCH } from '../src/render/site/padGrating';
import { LAUNCH_PAD_PIT } from '../src/sim/terrain';

const H = LAUNCH_PAD_PIT.half, END = LAUNCH_PAD_PIT.trenchEnd;
/** The deck covers the trench from the hole's north edge to its own edge (21 m) and the lintel beyond it. */
const OPEN_START = -21 - 0.7;

describe('launch pad flame pit grating', () => {
  const boxes = padGrating(H, OPEN_START, END);
  const bars = boxes.filter(b => b.y1 > -0.05);

  it('covers the whole open hole and trench with bars flush with the (flat) collision ground', () => {
    for (const b of bars) expect(b.y1).toBeGreaterThan(-0.01);
    for (const b of bars) expect(b.y1).toBeLessThanOrEqual(0);
    const covered = (x: number, z: number) => bars.some(b => Math.abs(x - b.x) <= GRATING_PITCH / 2 + 1e-9 && Math.abs(z - b.z) <= b.d / 2 + 1e-9);
    for (let x = -H + 0.01; x < H; x += 0.13) {
      for (let z = -H + 0.01; z < H; z += 0.37) expect(covered(x, z)).toBe(true);
      for (let z = OPEN_START; z > END; z -= 0.37) expect(covered(x, z)).toBe(true);
    }
  });

  it('leaves gaps to see the trench through, and stays inside the pit walls', () => {
    for (const b of boxes) expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(H);
    const xs = [...new Set(bars.map(b => b.x))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(GRATING_PITCH, 9);
    expect(bars[0].w / GRATING_PITCH).toBeLessThan(0.25);
  });
});
