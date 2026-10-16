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
 * Finish a design, firing the listed parts (and their symmetry counterparts) with `anchor`'s stage, then drop the
 * stages that empties. The depth stager fires parts on side latches a stage before the core they hang from.
 */
function finish(b: Builder, moves: [parts: number[], anchor: number][] = []): CraftDef {
  const craft = b.done();
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  for (const [uids, anchor] of moves) {
    const groups = new Set(uids.map(uid => byUid.get(uid)!.symmetryGroup).filter(g => g !== undefined));
    for (const p of craft.parts) if (uids.includes(p.uid) || (p.symmetryGroup !== undefined && groups.has(p.symmetryGroup))) p.stage = byUid.get(anchor)!.stage;
  }
  return moves.length ? removeEmptyStages(craft) : craft;
}

/** Uncrewed first satellite: a Pebble science sat with a solid kick motor in a clamshell fairing, methalox upper stage, solid strap-ons. */
export function buildPipit(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Pipit Satellite Launcher',
    'A first satellite in a clamshell fairing. Four solid motors and a Sirocco core loft it, the Mistral methalox stage reaches orbit and the satellite\'s own Candle kick motor sends it on to the Moon.');
  const sat = b.root('probe-pebble');
  // A dry Thimble tank is the satellite bus: no engine draws from it, so it carries no propellant.
  const bus = b.stack(sat, 'tank-0-short');
  b.resources.set(bus, { liquidFuel: 0, oxidizer: 0 });
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
  const sirocco = b.stack(core, 'eng-sirocco');
  b.radial(core, 'fin-keel', 4, -0.4, 0);
  const latch = b.radial(core, 'dec-radial', 4, 0, 45);
  const motor = b.outward(latch, 'srb-sparkler');
  b.stack(motor, 'nose-0', 'top');
  return finish(b, [[[sirocco], motor]]);
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
  // The engine skirt fills the 2.5 m gap to the booster ring: one smooth barrel.
  const engine = b.stack(upper, 'eng-zephyr');
  const sep = b.stack(engine, 'dec-2');
  const booster = b.stack(sep, 'tank-2-long');
  b.stack(booster, 'eng-chinook');
  b.radial(booster, 'fin-pivot', 4, -2.6, 45);
  return finish(b);
}

/**
 * Challenging-scale Mars orbiter: Bastion avionics with mapping instruments on a methalox stack. Four Boreal engines on
 * a quad coupler and four tall solids lift it; a Boreal transfer stage throws it to Mars.
 */
export function buildDuskwing(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Duskwing Mars Orbiter',
    'Challenging scale: a mapping orbiter for Mars. Four Boreal engines and four Reed solids lift it; the transfer stage leaves Earth; the orbiter captures with a short burn and lowers its orbit by grazing the thin Martian air.');
  const core = b.root('probe-vault');
  b.radial(core, 'antenna-arc', 1, 0, 0);
  b.radial(core, 'scanner-meridian', 1, 0, 180);
  const tank = b.stack(core, 'tank-1-mid');
  b.radial(tank, 'solar-wing', 2, 0.3, 90);
  b.radial(tank, 'sensor-gravity', 1, -0.3, 0);
  b.radial(tank, 'sensor-magnetic', 1, -0.3, 180);
  const engine = b.stack(tank, 'eng-mistral');
  const mount = b.stack(engine, 'adapt-0-2');
  const release = b.stack(mount, 'dec-2');
  const fairing = b.stack(release, 'fairing-2');
  const transfer = b.stack(fairing, 'tank-2-mid');
  const transferEngine = b.stack(transfer, 'eng-boreal');
  const sep = b.stack(transferEngine, 'dec-2');
  const coreTop = b.stack(sep, 'tank-2-long');
  const coreBottom = b.stack(coreTop, 'tank-2-long');
  const quad = b.stack(coreBottom, 'coupler-2-x4');
  const cluster = ['bottom', 'bottom2', 'bottom3', 'bottom4'].map(node => b.stack(quad, 'eng-boreal', node, 'top'));
  b.radial(coreBottom, 'fin-pivot', 4, -2.6, 0);
  const latch = b.radial(coreBottom, 'dec-radial', 4, 0.6, 45);
  const booster = b.outward(latch, 'srb-reed');
  b.stack(booster, 'nose-1', 'top');
  return finish(b, [[cluster, booster]]);
}

/**
 * Real-scale station power module: a solar/radiator truss with a 3.75 m attitude ring and battery bank, launched in a
 * 5 m fairing by a Monsoon core with four Furnace solids and a three-Foehn upper stage in the Cradle interstage.
 */
