import type { ScalePresetId } from '../sim/bodies/scale';
import { PART_CATALOG } from '../data/parts';
import type { CraftDef, PartActionId, PartDef } from '../sim/vessel/types';
import { qFromAxisAngle, qRotate, type Quat } from '../util/quat';
import { v3, type Vec3 } from '../util/vec3';
import { autoStageByDepth, CraftEditor, type PartCatalog } from './core';
import { surfaceTransform } from './surface';

/**
 * Pre-built stock crafts, assembled programmatically through CraftEditor so attach positions, symmetry
 * groups and staging are exactly what the editor would produce.
 */
export interface StockCraft {
  id: string;
  name: string;
  blurb: string;
  /** Universe preset this design is sized for. */
  scale: ScalePresetId;
  /** Destination hardware is deployed there; Earth launchers are complete stacks. */
  launchBody?: string;
  needsResearch?: boolean;
  build(): CraftDef;
}

type Sym = 1 | 2 | 3 | 4 | 6 | 8 | 'mirror';

/** Programmatic craft assembly (also used by test/dev fixtures such as `flight/stationFixture`). */
export class Builder {
  readonly ed: CraftEditor;
  readonly resources = new Map<number, CraftDef["parts"][number]["resources"]>();
  readonly stages = new Map<string, number>();
  constructor(readonly catalog: PartCatalog, name: string, description: string, type: CraftDef['type'] = 'VAB', seed?: CraftDef) {
    // Stock designs were tuned and flight-tested with the depth stager; keep their staging exactly.
    this.ed = new CraftEditor(catalog, seed ?? { name, description, type, parts: [], version: 1 }, undefined, { stager: autoStageByDepth, manualStaging: false });
  }
  part(uid: number) {
    return this.ed.craft.parts.find((x) => x.uid === uid)!;
  }
  def(id: string): PartDef {
    return this.catalog.get(id)!;
  }
  root(id: string): number {
    return this.ed.addRoot(id).uid;
  }
  /** Attach `id` below (or above) a parent through stack nodes. */
  stack(parent: number, id: string, parentNode = 'bottom', childNode = parentNode === 'bottom' ? 'top' : 'bottom'): number {
    this.ed.setSymmetry({ mode: 'radial', count: 1 });
    return this.ed.attachPart(id, parent, parentNode, childNode).uid;
  }
  /**
   * Surface-attach `count` copies of `id` around a vertical cylindrical parent, at `dy` metres from the
   * parent's centre and starting azimuth `deg` (0 = +Z).
   */
  radial(parent: number, id: string, count: Sym, dy: number, deg = 0, extra?: Quat): number {
    const p = this.ed.craft.parts.find((x) => x.uid === parent)!;
    const pd = this.def(p.partId);
    let r: number;
    if (pd.shape.kind === 'cylinder') {
      const t = Math.min(1, Math.max(0, dy / pd.shape.height + 0.5));
      r = pd.shape.radiusBottom + (pd.shape.radiusTop - pd.shape.radiusBottom) * t;
    } else r = pd.shape.size.z / 2;
    const a = (deg * Math.PI) / 180;
    const n = v3(Math.sin(a), 0, Math.cos(a));
    const local: Vec3 = v3(n.x * r, dy, n.z * r);
    const point = add(p.position, qRotate(p.rotation, local));
    const normal = qRotate(p.rotation, n);
    return this.surface(parent, id, point, normal, count, extra);
  }
  /** Surface-attach on the outer (+Z) face of a radial part (e.g. a booster on a side latch). */
  outward(parent: number, id: string, dy = 0): number {
    const p = this.ed.craft.parts.find((x) => x.uid === parent)!;
    const pd = this.def(p.partId);
    const hz = pd.shape.kind === 'box' ? pd.shape.size.z / 2 : pd.shape.radiusBottom;
    const point = add(p.position, qRotate(p.rotation, v3(0, dy, hz)));
    return this.surface(parent, id, point, qRotate(p.rotation, v3(0, 0, 1)), 1);
  }
  /** Surface-attach at a craft-frame point/normal on `parent` (+Y of the new part kept along craft +Y). */
  surface(parent: number, id: string, point: Vec3, normal: Vec3, count: Sym, extra?: Quat): number {
    const t = surfaceTransform(this.def(id), point, normal, v3(0, 1, 0), extra);
    this.ed.setSymmetry(count === 'mirror' ? { mode: 'mirror' } : { mode: 'radial', count });
    return this.ed.surfaceAttachAtHit(id, parent, point, normal, t.rotation).uid;
  }
  done(): CraftDef {
    const craft = this.ed.craft;
    for (const p of craft.parts) {
      if (this.resources.has(p.uid)) p.resources = this.resources.get(p.uid);
      if (this.stages.has(p.partId)) p.stage = this.stages.get(p.partId);
    }
    return craft;
  }
}

const add = (a: Vec3, b: Vec3) => v3(a.x + b.x, a.y + b.y, a.z + b.z);

export function buildSoundingRocket(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Kestrel Sounding Rocket', 'Single-stage crewed hop. Up, over, splash. About 2.5 km/s.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const dec = b.stack(shield, 'dec-1');
  // Two standard tanks rather than one tall one: same propellant, and every part is starter equipment so a
  // brand-new Science/Career program can fly it straight away.
  const upper = b.stack(dec, 'tank-1-mid');
  const tank = b.stack(upper, 'tank-1-mid');
  b.stack(tank, 'eng-sirocco');
  b.radial(tank, 'fin-keel', 3, -0.95);
  return b.done();
}

