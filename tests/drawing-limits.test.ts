import { expect, it } from 'vitest';
import { clampPixelRatio } from '../src/render/core/drawingLimits';

it('keeps drawing buffers within the context limit', () => {
  expect(clampPixelRatio(2, 1280, 800, 16384)).toBe(2);
  // Firefox resistFingerprinting: devicePixelRatio 2 with WebGL 2's 2048-px minimum renderbuffer.
  expect(clampPixelRatio(2, 1280, 800, 2048)).toBeCloseTo(1.6);
  expect(1280 * clampPixelRatio(2, 1280, 800, 2048)).toBeLessThanOrEqual(2048);
  expect(clampPixelRatio(1, 0, 0, 2048)).toBe(1);
  expect(clampPixelRatio(2, 3008, 1692, 4096)).toBeCloseTo(4096 / 3008);
});