export function buildKeystone(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Keystone Power Module',
    'Real scale: the first station segment. Four Furnace solids and a Monsoon core lift a five-metre fairing; three Foehn engines in the Cradle interstage reach orbit. The module docks nose-first with Flurry RCS blocks.');
  const core = b.root('probe-cairn');
  b.stack(core, 'dock-1', 'top');
  b.radial(core, 'rcs-quint', 4, 0, 45);
  const power = b.stack(core, 'truss-octagonal');
  b.radial(power, 'solar-wing', 4, 0.35, 45);
  b.radial(power, 'radiator-2', 2, -0.35, 0);
  const service = b.stack(power, 'truss-octagonal');
  b.radial(service, 'mono-pip', 4, 0.4, 45);
  b.radial(service, 'light-area', 2, -0.5, 90);
  b.radial(service, 'antenna-arc', 1, -0.5, 0);
  const shoulder = b.stack(service, 'adapt-1-3');
  const ring = b.stack(shoulder, 'wheel-reaction-3');
  const bank = b.stack(ring, 'battery-bank-3');
  const release = b.stack(bank, 'dec-3');
  const flare = b.stack(release, 'adapt-3-4');
  const fairing = b.stack(flare, 'fairing-4');
  const upper = b.stack(fairing, 'tank-4-short');
  const frame = b.stack(upper, 'interstage-4');
  for (const node of ['engine', 'engine-left', 'engine-right']) b.stack(frame, 'eng-foehn', node, 'top');
  const sep = b.stack(frame, 'dec-4');
  const coreTop = b.stack(sep, 'tank-4-mid');
  const coreBottom = b.stack(coreTop, 'tank-4-long');
  const monsoon = b.stack(coreBottom, 'eng-monsoon');
  b.radial(coreBottom, 'fin-pivot', 4, -4.2, 0);
  const latch = b.radial(coreBottom, 'dec-radial', 4, 0, 45);
  const booster = b.outward(latch, 'srb-furnace');
  b.stack(booster, 'nose-2', 'top');
  return finish(b, [[[monsoon], booster]]);
}

/**
 * Standard-scale Venus lander: only the Kiln probe and its pressure shell are rated for the surface, so the entry
 * shield, cruise stage and launcher all fall away. Dense air brakes the shell to a survivable fall without parachutes.
 */
export function buildCinderbloom(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Cinderbloom Venus Lander',
    'Fly to Venus and dive straight in, broad shield first. Drop the shield below 1 km/s; the Kiln pressure shell then falls through the crushing air without parachutes and survives about half an hour on the surface.');
  const probe = b.root('probe-kiln');
  const shell = b.stack(probe, 'shell-kiln');
  // Mounted upside down so the separation ring leaves with the shield: it is not rated for the surface pressure.
  const release = b.stack(shell, 'dec-1', 'bottom', 'bottom');
  const flare = b.stack(release, 'adapt-1-2', 'top', 'top');
  const shield = b.stack(flare, 'shield-2');
  const cruiseSep = b.stack(shield, 'dec-2');
  const cruise = b.stack(cruiseSep, 'tank-2-short');
  b.radial(cruise, 'solar-fold', 2, 0.2, 90);
  b.radial(cruise, 'antenna-relay', 1, 0.2, 0);
  b.radial(cruise, 'rcs-linear', 4, -0.4, 45);
  b.radial(cruise, 'mono-pip', 2, -0.3, 0);
  const engine = b.stack(cruise, 'eng-zephyr');
  const sep = b.stack(engine, 'dec-2');
  const booster = b.stack(sep, 'tank-2-long');
  b.stack(booster, 'eng-chinook');
  b.radial(booster, 'fin-pivot', 4, -2.6, 45);
  return finish(b);
}

/**
 * Crewed Moon hopper: a Lantern capsule on a lander with twin radial Rill engines, a ladder, floodlights and a seismic
 * station, above a Zephyr transfer stage and a Chinook booster with two Roman Candle solids.
 */
export function buildLamplighter(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Lamplighter Lunar Hopper',
    'Crewed Moon expedition with fuel to land, hop to a second site and fly home. Twin radial Rill engines leave room below the lander; floodlights and a ladder make night landings and moonwalks friendlier.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const capsuleSep = b.stack(shield, 'dec-1');
  // The capsule's own wheel turns the full lander too slowly to track a landing site.
  const wheel = b.stack(capsuleSep, 'wheel-gyre-1');
  const lander = b.stack(wheel, 'tank-1-long');
  b.radial(lander, 'eng-radial-rill', 'mirror', -0.9, 90);
  b.radial(lander, 'leg-strider', 4, -0.9, 45);
  b.radial(lander, 'ladder-2', 1, 0.2, 0);
  b.radial(lander, 'light-area', 2, 1.2, 90);
  b.radial(lander, 'light-task', 1, -0.6, 180);
  b.radial(lander, 'sensor-seismic', 1, 0.6, 180);
  b.radial(lander, 'solar-fold', 2, 0.9, 0);
  const landerSep = b.stack(lander, 'dec-1');
  const transferTop = b.stack(landerSep, 'tank-1-mid');
  const transfer = b.stack(transferTop, 'tank-1-long');
  const zephyr = b.stack(transfer, 'eng-zephyr');
  const boosterSep = b.stack(zephyr, 'dec-1');
  const adapter = b.stack(boosterSep, 'adapt-1-2');
  const boosterTop = b.stack(adapter, 'tank-2-short');
  const booster = b.stack(boosterTop, 'tank-2-long');
  const chinook = b.stack(booster, 'eng-chinook');
  b.radial(booster, 'fin-pivot', 4, -2.6, 45);
  const latch = b.radial(booster, 'dec-radial', 2, -0.5, 90);
  const solid = b.outward(latch, 'srb-roman-candle');
  b.stack(solid, 'nose-1', 'top');
  return finish(b, [[[chinook], solid]]);
}