/** A foundation-only orbital design; demonstrates progression without research dependencies. */
export function buildFoundationOrbiter(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Firstlight Orbiter', 'Starting equipment: two stages to Standard-scale orbit.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const upperDec = b.stack(shield, 'dec-1');
  const upper = b.stack(upperDec, 'tank-1-mid');
  const engine = b.stack(upper, 'eng-gust');
  const boosterDec = b.stack(engine, 'dec-1');
  const top = b.stack(boosterDec, 'tank-1-mid');
  const middle = b.stack(top, 'tank-1-mid');
  const bottom = b.stack(middle, 'tank-1-mid');
  b.stack(bottom, 'eng-sirocco');
  b.radial(bottom, 'fin-keel', 4, -0.95, 45);
  return b.done();
}

export function buildOrbiter(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Meridian Orbiter', 'Two-stage crewed orbital rocket with a heat-shielded return capsule. About 5 km/s.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const dec1 = b.stack(shield, 'dec-1');
  const upper = b.stack(dec1, 'tank-1-long');
  b.radial(upper, 'solar-fold', 2, 1.1, 90);
  const zephyr = b.stack(upper, 'eng-zephyr');
  const dec2 = b.stack(zephyr, 'dec-1');
  const t1 = b.stack(dec2, 'tank-1-long');
  const t2 = b.stack(t1, 'tank-1-long');
  b.stack(t2, 'eng-sirocco');
  b.radial(t2, 'fin-keel', 4, -0.95, 45);
  return b.done();
}

export function buildMoonLander(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(
    catalog,
    'Selene Lunar Lander',
    'Three-stage Moon mission: heavy booster to orbit, transfer stage for TLI and capture, legged lander that lands, ascends and flies home. About 7 km/s.',
  );
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const dec1 = b.stack(shield, 'dec-1');
  // Lander / return stage
  const landerTop = b.stack(dec1, 'tank-1-short');
  b.radial(landerTop, 'solar-fold', 4, 0, 0);
  const lander = b.stack(landerTop, 'tank-1-mid');
  b.radial(lander, 'leg-strider', 4, -0.4, 45);
  const doldrum = b.stack(lander, 'eng-doldrum');
  const dec2 = b.stack(doldrum, 'dec-1');
  // Transfer stage
  const transferTop = b.stack(dec2, 'tank-1-mid');
  const transfer = b.stack(transferTop, 'tank-1-long');
  const zephyr = b.stack(transfer, 'eng-zephyr');
  const dec3 = b.stack(zephyr, 'dec-1');
  // Booster
  const adapter = b.stack(dec3, 'adapt-1-2');
  const boosterTop = b.stack(adapter, 'tank-2-short');
  const booster = b.stack(boosterTop, 'tank-2-long');
  b.stack(booster, 'eng-chinook');
  b.radial(booster, 'fin-pivot', 4, -2.6, 0);
  return b.done();
}

/**
 * Small jet: Skylark cockpit, one fuselage tank, Kittiwake turbofan, Broadleaf wings, Hawktail tail surfaces,
 * steerable nose gear and braked main gear under the wings. Takes off at ~65 m/s.
 */
export function buildSwift(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Swift Jet', 'Single-seat turbofan trainer. Space to start the engine, full throttle, pull up gently at 65 m/s.', 'SPH');
  const cockpit = b.root('cockpit-skylark');
  const fuse = b.stack(cockpit, 'fuse-spar');
  const jet = b.stack(fuse, 'jet-kittiwake');
  b.radial(fuse, 'intake-gill', 'mirror', 0.75, 60);
  // 3 deg of wing incidence (rotation about the wing's span axis, leading edge up).
  const wing = b.radial(fuse, 'wing-broadleaf', 'mirror', -0.45, 90, qFromAxisAngle(v3(0, 0, 1), (3 * Math.PI) / 180));
  b.radial(jet, 'tail-hawk', 'mirror', -0.55, 90);
  b.radial(jet, 'tail-hawk', 1, -0.45, 0);
  b.radial(cockpit, 'gear-trundle', 1, -0.45, 180);
  // Main gear under the wings, just behind the centre of mass.
  const w = b.part(wing);
  const wd = b.def('wing-broadleaf');
  const t = wd.shape.kind === 'box' ? wd.shape.size.x : 0.1;
  b.surface(wing, 'gear-bogie', v3(w.position.x - 1.5, w.position.y - 0.65, w.position.z - t / 2), v3(0, 0, -1), 'mirror');
  return b.done();
}

/** Chemical Saturn orbiter: high-thrust escape stage and restartable probe insertion stage. */
export function buildRingrunner(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Ringrunner Saturn Probe',
    'Three-stage Saturn explorer: heavy launcher, hydrolox departure stage, solar-powered orbital probe. Designed for the standard universe.');
  const probe = b.root('probe-cairn');
  b.stack(probe, 'nose-1', 'top');
  const battery = b.stack(probe, 'battery-drum');
  const wheel = b.stack(battery, 'wheel-gyre-1');
  const capture = b.stack(wheel, 'tank-1-long');
  b.radial(capture, 'solar-fold', 4, 1.0, 45);
  b.radial(capture, 'battery-brick', 4, 0, 0);
  const engine = b.stack(capture, 'eng-zephyr');
  const dec = b.stack(engine, 'dec-1');
  const adapter = b.stack(dec, 'adapt-1-2');
  const transfer = b.stack(adapter, 'tank-2-mid');
  const foehn = b.stack(transfer, 'eng-foehn');
  const boosterDec = b.stack(foehn, 'dec-2');
  const top = b.stack(boosterDec, 'tank-2-short');
  const booster = b.stack(top, 'tank-2-long');
  b.stack(booster, 'eng-chinook');
  b.radial(booster, 'fin-pivot', 4, -2.6, 0);
  return b.done();
}

