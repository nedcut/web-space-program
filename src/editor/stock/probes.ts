import { PART_CATALOG } from '../../data/parts';
import type { CraftDef } from '../../sim/vessel/types';
import type { PartCatalog } from '../core';
import type { ScalePresetId } from '../../sim/bodies/scale';
import { Builder, type StockCraft } from '../stockCrafts';

/**
 * Petrel Planetary Probe: the career's first ride to Venus and Mars on every scale. The Tern's probe bus (Pebble core,
 * Gyre 0 wheel, Wisp kick stage that stays aboard for corrections and capture) with an Arcwatch dish instead of the
 * Thread aerial, whose 2 Gm link reaches the Moon but not the planets. Launchers are the scale's Meridian stacks.
 * Research: the scale's orbiter, Remote Navigation and Long Range Telemetry (Standard 200, Challenging/Real 450).
 */
export function buildPetrel(preset: ScalePresetId, catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Petrel Planetary Probe',
    'Uncrewed probe for Venus and Mars. The launcher reaches orbit and makes the departure burn; the probe\'s own kick stage trims the cruise and captures. Its Arcwatch dish keeps Earth in touch across the inner planets.');
  const real = preset === 'real';
  const core = b.root('probe-pebble');
  const wheel = b.stack(core, 'wheel-gyre-0');
  // Real: a second kick tank and a longer upper stage (+0.8 km/s past orbit) pay for a Mars capture into a long ellipse.
  const kick = real ? b.stack(b.stack(wheel, 'tank-0-long'), 'tank-0-long') : b.stack(wheel, 'tank-0-long');
  b.radial(core, 'battery-brick', 1, 0, 0);
  b.radial(core, 'antenna-arc', 1, 0, 180);
  b.radial(core, 'sensor-thermal', 1, 0, 90);
  b.radial(kick, 'solar-fold', 2, 0.1, 45);
  const wisp = b.stack(kick, 'eng-wisp');
  const sep = b.stack(wisp, 'dec-0');
  const adapter = b.stack(sep, 'adapt-0-1');
  const upper = real ? b.stack(b.stack(adapter, 'tank-1-long'), 'tank-1-mid') : b.stack(adapter, 'tank-1-long');
  const engine = b.stack(upper, 'eng-zephyr');
  const sep1 = b.stack(engine, 'dec-1');
  if (preset === 'standard') {
    const t1 = b.stack(sep1, 'tank-1-long');
    const t2 = b.stack(t1, 'tank-1-long');
    b.stack(t2, 'eng-sirocco');
    b.radial(t2, 'fin-keel', 4, -0.95, 45);
    return b.done();
  }
  const wide1 = b.stack(sep1, 'adapt-1-2');
  const middle = b.stack(wide1, real ? 'tank-2-long' : 'tank-2-mid');
  const sustainer = b.stack(middle, 'eng-harmattan');
  const sep2 = b.stack(sustainer, 'dec-2');
  const wide2 = b.stack(sep2, 'adapt-2-3');
  const booster = b.stack(wide2, real ? 'tank-3-long' : 'tank-3-mid');
  b.stack(real ? b.stack(booster, 'tank-3-long') : booster, 'eng-tempest');
  return b.done();
}

/** Picker entries, registered in STOCK_CRAFTS. */
export function probeStock(): StockCraft[] {
  const tags = ['antenna-arc', 'probe-pebble', 'eng-wisp', 'wheel-gyre-0'];
  const tip = 'Plan the transfer in the map\'s Maneuver planner during a ground station pass, keep the kick stage for the cruise trims, and capture into a long ellipse if Δv is short.';
  return ([['standard', ''], ['challenging', '-challenging'], ['real', '-real']] as const).map(([scale, suffix]) => ({
    scale, id: `stock-petrel${suffix}`, name: 'Petrel Planetary Probe', needsResearch: true, category: 'worlds' as const,
    blurb: `${scale === 'standard' ? 'Venus and Mars' : `${scale[0].toUpperCase()}${scale.slice(1)} scale · Venus and Mars`} probe · long-range dish · research required`,
    tags, tip: scale === 'real' ? `${tip} At Mars the dish only just reaches Earth: survey soon after arrival.` : tip,
    build: () => buildPetrel(scale),
  }));
}
