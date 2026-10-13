import { describe, expect, it } from 'vitest';
import { SHADER_TIME_PERIOD, WAVE_RATE_CAP, WaveClock, loopingSpeed, shaderTime } from '../src/render/planet/uniforms';

describe('shaderTime', () => {
  it('keeps the shader clock float32-precise at real UT', () => {
    const ut = 964051207.2233331; // 2030, seconds since J2000: a 64 s float32 step unwrapped
    const a = shaderTime(ut), b = shaderTime(ut + 0.016);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(SHADER_TIME_PERIOD);
    // One 60 Hz frame still advances the float32 uniform (and wave drift 2·t by well under a centimetre per ulp).
    expect(Math.fround(b) - Math.fround(a)).toBeCloseTo(0.016, 2);
    expect(Math.fround(2 * a + 1000) - (2 * a + 1000)).toBeLessThan(0.02);
  });

  it('wraps negative times into range and is seamless for the effect cycles', () => {
    expect(shaderTime(-1)).toBeCloseTo(SHADER_TIME_PERIOD - 1, 9);
    expect(SHADER_TIME_PERIOD % 4000).toBe(0);
    expect(SHADER_TIME_PERIOD % 12500).toBe(0);
  });
});

describe('loopingSpeed', () => {
  it('moves a tile by whole repeats per clock period, within 0.1 % of the requested speed', () => {
    for (const [speed, tile] of [[1.3, 64], [0.7, 64], [0.9, 23], [1.6, 23], [2.0, 512], [1.1, 512], [9.0, 2 * Math.PI]]) {
      const v = loopingSpeed(speed, tile);
      const repeats = (v * SHADER_TIME_PERIOD) / tile;
      expect(Math.abs(repeats - Math.round(repeats))).toBeLessThan(1e-6);
      expect(Math.abs(v / speed - 1)).toBeLessThan(1e-3);
    }
  });

  it('keeps the ocean pattern identical across the wrap (as the shader computes it)', () => {
    const tile = 64, v = Number(loopingSpeed(1.3, tile).toFixed(7)); // the literal baked into the shader
    const phase = (t: number) => { const x = (t * v) / tile; return x - Math.floor(x); };
    const before = SHADER_TIME_PERIOD - 1 / 120, after = shaderTime(SHADER_TIME_PERIOD + 1 / 120);
    // One 60 Hz frame across the wrap moves the pattern as little as any other frame (fraction of a tile).
    const step = Math.abs(phase(after) - phase(before));
    expect(Math.min(step, 1 - step)).toBeLessThan(1e-3);
  });
});

describe('WaveClock', () => {
  const ut0 = 8.1e8 + 0.25;
  it('is exactly shaderTime(UT) at and below the cap', () => {
    const clock = new WaveClock(), dt = 1 / 128; // exact steps: UT rounding never reads as over the cap
    for (let i = 0, ut = ut0; i < 2000; i++, ut += (1 + (i % 4)) * dt) expect(clock.update(ut, dt)).toBe(shaderTime(ut));
  });
  it('advances at most WAVE_RATE_CAP× real time under warp and wraps float32-safely', () => {
    const clock = new WaveClock(), dt = 1 / 60;
    let prev = clock.update(ut0, dt);
    for (let i = 1; i < 1e5; i++) {
      const t = clock.update(ut0 + i * 10000 * dt, dt);
      let step = t - prev;
      if (step < 0) step += SHADER_TIME_PERIOD;
      expect(step).toBeCloseTo(WAVE_RATE_CAP * dt, 6);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(SHADER_TIME_PERIOD);
      prev = t;
    }
  });
  it('limits backward jumps (reverts) the same way', () => {
    const clock = new WaveClock(), dt = 1 / 60;
    const a = clock.update(ut0, dt), b = clock.update(ut0 - 3600, dt);
    expect(b - a).toBeCloseTo(-WAVE_RATE_CAP * dt, 6);
  });
});