/** Small orbital tug for rendezvous & docking practice (spawned in orbit by `?scenario=rendezvous`). */
export function buildTender(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Wren Tender', 'Probe-controlled docking tug: 1.25 m docking collar on the nose, eight RCS quads, a small descent engine.');
  const core = b.root('probe-cairn');
  b.stack(core, 'dock-1', 'top');
  const mono = b.stack(core, 'mono-bagel');
  const tank = b.stack(mono, 'tank-1-mid');
  b.stack(tank, 'eng-doldrum');
  b.radial(mono, 'rcs-nudge', 4, 0, 45);
  b.radial(tank, 'rcs-nudge', 4, -0.5, 45);
  b.radial(tank, 'solar-fold', 2, 0.2, 0);
  return b.done();
}

/** Complete two-stage delivery stack; keep payload propulsion behind its own separation ring. */
function delivery(b: Builder, payloadEngine: number, heavy = false): void {
  const dec = b.stack(payloadEngine, 'dec-1');
  const adapter = b.stack(dec, 'adapt-1-2');
  const upper = b.stack(adapter, 'tank-2-mid');
  const engine = b.stack(upper, 'eng-foehn');
  const sep = b.stack(engine, 'dec-2');
  if (heavy) {
    const wide = b.stack(sep, 'adapt-2-3');
    const base = b.stack(wide, 'adapt-3-4');
    const tank = b.stack(base, 'tank-4-long');
    b.stack(tank, 'eng-monsoon');
    b.radial(tank, 'fin-pivot', 4, -4.2, 45);
  } else {
    const tank = b.stack(sep, 'tank-2-long');
    b.stack(tank, 'eng-chinook');
    b.radial(tank, 'fin-pivot', 4, -2.6, 45);
  }
}

function station(lab: boolean, catalog: PartCatalog): CraftDef {
  const b = new Builder(catalog, lab ? 'Alembic Laboratory' : 'Hearthlight Station',
    'Standard-scale station delivery stack. Separate the launcher, then use the docking nose and RCS to assemble your outpost. Advanced research required.');
  const core = b.root('probe-cairn');
  b.stack(core, 'dock-1', 'top');
  const cap = b.stack(core, 'adapt-1-2');
  const habitat = b.stack(cap, lab ? 'lab-crucible' : 'cabin-wayfarer');
  b.radial(habitat, 'solar-grand-1', 2, 0, 90);
  b.radial(habitat, 'rcs-nudge', 4, 1, 45);
  b.radial(habitat, 'rcs-nudge', 4, -1, 45);
  b.radial(habitat, 'antenna-relay', 1, 0, 0);
  const battery = b.stack(habitat, 'battery-bank-2');
  const narrow = b.stack(battery, 'adapt-1-2', 'bottom', 'bottom');
  const mono = b.stack(narrow, 'mono-bagel', 'top', 'top');
  const tank = b.stack(mono, 'tank-1-short');
  const engine = b.stack(tank, 'eng-doldrum');
  delivery(b, engine, true);
  return b.done();
}

export const buildStationCore = (catalog: PartCatalog = PART_CATALOG) => station(false, catalog);
export const buildScienceLab = (catalog: PartCatalog = PART_CATALOG) => station(true, catalog);

export function buildCrewFerry(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Homeward Crew Ferry', 'Three-seat orbital taxi with docking collar, RCS and shielded parachute return. Separate the service stage before reentry. Research required.');
  const pod = b.root('pod-harbor-3');
  b.stack(pod, 'dock-2', 'top');
  b.radial(pod, 'chute-radial-heavy', 2, 0.4, 90);
  const shield = b.stack(pod, 'shield-2');
  const dec = b.stack(shield, 'dec-2');
  const tank = b.stack(dec, 'tank-2-short');
  b.radial(tank, 'solar-fold', 2, 0, 90);
  b.radial(tank, 'rcs-nudge', 4, 0.5, 45);
  b.radial(tank, 'mono-pip', 4, -0.3, 45);
  const narrow = b.stack(tank, 'adapt-1-2', 'bottom', 'bottom');
  const engine = b.stack(narrow, 'eng-zephyr', 'top', 'top');
  delivery(b, engine, true);
  return b.done();
}

function rover(b: Builder): number {
  const chassis = b.root('rover-chassis');
  b.stack(chassis, 'probe-cairn', 'top');
  // Craft +Y points forward and -Z down, just as in the spaceplane hangar.
  for (const y of [-0.65, 0.65]) b.surface(chassis, 'rover-wheel-0', v3(0.75, y, -0.175), v3(0, 0, -1), 'mirror');
  b.radial(chassis, 'generator-isotope', 2, 0, 90);
  b.radial(chassis, 'scanner-assay', 1, 0, 0);
  b.radial(chassis, 'antenna-thread', 1, 0.6, 0);
  const mono = b.stack(chassis, 'mono-bagel');
  b.stack(mono, 'eng-dewdrop');
  return chassis;
}

export function buildMoonRover(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Moonmoth Rover', 'Deploy on the Moon with +Y forward and wheels down. W/S drive, A/D steer, B brakes; monopropellant hop thruster. Research required.', 'SPH');
  rover(b);
  return b.done();
}

