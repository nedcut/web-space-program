import type { BodyDef } from '../bodies/types';
import type { RGB, Terrain } from './api';
import { makeContext, type PresetContext, type PresetResult } from './presets/common';
import { earthPreset } from './presets/earth';
import { lunarPreset, mercuryPreset, icyPreset, rockyPreset, enceladusPreset } from './presets/cratered';
import { marsPreset, venusPreset, titanPreset } from './presets/planetary';
import { ioPreset, europaPreset } from './presets/moons';

export type { Terrain, TerrainHeightFn, RGB } from './api';
export { LAUNCH_SITE, RUNWAY, siteLocalToUnit } from './presets/earth';
export { latLonToUnit, unitToLatLon } from './geo';

export interface CreateTerrainOptions {
  /** Smallest procedural wavelength in meters (default 6). Lower = more detail, slower queries. */
  minWavelength?: number;
}

const PRESETS: Record<string, (ctx: PresetContext) => PresetResult> = {
  earth: earthPreset,
  lunar: lunarPreset,
  mercury: mercuryPreset,
  venus: venusPreset,
  mars: marsPreset,
  icy: icyPreset,
  enceladus: enceladusPreset,
  titan: titanPreset,
  io: ioPreset,
  volcanic: ioPreset,
  europa: europaPreset,
  rocky: rockyPreset,
};

/** Presets with no solid surface: height is identically 0. */
const FLAT_PRESETS = new Set(['star', 'gasGiant', 'iceGiant']);

/**
 * Build the deterministic terrain for a (scaled) body definition. Same input → bit-identical output on
 * every platform (pure float64 math, seeded from `surface.seed`).
 */
export function createTerrain(body: BodyDef, opts: CreateTerrainOptions = {}): Terrain {
  const preset = body.surface?.preset ?? 'rocky';
  const ctx = makeContext(body, opts.minWavelength ?? 6);
  const fallbackColor = ctx.pal(0, [0.5, 0.5, 0.5]);
  if (FLAT_PRESETS.has(preset) || !body.solidSurface || ctx.relief <= 0) {
    return {
      heightAt: () => 0,
      maxHeight: 0,
      minHeight: 0,
      ocean: !!body.surface?.ocean,
      colorAt: (_x, _y, _z, _h, out: RGB) => {
        out[0] = fallbackColor[0]; out[1] = fallbackColor[1]; out[2] = fallbackColor[2];
        return out;
      },
    };
  }
  const make = PRESETS[preset] ?? rockyPreset;
  const p = make(ctx);
  const lo = p.minHeight;
  const hi = p.maxHeight;
  const raw = p.height;
  return {
    heightAt: (x, y, z) => {
      const h = raw(x, y, z);
      return h < lo ? lo : h > hi ? hi : h;
    },
    maxHeight: hi,
    minHeight: lo,
    ocean: !!body.surface?.ocean,
    colorAt: p.colorAt,
  };
}
