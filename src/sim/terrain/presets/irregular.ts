import type { PresetContext, PresetResult } from './common';

/** Star-shaped radial surfaces: lobes are a smooth neck approximation, not a surveyed mesh. */
export function irregularPreset(ctx: PresetContext): PresetResult {
  const { radius: r, body, relief } = ctx;
  const noise = ctx.noise(1);
  return {
    minHeight: -0.65 * r,
    maxHeight: 0.9 * r,
    height(x, y, z) {
      let radial: number;
      switch (body.surface.shape) {
        case 'top': radial = 1.08 - 0.22 * Math.abs(z) + 0.035 * (x * x - y * y); break;
        case 'bilobed': radial = 0.62 + 0.92 * x * x + 0.12 * x - 0.06 * z * z; break;
        case 'elongated': radial = 1 / Math.sqrt(x * x / 3.1 + y * y / 0.65 + z * z / 0.50); break;
        default: radial = 1 / Math.sqrt(x * x / 1.12 + y * y / 1.02 + z * z / 0.88);
      }
      const roughness = Math.min(relief, r * 0.025) * noise.noise(x * 12, y * 12, z * 12);
      return r * (radial - 1) + roughness;
    },
  };
}