export function buildRoverLander(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Moonmoth Delivery Lander', 'Lunar descent carrier. Land on four legs, separate the rover, then use attitude control to settle its wheels down before driving. Research required.');
  const chassis = rover(b);
  // Carrier is attached to the rover side so its main descent axis remains vertical.
  const latch = b.radial(chassis, 'dec-radial', 1, 0, 180);
  const tank = b.outward(latch, 'tank-1-mid');
  b.stack(tank, 'probe-cairn', 'top');
  b.stack(tank, 'eng-doldrum');
  b.radial(tank, 'leg-strider', 4, -0.5, 45);
  // Ignite descent propulsion first, release rover second, rover hop thruster last.
  for (const p of b.ed.craft.parts) {
    if (p.partId === 'eng-doldrum') b.stages.set(p.partId, 2);
    if (p.partId === 'dec-radial') b.stages.set(p.partId, 1);
    if (p.partId === 'eng-dewdrop') b.stages.set(p.partId, 0);
  }
  return b.done();
}

export function buildMiningLander(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Bedrock Prospector', 'Moon surface refinery: deploy twin drills and start the Foundry after landing. Empty hopper and partial propellant tanks reserve production space. Research required.');
  const core = b.root('probe-cairn');
  b.stack(core, 'chute-main', 'top');
  const battery = b.stack(core, 'battery-bank-2');
  const processor = b.stack(battery, 'converter-foundry');
  const tank = b.stack(processor, 'tank-1-long');
  b.resources.set(tank, Object.fromEntries(Object.entries(b.def('tank-1-long').resources).map(([k,v]) => [k, v! * 0.6])));
  b.stack(tank, 'eng-doldrum');
  b.radial(tank, 'leg-colossus', 4, -1, 45);
  b.radial(tank, 'drill-burrow', 2, -0.6, 90);
  const hopper = b.radial(tank, 'regolith-hopper', 2, 0.5, 0);
  for (const p of b.ed.craft.parts.filter(p => p.symmetryGroup === b.part(hopper).symmetryGroup)) b.resources.set(p.uid, { regolith: 0 });
  b.radial(battery, 'solar-grand-2', 2, 0, 90);
  b.radial(core, 'scanner-assay', 1, 0, 0);
  return b.done();
}

export function buildNuclearTransfer(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Longreach Transfer Ship', 'Assemble in orbit: four-seat cabin, docking nose and a nuclear drive. Liquid-fuel-only reservoirs; low thrust, long burns. Research required.');
  const core = b.root('probe-cairn');
  b.stack(core, 'dock-1', 'top');
  const adapter = b.stack(core, 'adapt-1-2');
  const cabin = b.stack(adapter, 'cabin-wayfarer');
  const tank = b.stack(cabin, 'tank-2-long');
  b.resources.set(tank, { ...b.def('tank-2-long').resources, oxidizer: 0 });
  b.radial(cabin, 'solar-grand-1', 2, 0, 90);
  b.radial(tank, 'radiator-1', 2, 0, 0);
  b.radial(cabin, 'rcs-nudge', 4, 0.7, 45);
  b.radial(cabin, 'mono-pip', 4, -0.7, 45);
  const narrow = b.stack(tank, 'adapt-1-2', 'bottom', 'bottom');
  b.stack(narrow, 'eng-hearth', 'top', 'top');
  return b.done();
}

export function buildSSTO(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Daybreak Spaceplane', 'Reusable single-stage runway demonstrator. Start jets, rotate at 80 m/s; stage aerospike for the climb, then shut jets down above their ceiling. Research required.', 'SPH');
  const cockpit = b.root('cockpit-skylark');
  const tank = b.stack(cockpit, 'tank-1-long');
  const engine = b.stack(tank, 'eng-needle');
  b.radial(tank, 'jet-shrike', 'mirror', -1.1, 90);
  b.radial(tank, 'intake-snout', 'mirror', 1.3, 90);
  const wing = b.radial(tank, 'wing-broadleaf', 'mirror', -0.45, 90, qFromAxisAngle(v3(0,0,1), 3 * Math.PI / 180));
  b.radial(engine, 'tail-hawk', 'mirror', -0.2, 90);
  b.radial(engine, 'tail-hawk', 1, 0, 0);
  b.radial(cockpit, 'gear-trundle', 1, -0.45, 180);
  const w = b.part(wing);
  b.surface(wing, 'gear-bogie', v3(w.position.x - 1.5, w.position.y - 0.65, w.position.z - 0.12), v3(0,0,-1), 'mirror');
  for (const p of b.ed.craft.parts) if (p.partId === 'jet-shrike') b.stages.set(p.partId, 1);
  b.stages.set('eng-needle', 0);
  return b.done();
}

export function buildAtmosphericLander(titan: boolean, catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, titan ? 'Hazewalker Titan Probe' : 'Emberleaf Mars Lander',
    titan ? 'Titan entry probe: keep the broad shield into the flow, arm Orchard chutes after aerobraking and extend the legs. Isotope-powered instruments work through the haze. Research required.'
      : 'Mars approach lander: broad shield, twin heavy parachutes and four restartable descent engines. Chutes slow the thin-air descent; finish with rocket thrust. Research required.');
  const core = b.root('probe-cairn');
  b.stack(core, 'chute-heavy', 'top');
  const tank = b.stack(core, 'tank-1-short');
  b.radial(tank, 'chute-radial-heavy', 2, 0.1, 90);
  b.radial(tank, 'generator-isotope', 2, 0.1, 0);
  b.radial(tank, 'leg-strider', 4, -0.2, 45);
  b.radial(tank, 'eng-radial-spray', 4, 0, 45);
  b.radial(core, 'sensor-thermal', 1, 0, 0);
  b.radial(core, 'antenna-relay', 1, 0, 180);
  const adapter = b.stack(tank, 'adapt-1-2');
  b.stack(adapter, 'shield-2');
  return b.done();
}
export const buildHazewalker = (catalog: PartCatalog = PART_CATALOG) => buildAtmosphericLander(true, catalog);

