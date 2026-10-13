import { describe, expect, it } from 'vitest';
import { budgetStages, dvText, shortCountdown, shortDate, shortDuration } from '../src/flight/hud/plannerFormat';
import { liveOptions } from '../src/flight/hud/DepartureOptions';
import type { StageDeltaV } from '../src/sim/vessel/staging';
import type { TransferWindow } from '../src/game/planning/windows';

describe('planner chips', () => {
  it('keeps the two most significant units', () => {
    expect(shortDuration(52.04)).toBe('52.0s');
    expect(shortDuration(60)).toBe('1m 0s');
    expect(shortDuration(22 * 60 + 37.9)).toBe('22m 37s');
    expect(shortDuration(86 * 86400 + 7 * 3600 + 49 * 60)).toBe('86d 7h');
    expect(shortDuration(3600 * 5)).toBe('5h 0m');
    expect(shortDuration(400 * 86400)).toBe('1y 34d');
    expect(shortDuration(-90)).toBe('−1m 30s');
    expect(shortDuration(Infinity)).toBe('—');
  });
  it('counts down and up', () => {
    expect(shortCountdown(125)).toBe('T−2m 5s');
    expect(shortCountdown(-5)).toBe('T+5.0s');
  });
  it('formats Δv and dates compactly', () => {
    expect(dvText(907.4)).toBe('907 m/s');
    expect(dvText(NaN)).toBe('—');
    expect(shortDate(0)).toBe('2000-01-01');
  });
  it('orders budget stages by firing order and drops empty ones', () => {
    const s = (stage: number, dvVac: number) => ({ stage, dvVac }) as StageDeltaV;
    expect(budgetStages([s(1, 900), s(3, 0), s(2, 1200)])).toEqual([{ stage: 2, dv: 1200 }, { stage: 1, dv: 900 }]);
  });
});

describe('departure options', () => {
  const w = (departure: number, dv: number, kind: 'now' | 'window', captureDv?: number) =>
    ({ departure, wait: 0, dv, captureDv, timeOfFlight: 1, kind, seed: [0, 0, 0] }) as TransferWindow;
  it('lists go-now first, then by departure + capture, and drops past departures', () => {
    const { live, best } = liveOptions([w(5000, 900, 'window', 300), w(50, 100, 'window'), w(3000, 1000, 'now', 300), w(4000, 950, 'window', 100)], 0);
    expect(live.map(x => x.departure)).toEqual([3000, 4000, 5000]);
    expect(best?.departure).toBe(4000);
  });
});
