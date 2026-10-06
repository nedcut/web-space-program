import { expect, it } from 'vitest';
import { admitVoice, atmosphereColor, engineTransition, flightRumble, musicDuck } from '../src/audio/design';

it('ducks music monotonically while retaining a quiet bed', () => {
  expect(musicDuck(0, 0, 0)).toBe(1);
  expect(musicDuck(1, 0, 0)).toBeCloseTo(0.22);
  expect(musicDuck(0, 40000, 0)).toBeCloseTo(0.22);
  expect(musicDuck(0, 0, 1)).toBeCloseTo(0.22);
  expect(musicDuck(NaN, Infinity, -1)).toBe(1);
});
it('makes dense Titan airflow lower and Mars airflow brighter', () => {
  expect(atmosphereColor('titan')).toBeLessThan(atmosphereColor('earth'));
  expect(atmosphereColor('mars')).toBeGreaterThan(atmosphereColor('earth'));
});
it('shares bounded launch/max-Q vibration with the camera', () => {
  expect(flightRumble(0, 1, 0, 0, 0)).toBe(0);
  expect(flightRumble(1000, 100, 0, 0, 0)).toBeCloseTo(0.7);
  expect(flightRumble(1000, 100, 1000, 0, 0)).toBeLessThan(0.02);
  expect(flightRumble(0, 1, 0, 40000, 1)).toBeGreaterThan(flightRumble(0, 1, 0, 40000, 2));
  for (const v of [NaN, Infinity, -1, 0, 1e9]) expect(flightRumble(v, v, v, v, v)).toBeLessThanOrEqual(0.8);
});
it('reserves node headroom and identifies engine transitions without throttle chatter', () => {
  expect(admitVoice(208, 3)).toBe(false);
  expect(admitVoice(208, 2)).toBe(true);
  expect(admitVoice(232, 2, true)).toBe(true);
  expect(admitVoice(233, 2, true)).toBe(false);
  expect(engineTransition(0, 0.1)).toBe('ignite');
  expect(engineTransition(0.1, 0)).toBe('shutdown');
  expect(engineTransition(0.1, 0.5)).toBe(null);
});