export function buildPlumeSampler(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Frostwhisker Plume Sampler', 'Enceladus flyby or landing probe: isotope power, exposure sampler and a small restartable engine. Approach the south-polar plume from Saturn orbit. Research required.');
  const core = b.root('probe-cairn');
  b.radial(core, 'sensor-exposure', 1, 0, 180);
  b.stack(core, 'nose-1', 'top');
  const tank = b.stack(core, 'tank-1-mid');
  b.stack(tank, 'eng-doldrum');
  b.radial(tank, 'leg-stilt', 4, -0.6, 45);
  b.radial(tank, 'generator-isotope', 2, 0, 90);
  b.radial(core, 'antenna-horizon', 1, 0, 0);
  return b.done();
}

export function buildRingTour(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const craft = buildRingrunner(catalog);
  const b = new Builder(catalog, 'Gossamer Ring Observatory', 'Saturn delivery rocket with an isotope-powered science probe and Horizon relay. Stay above the rings during the tour. Research required.', 'VAB', craft);
  const core = craft.parts.find(p => p.partId === 'probe-cairn')!.uid;
  b.radial(core, 'antenna-horizon', 1, 0, 0);
  b.radial(core, 'generator-isotope', 2, 0, 90);
  b.radial(core, 'sensor-thermal', 1, 0, 180);
  const result = b.done();
  result.name = 'Gossamer Ring Observatory';
  result.description = 'Three-stage Saturn ring-tour and deep-space relay. Isotope-powered probe; standard universe. Research required.';
  return result;
}

export function buildHeavyLifter(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Atlaswake Heavy Lifter', 'Five metre cargo launcher with a guided restartable upper stage. Replace the nose with your payload. Standard scale; research required.');
  const core = b.root('probe-cairn');
  b.stack(core, 'nose-1', 'top');
  const adapter = b.stack(core, 'adapt-1-2');
  const tank = b.stack(adapter, 'tank-2-mid');
  const engine = b.stack(tank, 'eng-foehn');
  const dec = b.stack(engine, 'dec-2');
  const wide = b.stack(dec, 'adapt-2-3');
  const base = b.stack(wide, 'adapt-3-4');
  const booster = b.stack(base, 'tank-4-long');
  b.stack(booster, 'eng-monsoon');
  b.radial(booster, 'fin-pivot', 4, -4.2, 45);
  return b.done();
}

export function buildRelayLauncher(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Beaconseed Relay Launcher', 'Guided relay deployment stack: raise apoapsis, circularize with the payload motor and leave the Lattice array above the horizon. Research required.');
  const core = b.root('probe-cairn');
  b.stack(core, 'nose-1', 'top');
  const tank = b.stack(core, 'tank-1-mid');
  b.radial(tank, 'antenna-relay', 2, 0.5, 90);
  b.radial(tank, 'solar-fold', 2, -0.2, 0);
  const engine = b.stack(tank, 'eng-doldrum');
  delivery(b, engine);
  return b.done();
}

/** Heavy Earth delivery stack: solids assist eight isolated liquid strap-ons; the core follows. */
function realDelivery(b: Builder, upperMount: number, wideMount = false) {
  const middleSep = b.stack(upperMount, wideMount ? 'dec-4' : 'dec-2');
  const middleAdapter = wideMount ? middleSep : b.stack(middleSep, 'adapt-2-3');
  const wider = wideMount ? middleAdapter : b.stack(middleAdapter, 'adapt-3-4');
  const middle = b.stack(wider, 'tank-4-long');
  const middleEngine = b.stack(middle, 'eng-monsoon');
  const boosterSep = b.stack(middleEngine, 'dec-4');
  const booster = b.stack(boosterSep, 'tank-4-long');
  const booster2 = b.stack(booster, 'tank-4-long');
  b.stack(booster2, 'eng-monsoon');
  // Align the wide payload launcher's strap-on nozzles with the core instead of hanging them lower.
  const latch = b.radial(wideMount ? booster : booster2, 'dec-radial', 8, 0);
  const strap = b.outward(latch, 'tank-4-long');
  b.stack(strap, 'nose-4', 'top');
  const strapBottom = b.stack(strap, 'tank-4-long');
  const strapEngine = b.stack(strapBottom, 'eng-monsoon');
  b.outward(strapBottom, 'srb-thunderclap');
  for (const p of b.ed.craft.parts) if (p.partId === 'srb-thunderclap') p.stage = b.part(strapEngine).stage;
}

