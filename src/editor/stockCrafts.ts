import { PART_CATALOG } from '../data/parts';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import { qFromAxisAngle, qRotate, type Quat } from '../util/quat';
import { v3, type Vec3 } from '../util/vec3';
import { CraftEditor, type PartCatalog } from './core';
import { surfaceTransform } from './surface';

/**
 * Pre-built stock crafts, assembled programmatically through CraftEditor so attach positions, symmetry
 * groups and staging are exactly what the editor would produce.
 */
export interface StockCraft {
  id: string;
  name: string;
  blurb: string;
  build(): CraftDef;
}

type Sym = 1 | 2 | 3 | 4 | 6 | 8 | 'mirror';

class Builder {
  readonly ed: CraftEditor;
  constructor(readonly catalog: PartCatalog, name: string, description: string, type: CraftDef['type'] = 'VAB') {
    this.ed = new CraftEditor(catalog, { name, description, type, parts: [], version: 1 });
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
    let r = 0.5;
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
    return this.ed.craft;
  }
}

const add = (a: Vec3, b: Vec3) => v3(a.x + b.x, a.y + b.y, a.z + b.z);

export function buildSoundingRocket(catalog: PartCatalog = PART_CATALOG): CraftDef {
  const b = new Builder(catalog, 'Kestrel Sounding Rocket', 'Single-stage crewed hop. Up, over, splash. About 2.5 km/s.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const dec = b.stack(pod, 'dec-1');
  // Two standard tanks rather than one tall one: same propellant, and every part is starter equipment so a
  // brand-new Science/Career program can fly it straight away.
  const upper = b.stack(dec, 'tank-1-mid');
  const tank = b.stack(upper, 'tank-1-mid');
  b.stack(tank, 'eng-sirocco');
  b.radial(tank, 'fin-keel', 3, -0.95);
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

export const STOCK_CRAFTS: StockCraft[] = [
  { id: 'stock-kestrel', name: 'Kestrel Sounding Rocket', blurb: 'Suborbital test hop · 1 stage + capsule', build: () => buildSoundingRocket() },
  { id: 'stock-meridian', name: 'Meridian Orbiter', blurb: 'Two stages to low orbit and back', build: () => buildOrbiter() },
  { id: 'stock-selene', name: 'Selene Lunar Lander', blurb: 'Three stages · land on the Moon and return', build: () => buildMoonLander() },
  { id: 'stock-swift', name: 'Swift Jet', blurb: 'Runway takeoff · turbofan trainer aircraft', build: () => buildSwift() },
  { id: 'stock-ringrunner', name: 'Ringrunner Saturn Probe', blurb: 'Three stages · explore the rings of Saturn', build: () => buildRingrunner() },
  { id: 'stock-tender', name: 'Wren Tender', blurb: 'Docking practice tug · try ?scenario=rendezvous', build: () => buildTender() },
];