/** Picker entries, registered in STOCK_CRAFTS. A function so the import cycle with stockCrafts.ts is harmless. */
export function spaceStock(): StockCraft[] {
  const hop = (scale: ScalePresetId, suffix: string) => ({ scale, id: `stock-hopscotch${suffix}`, name: 'Hopscotch Landing Demonstrator',
    blurb: 'Vertical take-off and landing hopper · research required', needsResearch: true, category: 'fun' as const,
    tags: ['eng-boreal', 'leg-colossus', 'light-area', 'light-beacon'],
    tip: 'Full throttle for a few seconds, cut the engine at the top, then relight and ease the throttle to settle on the legs.',
    build: () => buildHopscotch() });
  return [
    { scale: 'standard', id: 'stock-pipit', name: 'Pipit Satellite Launcher', needsResearch: true, build: () => buildPipit(),
      blurb: 'Uncrewed first satellite · fairing, solid strap-ons, kick motor · research required', category: 'orbit',
      tags: ['fairing-1', 'eng-mistral', 'srb-candle', 'srb-sparkler', 'solar-patch', 'sensor-pressure'],
      tip: 'Reach orbit on the Mistral stage, then release the satellite and light its Candle kick motor prograde for a Moon flyby.' },
    { scale: 'standard', id: 'stock-lodestar', name: 'Lodestar Ion Explorer', needsResearch: true, build: () => buildLodestar(),
      blurb: 'Xenon ion probe · 10 km/s of patient thrust · research required', category: 'worlds',
      tags: ['eng-whisper', 'xenon-bottle', 'solar-wing', 'truss-octagonal', 'fairing-2', 'antenna-arc'],
      tip: 'In orbit, drop the upper stage and leave the ion drive on under physics warp. It pauses in shadow and resumes in sunlight.' },
    { scale: 'standard', id: 'stock-cinderbloom', name: 'Cinderbloom Venus Lander', needsResearch: true, build: () => buildCinderbloom(),
      blurb: 'Venus surface lander · pressure shell, no parachutes · research required', category: 'worlds',
      tags: ['probe-kiln', 'shell-kiln', 'shield-2', 'rcs-linear'],
      tip: 'Entry trim at Venus, drop the cruise stage, hold retrograde, shield off below 300 m/s. It reports only while Earth is up.' },
    { scale: 'standard', id: 'stock-lamplighter', name: 'Lamplighter Lunar Hopper', needsResearch: true, build: () => buildLamplighter(),
      blurb: 'Crewed Moon landing, hop and return · radial engines, lights, ladder · research required', category: 'worlds',
      tags: ['eng-radial-rill', 'ladder-2', 'light-area', 'sensor-seismic', 'srb-roman-candle'],
      tip: 'After the first landing, hop: a few seconds of thrust tilted a little sideways, then land again with the legs down.' },
    // Standard scale already has the Cricket Hopper (stock/fun.ts); the larger scales had no vertical lander at all.
    hop('challenging', '-challenging'), hop('real', '-real'),
    { scale: 'challenging', id: 'stock-duskwing-challenging', name: 'Duskwing Mars Orbiter', needsResearch: true, build: () => buildDuskwing(),
      blurb: 'Challenging scale · methalox Mars mapping orbiter · research required', category: 'worlds',
      tags: ['coupler-2-x4', 'eng-boreal', 'srb-reed', 'probe-vault', 'scanner-meridian', 'sensor-gravity'],
      tip: 'Capture into a long ellipse, then lower the periapsis to about 35 km: each pass through the air shrinks the orbit for free.' },
    { scale: 'real', id: 'stock-keystone-real', name: 'Keystone Power Module', needsResearch: true, build: () => buildKeystone(),
      blurb: 'Real scale · station power truss in a five-metre fairing · research required', category: 'orbit',
      tags: ['fairing-4', 'srb-furnace', 'interstage-4', 'wheel-reaction-3', 'battery-bank-3', 'radiator-2', 'rcs-quint'],
      tip: 'Release the module in orbit, let the wings and radiators unfold, then dock later segments to its nose using the RCS blocks.' },
  ];
}