/** Real Saturn flyby explorer: isotope power and a nuclear cruise stage above chemical launch stages. */
export function buildRealRingrunner(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Ringrunner Real Saturn Probe',
    'Real scale: chemical Earth launcher and isotope-powered nuclear Saturn flyby probe. Plan without circular capture, aim 120,000 km above Saturn and use late cruise trims.');
  const probe = b.root('probe-cairn');
  b.stack(probe, 'nose-1', 'top');
  const battery = b.stack(probe, 'battery-bank-2');
  const wheel = b.stack(battery, 'wheel-reaction-2');
  b.radial(probe, 'antenna-horizon', 1, 0, 0);
  b.radial(battery, 'generator-isotope', 2, 0, 90);
  // The same fuel volume in a short, broad reservoir reduces the bending arm at the launcher.
  const shoulder = b.stack(wheel, 'adapt-2-3');
  const cap = b.stack(shoulder, 'adapt-3-4');
  const cruise = b.stack(cap, 'tank-4-mid');
  const cruise2 = b.stack(cruise, 'tank-4-short');
  for (const uid of [cruise, cruise2]) b.resources.set(uid, { ...b.def(b.part(uid).partId).resources, oxidizer: 0 });
  // Outer rings carry the launcher; the internal stack node feeds and supports only the engine.
  const thrustFrame = b.stack(cruise2, 'interstage-4');
  b.stack(thrustFrame, 'eng-hearth', 'engine', 'top');
  const sep = b.stack(thrustFrame, 'dec-4');
  const transfer = b.stack(sep, 'tank-4-mid');
  // Retain the original chemical propellant budget in a shorter barrel.
  b.resources.set(transfer, Object.fromEntries(Object.entries(b.def('tank-4-mid').resources)
    .map(([id, amount]) => [id, amount! * 0.6])));
  const departureFrame = b.stack(transfer, 'interstage-4');
  b.stack(departureFrame, 'eng-foehn', 'engine-left', 'top');
  b.stack(departureFrame, 'eng-foehn', 'engine-right', 'top');
  realDelivery(b, departureFrame, true);
  return b.done();
}

/** Three chemical stages sized for the 7.8 km/s real Earth parking orbit. */
export function buildRealOrbiter(catalog: PartCatalog = PART_CATALOG): CraftDef {
  return buildScaleOrbiter('real', catalog);
}

export function buildChallengingOrbiter(catalog: PartCatalog = PART_CATALOG): CraftDef {
  return buildScaleOrbiter('challenging', catalog);
}

function buildScaleOrbiter(preset: 'real' | 'challenging', catalog: PartCatalog): CraftDef {
  const real = preset === 'real';
  const b = new Builder(catalog, `Meridian ${real ? 'Real' : 'Challenging'} Orbiter`, `${preset} scale: three-stage chemical launcher with an ablative return capsule.`);
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const dec = b.stack(shield, 'dec-1');
  const upper = b.stack(dec, 'tank-1-long');
  b.radial(upper, 'solar-fold', 2, 0.5);
  const engine = b.stack(upper, 'eng-zephyr');
  const sep = b.stack(engine, 'dec-1');
  const adapter = b.stack(sep, 'adapt-1-2');
  const middle = b.stack(adapter, real ? 'tank-2-long' : 'tank-2-mid');
  const sustainer = b.stack(middle, 'eng-harmattan');
  const sep2 = b.stack(sustainer, 'dec-2');
  const wide = b.stack(sep2, 'adapt-2-3');
  const booster = b.stack(wide, real ? 'tank-3-long' : 'tank-3-mid');
  const booster2 = real ? b.stack(booster, 'tank-3-long') : booster;
  b.stack(booster2, 'eng-tempest');
  return b.done();
}

/**
 * Real-scale uncrewed lunar orbiter: a Pebble core on a small Wisp kick stage (it stays attached: TLI top-up,
 * lunar capture and orbit trims) above the Meridian Real launcher. Research: the orbiter's plus Remote Navigation.
 */
export function buildRealLunarProbe(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Tern Lunar Probe', 'Real scale: uncrewed Moon orbiter. The launcher reaches orbit and starts the transfer; the probe\'s own kick stage finishes it and captures at the Moon. Transmits its science.');
  const core = b.root('probe-pebble');
  // The core's own wheel cannot turn the launcher's upper stage for the transfer burn.
  const wheel = b.stack(core, 'wheel-gyre-0');
  const kick = b.stack(wheel, 'tank-0-long');
  b.radial(core, 'battery-brick', 1, 0, 0);
  b.radial(core, 'antenna-thread', 1, 0, 180);
  b.radial(core, 'sensor-thermal', 1, 0, 90);
  b.radial(kick, 'solar-fold', 2, 0.1, 45);
  const wisp = b.stack(kick, 'eng-wisp');
  const sep = b.stack(wisp, 'dec-0');
  const adapter = b.stack(sep, 'adapt-0-1');
  const upper = b.stack(adapter, 'tank-1-long');
  const engine = b.stack(upper, 'eng-zephyr');
  const sep1 = b.stack(engine, 'dec-1');
  const wide1 = b.stack(sep1, 'adapt-1-2');
  const middle = b.stack(wide1, 'tank-2-long');
  const sustainer = b.stack(middle, 'eng-harmattan');
  const sep2 = b.stack(sustainer, 'dec-2');
  const wide2 = b.stack(sep2, 'adapt-2-3');
  const booster = b.stack(wide2, 'tank-3-long');
  const booster2 = b.stack(booster, 'tank-3-long');
  b.stack(booster2, 'eng-tempest');
  return b.done();
}

/** Direct-ascent lunar expedition: independent descent and return propulsion. */
export function buildRealMoonLander(catalog: PartCatalog = PART_CATALOG): CraftDef {
  return buildScaleMoonLander('real', catalog);
}

export function buildChallengingMoonLander(catalog: PartCatalog = PART_CATALOG): CraftDef {
  return buildScaleMoonLander('challenging', catalog);
}

