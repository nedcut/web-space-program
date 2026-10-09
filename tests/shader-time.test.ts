import { describe, expect, it } from 'vitest';
import { SHADER_TIME_PERIOD, shaderTime } from '../src/render/planet/uniforms';

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
