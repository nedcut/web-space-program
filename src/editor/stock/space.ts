import { PART_CATALOG } from '../../data/parts';
import type { CraftDef } from '../../sim/vessel/types';
import { removeEmptyStages, type PartCatalog } from '../core';
import type { ScalePresetId } from '../../sim/bodies/scale';
import { Builder, type StockCraft } from '../stockCrafts';

/*
 * Launchers, spacecraft and landers added by the 2026-10 stock fleet wave. Each design shows off hardware that no
 * earlier stock craft used. Builders are function declarations so the import cycle with `stockCrafts.ts` (which
 * registers them in STOCK_CRAFTS) resolves either way round.
 */

/**
 * Finish a design, firing every part listed in `moves` with `anchor`'s stage (the depth stager fires parts on side
 * latches a stage before the core they hang from), then drop the stages that empties.
 */
function finish(b: Builder, moves: [partId: string, anchor: number][] = []): CraftDef {
  const craft = b.done();
  for (const [partId, anchor] of moves) {
    const stage = craft.parts.find(p => p.uid === anchor)!.stage;
    for (const p of craft.parts) if (p.partId === partId) p.stage = stage;
  }
  return moves.length ? removeEmptyStages(craft) : craft;
}

/** Uncrewed first satellite: a Pebble science sat with a solid kick motor in a clamshell fairing, methalox upper stage, solid strap-ons. */
export function buildCricket(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Cricket Satellite Launcher',
    'A first satellite in a clamshell fairing. Four solid motors and a Sirocco core loft it, the Mistral methalox stage reaches orbit and the satellite\'s own Candle kick motor sends it on to the Moon.');
  const sat = b.root('probe-pebble');
  const bus = b.stack(sat, 'tank-0-short');
  b.radial(bus, 'solar-patch', 4, 0, 45);
  b.radial(bus, 'sensor-pressure', 1, 0, 0);
  b.radial(sat, 'antenna-thread', 1, 0, 180);
  const kickMotor = b.stack(bus, 'srb-candle');
  const mount = b.stack(kickMotor, 'adapt-0-1');
  const release = b.stack(mount, 'dec-1');
  const fairing = b.stack(release, 'fairing-1');
  const upper = b.stack(fairing, 'tank-1-short');
  const kick = b.stack(upper, 'eng-mistral');
  const sep = b.stack(kick, 'dec-1');
  const coreTop = b.stack(sep, 'tank-1-mid');
  const core = b.stack(coreTop, 'tank-1-mid');
  b.stack(core, 'eng-sirocco');
  b.radial(core, 'fin-keel', 4, -0.4, 0);
  const latch = b.radial(core, 'dec-radial', 4, 0, 45);
  const motor = b.outward(latch, 'srb-sparkler');
  return finish(b, [['eng-sirocco', motor]]);
}

/** Reusable vertical-landing test article: methalox hops on four long legs, floodlights for night flying. */
export function buildHopscotch(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Hopscotch Landing Demonstrator',
    'Single-stage hopper: climb a kilometre on the deep-throttling Boreal methalox engine, drift sideways and land upright on four Colossus legs.');
  const core = b.root('probe-cairn');
  b.stack(core, 'nose-1', 'top');
  b.radial(core, 'light-beacon', 2, 0, 0);
  const upper = b.stack(core, 'tank-1-long');
  b.radial(upper, 'antenna-thread', 1, 1.2, 90);
  const lower = b.stack(upper, 'tank-1-mid');
  b.radial(lower, 'leg-colossus', 4, -0.2, 45);
  b.radial(lower, 'light-area', 4, -0.55, 0);
  b.stack(lower, 'eng-boreal');
  return finish(b);
}

/** Ion explorer: a xenon truss with four sun-tracking wings in a fairing, on a two-stage kerolox launcher. */
export function buildLodestar(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Lodestar Ion Explorer',
    'Xenon ion probe in a clamshell fairing. The launcher reaches orbit; then the Whisper drive pushes gently for hours on solar power. Patient pilots reach the Moon, Mars or the asteroids on one tank.');
  const core = b.root('probe-cairn');
  b.radial(core, 'antenna-arc', 1, 0, 0);
  b.radial(core, 'sensor-magnetic', 1, 0, 180);
  const truss = b.stack(core, 'truss-octagonal');
  b.radial(truss, 'solar-wing', 4, 0.5, 45);
  b.radial(truss, 'xenon-bottle', 4, -0.45, 0);
  const drive = b.stack(truss, 'eng-whisper');
  // Full-width shroud on a 2.5 m stack: a bulbous fairing over a narrow upper stage flips at Mach 1.
  const mount = b.stack(drive, 'adapt-0-2');
  const release = b.stack(mount, 'dec-2');
  const fairing = b.stack(release, 'fairing-2');
  const upper = b.stack(fairing, 'tank-2-short');
  const narrow = b.stack(upper, 'adapt-1-2', 'bottom', 'bottom');
  const engine = b.stack(narrow, 'eng-zephyr', 'top', 'top');
  const sep = b.stack(engine, 'dec-1');
  const adapter = b.stack(sep, 'adapt-1-2');
  const booster = b.stack(adapter, 'tank-2-long');
  b.stack(booster, 'eng-chinook');
  b.radial(booster, 'fin-pivot', 4, -2.6, 45);
  return finish(b);
}

/** Picker entries, registered in STOCK_CRAFTS. A function so the import cycle with stockCrafts.ts is harmless. */
export function spaceStock(): StockCraft[] {
  const hop = (scale: ScalePresetId, suffix = '') => ({ scale, id: `stock-hopscotch${suffix}`, name: 'Hopscotch Landing Demonstrator',
    blurb: 'Vertical take-off and landing hopper · research required', needsResearch: true, build: () => buildHopscotch() });
  return [
    { scale: 'standard', id: 'stock-cricket', name: 'Cricket Satellite Launcher', needsResearch: true, build: () => buildCricket(),
      blurb: 'Uncrewed first satellite · fairing, solid strap-ons, kick motor · research required' },
    { scale: 'standard', id: 'stock-lodestar', name: 'Lodestar Ion Explorer', needsResearch: true, build: () => buildLodestar(),
      blurb: 'Xenon ion probe · 10 km/s of patient thrust · research required' },
    hop('standard'), hop('challenging', '-challenging'), hop('real', '-real'),
  ];
}