function buildScaleMoonLander(preset: 'real' | 'challenging', catalog: PartCatalog): CraftDef {
  const real = preset === 'real';
  const b = new Builder(catalog, `Selene ${real ? 'Real' : 'Challenging'} Expedition`, `${preset} scale: separate lunar descent and ascent/return stages on a chemical Earth launcher.`);
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const shield = b.stack(pod, 'shield-1');
  const capsuleSep = b.stack(shield, 'dec-1');
  const ascent = b.stack(capsuleSep, 'tank-1-long');
  const ascent2 = b.stack(ascent, 'tank-1-mid');
  b.radial(ascent, 'solar-fold', 2, 0.5);
  const ascentEngine = b.stack(ascent2, 'eng-doldrum');
  const descentSep = b.stack(ascentEngine, 'dec-1');
  const adapter = b.stack(descentSep, 'adapt-1-2');
  const wheel = b.stack(adapter, 'wheel-reaction-2');
  const descent = b.stack(wheel, 'tank-2-mid');
  b.radial(descent, 'battery-brick', 2, 0.8);
  const descentEngine = b.stack(descent, 'eng-foehn');
  b.radial(descentEngine, 'leg-strider', 4, -1.7, 45);
  const transferSep = b.stack(descentEngine, 'dec-2');
  const transfer = b.stack(transferSep, real ? 'tank-2-short' : 'tank-2-long');
  const transferEngine = b.stack(transfer, 'eng-foehn');
  if (!real) {
    // A dedicated three-metre delivery stack with solid assists leaves the transfer tank for the Moon.
    const sep = b.stack(transferEngine, 'dec-2');
    const wide = b.stack(sep, 'adapt-2-3');
    const middle = b.stack(wide, 'tank-3-long');
    const engine = b.stack(middle, 'eng-tempest');
    const boosterSep = b.stack(engine, 'dec-3');
    const booster = b.stack(boosterSep, 'tank-3-long');
    const bottom = b.stack(booster, 'tank-3-long');
    const boosterEngine = b.stack(bottom, 'eng-tempest');
    b.radial(bottom, 'srb-thunderclap', 4, 0, 45);
    for (const p of b.ed.craft.parts) if (p.partId === 'srb-thunderclap') p.stage = b.part(boosterEngine).stage;
    return b.done();
  }
  const transferSide = b.radial(transfer, 'tank-2-mid', 4, 0);
  const transferSideBottom = b.stack(transferSide, 'tank-2-short');
  b.stack(transferSideBottom, 'eng-foehn');
  realDelivery(b, transferEngine);
  return b.done();
}

/** Destination-deployed sample-return hardware; use RCS pulses for microgravity contact. */
export function buildPebblecatcher(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Pebblecatcher', 'Robotic sample return: collector, shield, parachute, RCS and four landing legs. Deployed near Bennu; pulse RCS gently.');
  const core = b.root('probe-cairn');
  b.stack(core, 'chute-main', 'top');
  const mono = b.stack(core, 'mono-bagel');
  const tank = b.stack(mono, 'tank-1-mid');
  b.stack(tank, 'shield-1');
  b.radial(core, 'sensor-sample', 1, 0, 90);
  b.radial(core, 'antenna-horizon', 1, 0, 270);
  b.radial(tank, 'eng-radial-spray', 2, 0, 90);
  b.radial(tank, 'leg-stilt', 4, -0.6, 45);
  b.radial(mono, 'rcs-nudge', 4, 0, 45);
  b.radial(core, 'solar-fold', 2, 0, 0);
  return b.done();
}

export const STOCK_CRAFTS: StockCraft[] = ([
  { scale: 'standard', id: 'stock-kestrel', name: 'Kestrel Sounding Rocket', blurb: 'Suborbital test hop · 1 stage + capsule', build: () => buildSoundingRocket() },
  { scale: 'standard', id: 'stock-meridian', name: 'Meridian Orbiter', blurb: 'Standard scale · two stages to low orbit and back', build: () => buildOrbiter() },
  { scale: 'standard', id: 'stock-selene', name: 'Selene Lunar Lander', blurb: 'Three stages · land on the Moon and return', build: () => buildMoonLander() },
  { scale: 'standard', id: 'stock-swift', name: 'Swift Jet', blurb: 'Runway takeoff · turbofan trainer aircraft', build: () => buildSwift() },
  { scale: 'standard', id: 'stock-ringrunner', name: 'Ringrunner Saturn Probe', blurb: 'Standard scale · three stages to Saturn', build: () => buildRingrunner() },
  { scale: 'standard', id: 'stock-pebblecatcher', name: 'Pebblecatcher', blurb: 'Bennu sample-return probe · gentle RCS touchdown', launchBody: 'bennu', needsResearch: true, build: () => buildPebblecatcher() },
  { scale: 'standard', id: 'stock-tender', name: 'Wren Tender', blurb: 'Small RCS tug for rendezvous and docking practice', build: () => buildTender() },
  ...([
    ['hearthlight', 'Hearthlight Station', 'Docking hub · four-seat orbital outpost', buildStationCore, 'earth'],
    ['homeward', 'Homeward Crew Ferry', 'Dock, exchange crew and return under parachutes', buildCrewFerry, 'earth'],
    ['moonmoth', 'Moonmoth Rover', 'Moon surface vehicle · powered wheels', buildMoonRover, undefined],
    ['moonmoth-lander', 'Moonmoth Delivery Lander', 'Lunar descent carrier · detachable rover', buildRoverLander, 'moon'],
    ['bedrock', 'Bedrock Prospector', 'Lunar mining lander · drill and refine', buildMiningLander, 'moon'],
    ['longreach', 'Longreach Transfer Ship', 'Orbital assembly · nuclear interplanetary drive', buildNuclearTransfer, undefined],
    ['daybreak', 'Daybreak Spaceplane', 'Runway · jets then aerospike · single stage', buildSSTO, undefined],
    ['emberleaf', 'Emberleaf Mars Lander', 'Mars approach · shield, chutes and powered descent', () => buildAtmosphericLander(false), 'mars'],
    ['hazewalker', 'Hazewalker Titan Probe', 'Titan approach · drift gently through the haze', buildHazewalker, 'titan'],
    ['frostwhisker', 'Frostwhisker Plume Sampler', 'Enceladus approach · polar plume science', buildPlumeSampler, 'enceladus'],
    ['gossamer', 'Gossamer Ring Observatory', 'Saturn ring tour · deep-space relay', buildRingTour, 'earth'],
    ['atlaswake', 'Atlaswake Heavy Lifter', 'Five metre cargo launcher · standard scale', buildHeavyLifter, 'earth'],
    ['beaconseed', 'Beaconseed Relay Launcher', 'Deploy a communications relay above Earth', buildRelayLauncher, 'earth'],
    ['alembic', 'Alembic Laboratory', 'Dockable two-seat orbital science module', buildScienceLab, 'earth'],
  ] satisfies [string, string, string, () => CraftDef, string | undefined][]).map(([id, name, blurb, build, launchBody]) => ({
    id: `stock-${id}`, name, blurb: `${blurb} · research required`,
    scale: 'standard' as const, build, launchBody, needsResearch: true,
  })),
  // The sounding rocket reaches space on every scale: larger programs start with it too.
  { scale: 'challenging', id: 'stock-kestrel-challenging', name: 'Kestrel Sounding Rocket', blurb: 'Suborbital test hop · starting equipment', build: () => buildSoundingRocket() },
  { scale: 'real', id: 'stock-kestrel-real', name: 'Kestrel Sounding Rocket', blurb: 'Suborbital test hop · starting equipment', build: () => buildSoundingRocket() },
  { scale: 'challenging', id: 'stock-meridian-challenging', name: 'Meridian Challenging Orbiter', blurb: 'Challenging scale · orbital launcher and return capsule', build: () => buildChallengingOrbiter() },
  { scale: 'challenging', id: 'stock-selene-challenging', name: 'Selene Challenging Expedition', blurb: 'Challenging scale · Moon landing and return expedition', build: () => buildChallengingMoonLander() },
  { scale: 'real', id: 'stock-ringrunner-real', name: 'Ringrunner Real Saturn Probe', blurb: 'Real scale · isotope-powered nuclear Saturn flyby', build: () => buildRealRingrunner() },
  { scale: 'real', id: 'stock-meridian-real', name: 'Meridian Real Orbiter', blurb: 'Real scale · orbital launcher and return capsule', build: () => buildRealOrbiter() },
  { scale: 'real', id: 'stock-tern-real', name: 'Tern Lunar Probe', blurb: 'Real scale · uncrewed Moon orbiter · transmits its science', build: () => buildRealLunarProbe() },
  { scale: 'real', id: 'stock-selene-real', name: 'Selene Real Expedition', blurb: 'Real scale · five-metre Moon landing and return expedition', build: () => buildRealMoonLander() },
  { scale: 'standard', id: 'stock-firstlight', name: 'Firstlight Orbiter', blurb: 'Starting equipment · Standard-scale orbit', build: () => buildFoundationOrbiter() },
] satisfies StockCraft[]).map(stock => ({
  ...stock,
  build: () => wireStockGroups({ ...stock.build(), stockId: stock.id }),
}));

/**
 * Default action groups for stock designs. Crewed launchers get an Abort sequence (shut down liquid engines, drop the
 * stack below the capsule, arm the capsule's parachutes); retractable solar arrays and antennas toggle on group 1.
 */
export function wireStockGroups(craft: CraftDef, catalog: PartCatalog = PART_CATALOG): CraftDef {
  const parts = craft.parts.map(p => ({ ...p }));
  const byUid = new Map(parts.map(p => [p.uid, p]));
  const def = (p: CraftDef['parts'][number]) => catalog.get(p.partId)!;
  const bind = (p: CraftDef['parts'][number], group: 'abort' | 'custom1', action: PartActionId) => {
    if (p.actions?.[group]?.includes(action)) return;
    p.actions = { ...p.actions, [group]: [...(p.actions?.[group] ?? []), action] };
  };
  const root = parts.find(p => p.parent === undefined);
  const crewed = !!root && def(root).modules.some(m => m.type === 'command' && m.crew > 0);
  if (crewed) {
    // First stack decoupler below the capsule: follow stack children from the root.
    type Part = CraftDef['parts'][number];
    let cur: Part | undefined = root, escape: Part | undefined;
    for (let guard = 0; cur && guard < 6 && !escape; guard++) {
      const parentUid: number = cur.uid;
      const child: Part | undefined = parts.find(p => p.parent === parentUid && p.attachNode !== 'srf' && p.parentNode === 'bottom');
      if (child && def(child).modules.some(m => m.type === 'decoupler')) escape = child;
      cur = child;
    }
    if (escape) {
      const dropped = (p: CraftDef['parts'][number]) => { for (let q: typeof p | undefined = p; q; q = q.parent === undefined ? undefined : byUid.get(q.parent)) if (q.parent === escape!.uid) return true; return false; };
      bind(escape, 'abort', 'decouple');
      for (const p of parts) {
        const mods = def(p).modules;
        if (mods.some(m => m.type === 'parachute') && !dropped(p)) bind(p, 'abort', 'chute.deploy');
        if (mods.some(m => m.type === 'engine' && !(m.propellants.solidFuel ?? 0))) bind(p, 'abort', 'engine.shutdown');
      }
    }
  }
  for (const p of parts) if (def(p).modules.some(m => (m.type === 'solarPanel' && m.tracking) || m.type === 'antenna')) bind(p, 'custom1', 'deploy.toggle');
  return { ...craft, parts };
}
