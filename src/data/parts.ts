import type { AttachNode, PartDef, PartModule, ResourceId } from '../sim/vessel/types';
import { KEROLOX_FUEL_FRACTION, KEROLOX_OX_FRACTION, RESOURCES } from './resources';

/**
 * Original part catalogue.
 *
 * Conventions (shared with src/render/parts):
 *  - Part frame: +Y = nose/up. Origin at the geometric centre of the part's bounding volume
 *    (exception: fairings, whose origin is the centre of the base ring; the shell rises above it).
 *  - Stack nodes: 'top' at +h/2 pointing +Y, 'bottom' at -h/2 pointing -Y.
 *  - Surface-attached (radial) parts: the mount face lies at the 'srf' node, which points -Z
 *    (into the parent). The part extends outward along +Z; +Y stays aligned with the parent's nose.
 *    Wings and fins have their span along +Z, chord along Y and thickness along X.
 *  - Engines thrust along +Y (exhaust toward -Y); the nozzle exit plane is at the bottom node.
 *  - Masses kg, thrust N, lengths m. Propellant units are litres.
 *
 * Balance target: the 'standard' universe (s = 0.1, Earth R = 637 km, g = 9.81) where low orbit
 * needs ~3.4 km/s including losses. Tanks hold ~8.5x their dry mass in propellant; engines are
 * heavier than real-world hardware (TWR 30-60) to keep vehicles in a satisfying size range.
 */

/** Node size class -> radius, m. */
export const SIZE_RADIUS = [0.3125, 0.625, 1.25, 1.875, 2.5] as const;

const DEG = Math.PI / 180;
const v = (x: number, y: number, z: number) => ({ x, y, z });

function stackNodes(h: number, sizeTop: number | null, sizeBottom: number | null): AttachNode[] {
  const n: AttachNode[] = [];
  if (sizeTop !== null) n.push({ id: 'top', position: v(0, h / 2, 0), direction: v(0, 1, 0), size: sizeTop });
  if (sizeBottom !== null) n.push({ id: 'bottom', position: v(0, -h / 2, 0), direction: v(0, -1, 0), size: sizeBottom });
  return n;
}

/** Surface-attach node at the mount face (z = -depth/2), pointing into the parent. */
function srfNode(depth: number, y = 0): AttachNode {
  return { id: 'srf', position: v(0, y, -depth / 2), direction: v(0, 0, -1), size: 0 };
}

const cyl = (radiusTop: number, radiusBottom: number, height: number) =>
  ({ kind: 'cylinder', radiusTop, radiusBottom, height }) as const;
const box = (x: number, y: number, z: number) => ({ kind: 'box', size: v(x, y, z) }) as const;

export const MANUFACTURERS = {
  halvorsen: 'Halvorsen Propulsion Works',
  kettle: 'Kettle & Fuse Pyrotechnics',
  tessellate: 'Tessellate Structures',
  greywater: 'Greywater Aerodynamics',
  northlight: 'Northlight Crew Systems',
  brightfield: 'Brightfield Autonomics',
  lumen: 'Lumen & Volt',
  aldercrest: 'Aldercrest Aeroengines',
  tread: 'Tarmac & Tread Undercarriage Co.',
} as const;

const KEROLOX = { liquidFuel: KEROLOX_FUEL_FRACTION, oxidizer: KEROLOX_OX_FRACTION };

// ---------------------------------------------------------------------------------------------
// Fuel tanks
// ---------------------------------------------------------------------------------------------

/** Usable fraction of the cylinder volume (domes, ullage, internal structure). */
const TANK_FILL = 0.9;
/** Propellant mass / dry mass. */
const TANK_MASS_RATIO = 8.5;

function fuelTank(
  id: string,
  name: string,
  size: number,
  length: number,
  finish: 'white' | 'orange' | 'steel' | 'charcoal',
  description: string,
): PartDef {
  const r = SIZE_RADIUS[size];
  const litres = Math.PI * r * r * length * 1000 * TANK_FILL;
  const lf = Math.round(litres * KEROLOX_FUEL_FRACTION);
  const ox = Math.round(litres * KEROLOX_OX_FRACTION);
  const propMass = lf * RESOURCES.liquidFuel.density + ox * RESOURCES.oxidizer.density;
  const ratio = finish === 'steel' ? TANK_MASS_RATIO * 0.9 : TANK_MASS_RATIO; // steel: heavier, tougher
  const dryMass = Math.round(propMass / ratio);
  return {
    id,
    name,
    manufacturer: MANUFACTURERS.tessellate,
    description,
    category: 'fuelTank',
    dryMass,
    cost: Math.round(dryMass * 2.2 + litres * 0.04),
    resources: { liquidFuel: lf, oxidizer: ox },
    attachNodes: stackNodes(length, size, size),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: cyl(r, r, length),
    dragCoefficient: { axial: 0.85, side: 1.0 },
    maxTemp: finish === 'steel' ? 1900 : 1500,
    crashTolerance: finish === 'steel' ? 10 : 7,
    modules: [],
    mesh: 'tank',
    meshParams: { finish },
  };
}

// ---------------------------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------------------------

interface EngineSpec {
  id: string;
  name: string;
  manufacturer?: string;
  description: string;
  size: number;
  height: number;
  dryMass: number;
  cost: number;
  thrustVac: number;
  ispVac: number;
  ispAsl: number;
  gimbalDeg: number;
  minThrottle: number;
  ignitions: number;
  spool: number;
  plume: 'kerolox' | 'hydrolox' | 'methalox';
  /** Mesh style and nozzle exit radius. */
  style: 'lifter' | 'vacuum' | 'lander' | 'fullflow' | 'hydrolox' | 'cluster' | 'compact';
  exitRadius: number;
  maxTemp?: number;
  extra?: Record<string, number | string | boolean>;
}

function liquidEngine(s: EngineSpec): PartDef {
  const r = SIZE_RADIUS[s.size];
  return {
    id: s.id,
    name: s.name,
    manufacturer: s.manufacturer ?? MANUFACTURERS.halvorsen,
    description: s.description,
    category: 'engine',
    dryMass: s.dryMass,
    cost: s.cost,
    resources: {},
    attachNodes: stackNodes(s.height, s.size, s.size),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(r, Math.max(s.exitRadius, r * 0.6), s.height),
    dragCoefficient: { axial: 0.6, side: 0.9 },
    maxTemp: s.maxTemp ?? 2200,
    crashTolerance: 7,
    modules: [
      {
        type: 'engine',
        maxThrustVac: s.thrustVac,
        ispVac: s.ispVac,
        ispAsl: s.ispAsl,
        propellants: { ...KEROLOX },
        minThrottle: s.minThrottle,
        throttleable: true,
        gimbalRange: s.gimbalDeg * DEG,
        thrustDirection: v(0, 1, 0),
        spoolTime: s.spool,
        plume: s.plume,
        ignitions: s.ignitions,
      },
    ],
    mesh: 'engine',
    meshParams: { style: s.style, exitRadius: s.exitRadius, ...(s.extra ?? {}) },
  };
}

interface SrbSpec {
  id: string;
  name: string;
  description: string;
  size: number;
  height: number;
  dryMass: number;
  cost: number;
  thrustVac: number;
  ispVac: number;
  ispAsl: number;
  segments: number;
}

/** Fraction of an SRB's casing volume that is propellant grain (minus nozzle and bore). */
const SRB_GRAIN_FILL = 0.85;

function solidMotor(s: SrbSpec): PartDef {
  const r = SIZE_RADIUS[s.size];
  const nozzle = s.height * 0.08;
  const grain = Math.round(Math.PI * r * r * (s.height - nozzle) * 1000 * SRB_GRAIN_FILL);
  return {
    id: s.id,
    name: s.name,
    manufacturer: MANUFACTURERS.kettle,
    description: s.description,
    category: 'engine',
    dryMass: s.dryMass,
    cost: s.cost,
    resources: { solidFuel: grain },
    attachNodes: [...stackNodes(s.height, s.size, s.size), srfNode(r * 2)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: cyl(r, r, s.height),
    dragCoefficient: { axial: 0.8, side: 1.0 },
    maxTemp: 2000,
    crashTolerance: 7,
    modules: [
      {
        type: 'engine',
        maxThrustVac: s.thrustVac,
        ispVac: s.ispVac,
        ispAsl: s.ispAsl,
        propellants: { solidFuel: 1 },
        minThrottle: 1,
        throttleable: false,
        gimbalRange: 0,
        thrustDirection: v(0, 1, 0),
        spoolTime: 0.15,
        plume: 'solid',
        ignitions: 1,
      },
    ],
    mesh: 'srb',
    meshParams: { segments: s.segments, nozzleLength: nozzle, exitRadius: r * 0.62 },
  };
}

// ---------------------------------------------------------------------------------------------
// Small helpers for repetitive part families
// ---------------------------------------------------------------------------------------------

function stackDecoupler(id: string, name: string, size: number, h: number, dryMass: number, impulse: number, cost: number, description: string, separator = false): PartDef {
  const r = SIZE_RADIUS[size];
  return {
    id,
    name,
    manufacturer: MANUFACTURERS.kettle,
    description,
    category: 'coupling',
    dryMass,
    cost,
    resources: {},
    attachNodes: stackNodes(h, size, size),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(r, r, h),
    dragCoefficient: { axial: 0.8, side: 0.9 },
    maxTemp: 2000,
    crashTolerance: 9,
    modules: [{ type: 'decoupler', ejectionImpulse: impulse, node: 'bottom' }],
    mesh: separator ? 'separator' : 'decoupler',
  };
}

/** Docking port: 'bottom' mounts to the vessel, the 'dock' node at the top is the mating face (+Y). */
function dockingPort(id: string, name: string, size: number, h: number, dryMass: number, cost: number, capture: { range: number; speed: number; angleDeg: number }, description: string): PartDef {
  const r = SIZE_RADIUS[size];
  return {
    id,
    name,
    manufacturer: MANUFACTURERS.tessellate,
    description,
    category: 'coupling',
    dryMass,
    cost,
    resources: {},
    attachNodes: [
      { id: 'dock', position: v(0, h / 2, 0), direction: v(0, 1, 0), size },
      { id: 'bottom', position: v(0, -h / 2, 0), direction: v(0, -1, 0), size },
    ],
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(r * 0.92, r, h),
    dragCoefficient: { axial: 0.8, side: 0.9 },
    maxTemp: 2000,
    crashTolerance: 10,
    modules: [{ type: 'dockingPort', size, captureRange: capture.range, captureSpeed: capture.speed, captureAngle: capture.angleDeg * DEG, node: 'dock' }],
    mesh: 'dockingPort',
  };
}

function adapter(id: string, name: string, sizeTop: number, sizeBottom: number, h: number, dryMass: number, cost: number, description: string): PartDef {
  return {
    id,
    name,
    manufacturer: MANUFACTURERS.tessellate,
    description,
    category: 'structural',
    dryMass,
    cost,
    resources: {},
    attachNodes: stackNodes(h, sizeTop, sizeBottom),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: cyl(SIZE_RADIUS[sizeTop], SIZE_RADIUS[sizeBottom], h),
    dragCoefficient: { axial: 0.5, side: 0.95 },
    maxTemp: 1800,
    crashTolerance: 9,
    modules: [],
    mesh: 'adapter',
  };
}

function noseCone(id: string, name: string, size: number, h: number, dryMass: number, cost: number, description: string): PartDef {
  const r = SIZE_RADIUS[size];
  return {
    id,
    name,
    manufacturer: MANUFACTURERS.greywater,
    description,
    category: 'aero',
    dryMass,
    cost,
    resources: {},
    attachNodes: stackNodes(h, null, size),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.02, r, h),
    dragCoefficient: { axial: 0.18, side: 0.8 },
    maxTemp: 2400,
    crashTolerance: 8,
    modules: [],
    mesh: 'noseCone',
  };
}

interface SurfaceSpec {
  id: string;
  name: string;
  description: string;
  dryMass: number;
  cost: number;
  /** Planform: root chord (at mount), tip chord, span, tip leading-edge sweep offset (m, toward -Y). */
  rootChord: number;
  tipChord: number;
  span: number;
  sweep: number;
  thickness: number;
  liftSlope: number;
  deflectionDeg: number;
  ctrlFraction: number;
  mesh: 'fin' | 'wing' | 'controlSurface';
  category?: 'aero' | 'control';
}

function liftingSurface(s: SurfaceSpec): PartDef {
  const area = ((s.rootChord + s.tipChord) / 2) * s.span;
  // Bounding box in Y: leading edge of the root at +rootChord/2 (relative to root centre),
  // leading edge of the tip at rootChord/2 - sweep, trailing edge at that minus tipChord.
  const yTop = Math.max(s.rootChord / 2, s.rootChord / 2 - s.sweep);
  const yBot = Math.min(-s.rootChord / 2, s.rootChord / 2 - s.sweep - s.tipChord);
  const height = yTop - yBot;
  const rootCentreY = -(yTop + yBot) / 2; // root centre offset after centring the bbox
  return {
    id: s.id,
    name: s.name,
    manufacturer: MANUFACTURERS.greywater,
    description: s.description,
    category: s.category ?? 'aero',
    dryMass: s.dryMass,
    cost: s.cost,
    resources: {},
    attachNodes: [srfNode(s.span, rootCentreY)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: box(s.thickness, height, s.span),
    dragCoefficient: { axial: 0.04, side: 1.2 },
    maxTemp: 2000,
    crashTolerance: 10,
    modules: [{ type: 'liftingSurface', area: +area.toFixed(3), liftSlope: s.liftSlope, deflection: s.deflectionDeg * DEG, ctrlFraction: s.ctrlFraction }],
    mesh: s.mesh,
    meshParams: { rootChord: s.rootChord, tipChord: s.tipChord, span: s.span, sweep: s.sweep, thickness: s.thickness, ctrlFraction: s.ctrlFraction },
  };
}

/**
 * Landing-leg kinematics shared with the mesh builder (src/render/parts) so the rendered foot
 * and the simulated contact point agree. `s` scales the whole leg. Leg rotates about +X at the
 * hinge, from pointing +Y (stowed) by `deployAngle` (deployed, down and outward along +Z).
 */
export function landingLegLayout(s: number) {
  const hinge = v(0, -0.38 * s, -0.02 * s);
  const stowedLength = 0.8 * s;
  const deployedLength = 1.15 * s;
  const deployAngle = 140 * DEG;
  const footPivot = v(0, hinge.y + deployedLength * Math.cos(deployAngle), hinge.z + deployedLength * Math.sin(deployAngle));
  const padRadius = 0.12 * s;
  const padHeight = 0.05 * s;
  const padDrop = 0.04 * s; // ball joint to pad centre
  const contact = v(0, footPivot.y - padDrop - padHeight / 2, footPivot.z);
  return { hinge, stowedLength, deployedLength, deployAngle, footPivot, padRadius, padHeight, padDrop, contact };
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

const pods: PartDef[] = [
  {
    id: 'pod-lantern-1',
    name: 'Lantern I Capsule',
    manufacturer: MANUFACTURERS.northlight,
    description: 'A single-seat capsule with one excellent window and very strong opinions about re-entry angles. Cosy is a generous word.',
    category: 'command',
    dryMass: 1100,
    cost: 1800,
    resources: { electricCharge: 60, monopropellant: 15 },
    attachNodes: stackNodes(1.6, 0, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.3, 0.625, 1.6),
    dragCoefficient: { axial: 0.9, side: 1.0 },
    maxTemp: 2400,
    crashTolerance: 14,
    modules: [
      { type: 'command', crew: 1, sasLevel: 1, ecPerSecond: 0.03 },
      { type: 'reactionWheel', torque: 2000, ecRate: 0.15 },
    ],
    mesh: 'pod',
    meshParams: { style: 'lantern', bodyHeight: 1.3 },
  },
  {
    id: 'pod-harbor-3',
    name: 'Harbor III Command Module',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Three seats, two windows, one shared opinion on who sits in the middle. Quilted thermal blanket at no extra charge.',
    category: 'command',
    dryMass: 3800,
    cost: 5200,
    resources: { electricCharge: 200, monopropellant: 40 },
    attachNodes: stackNodes(2.4, 1, 2),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.65, 1.25, 2.4),
    dragCoefficient: { axial: 0.95, side: 1.0 },
    maxTemp: 2400,
    crashTolerance: 14,
    modules: [
      { type: 'command', crew: 3, sasLevel: 2, ecPerSecond: 0.08 },
      { type: 'reactionWheel', torque: 8000, ecRate: 0.4 },
    ],
    mesh: 'pod',
    meshParams: { style: 'harbor', bodyHeight: 2.0 },
  },
  {
    id: 'probe-pebble',
    name: 'Pebble Probe Core',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'A foil-wrapped flight computer the size of a hatbox. It cannot be talked out of anything.',
    category: 'command',
    dryMass: 45,
    cost: 600,
    resources: { electricCharge: 25 },
    attachNodes: stackNodes(0.3, 0, 0),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.3125, 0.3125, 0.3),
    dragCoefficient: { axial: 0.8, side: 0.9 },
    maxTemp: 1500,
    crashTolerance: 10,
    modules: [
      { type: 'command', crew: 0, sasLevel: 1, ecPerSecond: 0.02 },
      { type: 'reactionWheel', torque: 300, ecRate: 0.05 },
    ],
    mesh: 'probeCore',
    meshParams: { style: 'pebble' },
  },
  {
    id: 'probe-cairn',
    name: 'Cairn Avionics Bus',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'Octagonal autopilot bus with a star tracker that never blinks. Full attitude-hold suite included.',
    category: 'command',
    dryMass: 160,
    cost: 1400,
    resources: { electricCharge: 80 },
    attachNodes: stackNodes(0.5, 1, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.625, 0.625, 0.5),
    dragCoefficient: { axial: 0.85, side: 0.95 },
    maxTemp: 1600,
    crashTolerance: 10,
    modules: [
      { type: 'command', crew: 0, sasLevel: 3, ecPerSecond: 0.04 },
      { type: 'reactionWheel', torque: 2000, ecRate: 0.2 },
    ],
    mesh: 'probeCore',
    meshParams: { style: 'cairn' },
  },
];

const tanks: PartDef[] = [
  fuelTank('tank-0-short', 'Thimble Tank', 0, 0.45, 'white', 'Small enough to fit in a backpack, if your backpack is rated for cryogenics.'),
  fuelTank('tank-0-long', 'Spindle Tank', 0, 0.9, 'white', 'Two Thimbles that got married. Popular with probe designers and the frugal.'),
  fuelTank('tank-1-short', 'Silo 1 Stub', 1, 0.75, 'white', 'A stubby 1.25 m tank for topping off stacks that are just a little short of ambition.'),
  fuelTank('tank-1-mid', 'Silo 1 Standard', 1, 1.5, 'white', 'The benchmark 1.25 m tank. Orbital welds, honest stringers, zero surprises.'),
  fuelTank('tank-1-long', 'Silo 1 Tall', 1, 3.0, 'white', 'Long, lean and full of propellant. Mind the slosh baffles.'),
  fuelTank('tank-2-short', 'Silo 2 Stub', 2, 1.5, 'orange', 'Spray-foam insulated 2.5 m section. The orange is the foam; the foam is load-bearing for morale.'),
  fuelTank('tank-2-mid', 'Silo 2 Standard', 2, 3.0, 'orange', 'Workhorse first-stage tank. Frost forms on the foam within minutes of fuelling.'),
  fuelTank('tank-2-long', 'Silo 2 Tall', 2, 6.0, 'orange', 'Forty-odd tonnes of kerolox in a single foam-wrapped cylinder. Bring a big crane.'),
  fuelTank('tank-3-mid', 'Silo 3 Standard', 3, 3.75, 'steel', 'Stainless 3.75 m section. Heavier than aluminium, shrugs off heat and dents like a champion.'),
  fuelTank('tank-3-long', 'Silo 3 Tall', 3, 7.5, 'steel', 'A polished steel grain silo that happens to want to go to space.'),
  {
    id: 'mono-pip',
    name: 'Pip Hydrazine Sphere',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'A titanium sphere of monopropellant on a sturdy bracket. Handle with gloves. And goggles. And distance.',
    category: 'fuelTank',
    dryMass: 12,
    cost: 220,
    resources: { monopropellant: 60 },
    attachNodes: [srfNode(0.56)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.5, 0.5, 0.56),
    dragCoefficient: { axial: 0.5, side: 0.5 },
    maxTemp: 1800,
    crashTolerance: 10,
    modules: [],
    mesh: 'monoSphere',
    meshParams: { radius: 0.24 },
  },
  {
    id: 'mono-bagel',
    name: 'Bagel Toroidal Tank',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'Ring-shaped hydrazine tank with a hollow core for wiring. Not a snack, despite the paperwork.',
    category: 'fuelTank',
    dryMass: 40,
    cost: 480,
    resources: { monopropellant: 250 },
    attachNodes: stackNodes(0.4, 1, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.625, 0.625, 0.4),
    dragCoefficient: { axial: 0.85, side: 0.9 },
    maxTemp: 1800,
    crashTolerance: 9,
    modules: [],
    mesh: 'monoTorus',
  },
  {
    id: 'xenon-bottle',
    name: 'Twin Xenon Bottles',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Two carbon-overwrapped pressure vessels holding a frankly unreasonable amount of xenon.',
    category: 'fuelTank',
    dryMass: 30,
    cost: 900,
    resources: { xenon: 40 },
    attachNodes: [srfNode(0.3)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.6, 0.8, 0.3),
    dragCoefficient: { axial: 0.5, side: 0.7 },
    maxTemp: 1600,
    crashTolerance: 8,
    modules: [],
    mesh: 'xenonTank',
  },
];

const engines: PartDef[] = [
  liquidEngine({
    id: 'eng-gust', name: 'Gust Mini-Booster', size: 0, height: 0.9, dryMass: 110, cost: 400,
    thrustVac: 20_000, ispVac: 310, ispAsl: 265, gimbalDeg: 4, minThrottle: 0.4, ignitions: 3, spool: 0.6,
    plume: 'kerolox', style: 'compact', exitRadius: 0.25,
    description: 'Pocket-sized kerolox engine for sounding rockets and small upper stages. Loud for its size.',
  }),
  liquidEngine({
    id: 'eng-wisp', name: 'Wisp Vacuum Thruster', size: 0, height: 1.0, dryMass: 80, cost: 650,
    thrustVac: 9_000, ispVac: 340, ispAsl: 120, gimbalDeg: 3, minThrottle: 0.2, ignitions: 8, spool: 0.4,
    plume: 'kerolox', style: 'vacuum', exitRadius: 0.3,
    description: 'A delicate radiatively cooled bell for probes. Firing it at sea level is technically possible and deeply embarrassing.',
  }),
  liquidEngine({
    id: 'eng-sirocco', name: 'Sirocco Lifter', size: 1, height: 2.0, dryMass: 700, cost: 1300,
    thrustVac: 220_000, ispVac: 320, ispAsl: 285, gimbalDeg: 5, minThrottle: 0.5, ignitions: 1, spool: 1.0,
    plume: 'kerolox', style: 'lifter', exitRadius: 0.5,
    description: 'Gas-generator kerolox engine with a famously dependable turbopump. The workhorse of 1.25 m first stages.',
  }),
  liquidEngine({
    id: 'eng-zephyr', name: 'Zephyr Vacuum Engine', size: 1, height: 2.6, dryMass: 420, cost: 1600,
    thrustVac: 65_000, ispVac: 345, ispAsl: 255, gimbalDeg: 3, minThrottle: 0.3, ignitions: 4, spool: 0.8,
    plume: 'kerolox', style: 'vacuum', exitRadius: 0.6,
    description: 'Upper-stage engine with a niobium nozzle extension that glows cherry-red in a long burn.',
  }),
  liquidEngine({
    id: 'eng-doldrum', name: 'Doldrum Descent Engine', size: 1, height: 0.8, dryMass: 280, cost: 1500,
    thrustVac: 50_000, ispVac: 322, ispAsl: 230, gimbalDeg: 6, minThrottle: 0.1, ignitions: -1, spool: 0.3,
    plume: 'kerolox', style: 'lander', exitRadius: 0.42,
    description: 'Low-profile deep-throttling lander engine. Designed to hover patiently while you second-guess the landing site.',
  }),
  liquidEngine({
    id: 'eng-chinook', name: 'Chinook Heavy Lifter', size: 2, height: 3.2, dryMass: 3100, cost: 4800,
    thrustVac: 1_050_000, ispVac: 322, ispAsl: 288, gimbalDeg: 4, minThrottle: 0.55, ignitions: 1, spool: 1.4,
    plume: 'kerolox', style: 'lifter', exitRadius: 1.0,
    description: 'A megawatt-class kerolox booster engine. Rattles windows in three counties.',
  }),
  liquidEngine({
    id: 'eng-foehn', name: 'Foehn Hydrolox Upper', size: 2, height: 4.0, dryMass: 1300, cost: 7200,
    thrustVac: 200_000, ispVac: 450, ispAsl: 200, gimbalDeg: 4, minThrottle: 0.4, ignitions: 3, spool: 1.2,
    plume: 'hydrolox', style: 'hydrolox', exitRadius: 1.2,
    description: 'Staged-combustion hydrolox engine with a vast thin bell. Superb efficiency, invisible flame, eye-watering price.',
  }),
  liquidEngine({
    id: 'eng-harmattan', name: 'Harmattan Full-Flow', size: 2, height: 3.0, dryMass: 2400, cost: 6500,
    thrustVac: 900_000, ispVac: 355, ispAsl: 310, gimbalDeg: 5, minThrottle: 0.4, ignitions: 3, spool: 1.0,
    plume: 'methalox', style: 'fullflow', exitRadius: 0.95, maxTemp: 2500,
    description: 'Full-flow staged methalox engine with twin turbopumps. Clean blue flame, restartable, slightly smug.',
  }),
  liquidEngine({
    id: 'eng-tempest', name: 'Tempest Quad Cluster', size: 3, height: 3.6, dryMass: 7800, cost: 11000,
    thrustVac: 3_300_000, ispVac: 326, ispAsl: 290, gimbalDeg: 3, minThrottle: 0.6, ignitions: 1, spool: 1.6,
    plume: 'kerolox', style: 'cluster', exitRadius: 0.72, extra: { bells: 4 },
    description: 'Four gimballed kerolox chambers on one thrust frame. Liftoff becomes less of a question and more of a statement.',
  }),
  {
    id: 'eng-whisper',
    name: 'Whisper Ion Drive',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Gridded xenon ion thruster. Pushes with the force of a held breath, for months on end.',
    category: 'engine',
    dryMass: 220,
    cost: 6000,
    resources: {},
    attachNodes: stackNodes(0.5, 0, 0),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.3125, 0.33, 0.5),
    dragCoefficient: { axial: 0.7, side: 0.9 },
    maxTemp: 1600,
    crashTolerance: 7,
    modules: [
      {
        type: 'engine',
        maxThrustVac: 250,
        ispVac: 4000,
        ispAsl: 100,
        // Volume ratio: ~0.0022 L/s xenon draws ~8 EC/s at full throttle.
        propellants: { xenon: 1, electricCharge: 3600 },
        minThrottle: 0,
        throttleable: true,
        gimbalRange: 0,
        thrustDirection: v(0, 1, 0),
        spoolTime: 0.5,
        plume: 'ion',
        ignitions: -1,
      },
    ],
    mesh: 'ionEngine',
    meshParams: { exitRadius: 0.3 },
  },
  solidMotor({
    id: 'srb-sparkler', name: 'Sparkler Solid Motor', size: 0, height: 2.2, dryMass: 90, cost: 180,
    thrustVac: 32_000, ispVac: 245, ispAsl: 215, segments: 2,
    description: 'Cheap, cheerful and impossible to switch off. A favourite for strap-on kicks and questionable decisions.',
  }),
  solidMotor({
    id: 'srb-roman-candle', name: 'Roman Candle Booster', size: 1, height: 6.0, dryMass: 1200, cost: 900,
    thrustVac: 340_000, ispVac: 250, ispAsl: 220, segments: 3,
    description: 'Segmented 1.25 m solid booster. About seventy seconds of extremely firm encouragement.',
  }),
  solidMotor({
    id: 'srb-thunderclap', name: 'Thunderclap Heavy Booster', size: 2, height: 11.0, dryMass: 8500, cost: 4200,
    thrustVac: 2_400_000, ispVac: 255, ispAsl: 225, segments: 4,
    description: 'Four steel segments packed with seventy-five tonnes of grain. The launch pad will need a moment.',
  }),
];

const coupling: PartDef[] = [
  stackDecoupler('dec-0', 'Snap Ring 0', 0, 0.16, 15, 100, 120, 'A bolted ring with tiny explosive bolts. Small, yes. Polite, no.'),
  stackDecoupler('dec-1', 'Snap Ring 1', 1, 0.22, 50, 300, 300, 'Clean 1.25 m stage separation. The bolts go one way, the spent stage goes the other.'),
  stackDecoupler('dec-2', 'Snap Ring 2', 2, 0.3, 180, 800, 650, 'Heavy-duty 2.5 m decoupler with redundant pyro chains. Twice the bang, half the worry.'),
  stackDecoupler('dec-3', 'Snap Ring 3', 3, 0.36, 400, 1500, 1100, 'Separates 3.75 m stages with the timing of a metronome and the volume of a cannon.'),
  stackDecoupler('sep-1', 'Split Ring 1', 1, 0.26, 70, 450, 380, 'Linear-charge separator that cuts the joint clean through. Leaves nothing behind but confetti.', true),
  stackDecoupler('sep-2', 'Split Ring 2', 2, 0.34, 230, 1100, 800, 'A 2.5 m frangible joint. Engineers describe the sound as "decisive".', true),
  {
    id: 'dec-radial',
    name: 'Side Latch',
    manufacturer: MANUFACTURERS.kettle,
    description: 'Radial separation bracket with a spring piston that shoves boosters politely but firmly away.',
    category: 'coupling',
    dryMass: 40,
    cost: 250,
    resources: {},
    attachNodes: [srfNode(0.24)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: box(0.2, 0.6, 0.24),
    dragCoefficient: { axial: 0.3, side: 0.6 },
    maxTemp: 2000,
    crashTolerance: 9,
    modules: [{ type: 'decoupler', ejectionImpulse: 400, node: 'srf', radial: true }],
    mesh: 'radialDecoupler',
  },
  dockingPort('dock-0', 'Mooring Collar 0', 0, 0.2, 25, 280, { range: 0.75, speed: 0.5, angleDeg: 15 },
    'A pocket-sized androgynous docking ring for probes. Three guide petals, six latches and an unshakeable belief that you meant to line up.'),
  dockingPort('dock-1', 'Mooring Collar 1', 1, 0.28, 70, 520, { range: 1.0, speed: 0.6, angleDeg: 15 },
    'The everyday 1.25 m docking collar. Magnetic soft-capture pulls the last metre for you; the latches do the rest with a satisfying clunk.'),
  dockingPort('dock-2', 'Mooring Collar 2', 2, 0.4, 240, 1200, { range: 1.25, speed: 0.4, angleDeg: 12 },
    'Station-grade 2.5 m berthing ring with a wide crew tunnel. Forgiving of lateral offset, unforgiving of haste.'),
];

const structural: PartDef[] = [
  adapter('adapt-0-1', 'Taper 0-1', 0, 1, 0.5, 40, 120, 'Steps a 0.625 m stack up to 1.25 m. Smoothly. Mostly.'),
  adapter('adapt-1-2', 'Taper 1-2', 1, 2, 1.2, 200, 350, 'Interstage cone bridging 1.25 m and 2.5 m. Stringered, riveted, quietly heroic.'),
  adapter('adapt-2-3', 'Taper 2-3', 2, 3, 1.5, 520, 700, 'A broad 2.5 to 3.75 m skirt for when the rocket gets wider at the bottom, as rockets do.'),
  {
    id: 'girder',
    name: 'Lattice Girder',
    manufacturer: MANUFACTURERS.tessellate,
    description: 'Two metres of welded truss. Holds things apart, holds things up, holds no grudges.',
    category: 'structural',
    dryMass: 60,
    cost: 90,
    resources: {},
    attachNodes: stackNodes(2.0, 0, 0),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: box(0.36, 2.0, 0.36),
    dragCoefficient: { axial: 0.6, side: 0.6 },
    maxTemp: 2000,
    crashTolerance: 12,
    modules: [],
    mesh: 'girder',
  },
  {
    id: 'strut',
    name: 'Tension Strut',
    manufacturer: MANUFACTURERS.tessellate,
    description: 'A purely reassuring rod. Vehicles here are rigid already, but it does look the part.',
    category: 'structural',
    dryMass: 5,
    cost: 30,
    resources: {},
    attachNodes: [srfNode(0.12)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.08, 1.2, 0.12),
    dragCoefficient: { axial: 0.1, side: 0.3 },
    maxTemp: 2000,
    crashTolerance: 12,
    modules: [],
    mesh: 'strut',
    meshParams: { length: 1.2 },
  },
];

const aero: PartDef[] = [
  noseCone('nose-0', 'Spire 0 Nose Cone', 0, 0.9, 12, 60, 'Ogive tip for slender stacks. Points the right way, and that is half the battle.'),
  noseCone('nose-1', 'Spire 1 Nose Cone', 1, 2.0, 70, 160, 'A tangent-ogive cone with an ablative tip. Cuts through the air like it has somewhere to be.'),
  noseCone('nose-2', 'Spire 2 Nose Cone', 2, 4.0, 320, 400, 'Big aerodynamic cap for big stacks. Doubles as a dramatic silhouette at sunset.'),
  {
    id: 'fairing-1',
    name: 'Clamshell Fairing 1',
    manufacturer: MANUFACTURERS.greywater,
    description: 'A 1.25 m base with a two-piece shroud that keeps fragile payloads out of the wind until it pops open.',
    category: 'aero',
    dryMass: 180,
    cost: 500,
    resources: {},
    attachNodes: stackNodes(0.2, 1, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.625, 0.625, 0.2),
    dragCoefficient: { axial: 0.25, side: 0.9 },
    maxTemp: 2200,
    crashTolerance: 8,
    modules: [{ type: 'fairing', ejectionImpulse: 150 }],
    mesh: 'fairing',
    meshParams: { shellRadius: 0.72, shellHeight: 3.6 },
  },
  {
    id: 'fairing-2',
    name: 'Clamshell Fairing 2',
    manufacturer: MANUFACTURERS.greywater,
    description: 'Composite 2.5 m payload shroud. Splits along its spine with a satisfying crack.',
    category: 'aero',
    dryMass: 620,
    cost: 1200,
    resources: {},
    attachNodes: stackNodes(0.3, 2, 2),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(1.25, 1.25, 0.3),
    dragCoefficient: { axial: 0.25, side: 0.9 },
    maxTemp: 2200,
    crashTolerance: 8,
    modules: [{ type: 'fairing', ejectionImpulse: 400 }],
    mesh: 'fairing',
    meshParams: { shellRadius: 1.4, shellHeight: 6.5 },
  },
  liftingSurface({
    id: 'fin-keel', name: 'Keel Fin', dryMass: 30, cost: 80,
    rootChord: 1.0, tipChord: 0.45, span: 0.75, sweep: 0.45, thickness: 0.06, liftSlope: 4.0, deflectionDeg: 0, ctrlFraction: 0, mesh: 'fin',
    description: 'Fixed swept tail fin. Keeps the pointy end forward without any electronics whatsoever.',
  }),
  liftingSurface({
    id: 'fin-pivot', name: 'Pivot Winglet', dryMass: 45, cost: 260,
    rootChord: 0.9, tipChord: 0.5, span: 0.7, sweep: 0.25, thickness: 0.06, liftSlope: 4.2, deflectionDeg: 20, ctrlFraction: 0.35, mesh: 'fin', category: 'control',
    description: 'Tail fin with a powered trailing-edge flap. Steers in thick air when the gimbal runs out of opinions.',
  }),
  liftingSurface({
    id: 'ctrl-elevon', name: 'Trim Elevon', dryMass: 25, cost: 200,
    rootChord: 0.35, tipChord: 0.35, span: 1.0, sweep: 0, thickness: 0.05, liftSlope: 4.5, deflectionDeg: 25, ctrlFraction: 1, mesh: 'controlSurface', category: 'control',
    description: 'All-moving control surface. Bolt it to a trailing edge and argue with physics directly.',
  }),
  liftingSurface({
    id: 'wing-delta', name: 'Arrowhead Delta Wing', dryMass: 380, cost: 900,
    rootChord: 3.2, tipChord: 0.35, span: 2.6, sweep: 2.6, thickness: 0.16, liftSlope: 3.6, deflectionDeg: 0, ctrlFraction: 0, mesh: 'wing',
    description: 'A sharp delta with honeycomb skins. Lands fast, climbs faster, looks fantastic doing both.',
  }),
  liftingSurface({
    id: 'wing-plank', name: 'Plank Wing Panel', dryMass: 110, cost: 300,
    rootChord: 1.0, tipChord: 1.0, span: 2.0, sweep: 0, thickness: 0.1, liftSlope: 5.0, deflectionDeg: 0, ctrlFraction: 0, mesh: 'wing',
    description: 'A straight wing section for builders who think in rectangles. Tile as required.',
  }),
  liftingSurface({
    id: 'wing-swept', name: 'Swept Wing Section', dryMass: 240, cost: 650,
    rootChord: 2.0, tipChord: 0.8, span: 3.0, sweep: 1.6, thickness: 0.12, liftSlope: 4.8, deflectionDeg: 0, ctrlFraction: 0, mesh: 'wing',
    description: 'Moderately swept wing with a tidy taper. Transonic manners, airliner posture.',
  }),
];

const control: PartDef[] = [
  {
    id: 'rcs-nudge',
    name: 'Nudge RCS Quad',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'Four hydrazine thrusters on one block. For docking, fine pointing and dramatic little puffs.',
    category: 'control',
    dryMass: 25,
    cost: 450,
    resources: {},
    attachNodes: [srfNode(0.2)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.34, 0.34, 0.2),
    dragCoefficient: { axial: 0.3, side: 0.5 },
    maxTemp: 1800,
    crashTolerance: 10,
    modules: [
      {
        type: 'rcs',
        thrustPerNozzle: 500,
        ispVac: 220,
        ispAsl: 100,
        nozzles: [
          { position: v(0, 0.15, 0.04), direction: v(0, 1, 0) },
          { position: v(0, -0.15, 0.04), direction: v(0, -1, 0) },
          { position: v(0.15, 0, 0.04), direction: v(1, 0, 0) },
          { position: v(-0.15, 0, 0.04), direction: v(-1, 0, 0) },
        ],
      },
    ],
    mesh: 'rcsQuad',
  },
  {
    id: 'wheel-gyre-0',
    name: 'Gyre 0 Reaction Wheel',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'Three spinning flywheels in a 0.625 m puck. Turns probes without spending a single drop.',
    category: 'control',
    dryMass: 40,
    cost: 500,
    resources: {},
    attachNodes: stackNodes(0.2, 0, 0),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.3125, 0.3125, 0.2),
    dragCoefficient: { axial: 0.8, side: 0.9 },
    maxTemp: 1600,
    crashTolerance: 9,
    modules: [{ type: 'reactionWheel', torque: 1500, ecRate: 0.2 }],
    mesh: 'reactionWheel',
  },
  {
    id: 'wheel-gyre-1',
    name: 'Gyre 1 Reaction Wheel',
    manufacturer: MANUFACTURERS.brightfield,
    description: 'A 1.25 m control-moment unit with a hum you can feel in your fillings.',
    category: 'control',
    dryMass: 120,
    cost: 1100,
    resources: {},
    attachNodes: stackNodes(0.3, 1, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.625, 0.625, 0.3),
    dragCoefficient: { axial: 0.8, side: 0.9 },
    maxTemp: 1600,
    crashTolerance: 9,
    modules: [{ type: 'reactionWheel', torque: 6000, ecRate: 0.5 }],
    mesh: 'reactionWheel',
  },
];

const electrical: PartDef[] = [
  {
    id: 'battery-brick',
    name: 'Cell Brick',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Radial battery pack with a cheerful charge indicator nobody can see from orbit.',
    category: 'electrical',
    dryMass: 8,
    cost: 120,
    resources: { electricCharge: 100 },
    attachNodes: [srfNode(0.1)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.3, 0.2, 0.1),
    dragCoefficient: { axial: 0.3, side: 0.5 },
    maxTemp: 1400,
    crashTolerance: 8,
    modules: [{ type: 'battery' }],
    mesh: 'battery',
    meshParams: { style: 'radial' },
  },
  {
    id: 'battery-drum',
    name: 'Cell Drum 1',
    manufacturer: MANUFACTURERS.lumen,
    description: 'A 1.25 m ring of lithium modules. Keeps the lights on through the longest lunar night (some restrictions apply).',
    category: 'electrical',
    dryMass: 60,
    cost: 650,
    resources: { electricCharge: 1000 },
    attachNodes: stackNodes(0.25, 1, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.625, 0.625, 0.25),
    dragCoefficient: { axial: 0.8, side: 0.9 },
    maxTemp: 1400,
    crashTolerance: 8,
    modules: [{ type: 'battery' }],
    mesh: 'battery',
    meshParams: { style: 'stack' },
  },
  {
    id: 'solar-patch',
    name: 'Sunpatch Fixed Panel',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Rigid photovoltaic tile. No moving parts, no drama, no tracking.',
    category: 'electrical',
    dryMass: 10,
    cost: 200,
    resources: {},
    attachNodes: [srfNode(0.04)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.6, 1.0, 0.04),
    dragCoefficient: { axial: 0.1, side: 1.1 },
    maxTemp: 1300,
    crashTolerance: 6,
    modules: [{ type: 'solarPanel', chargeRate: 0.35, tracking: false }],
    mesh: 'solarFixed',
  },
  {
    id: 'solar-fold',
    name: 'Sunfold Array',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Accordion-folded panels on a sun-tracking boom. Unfolds with the grace of a well-trained origami crane.',
    category: 'electrical',
    dryMass: 25,
    cost: 600,
    resources: {},
    attachNodes: [srfNode(0.16)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.44, 0.5, 0.16),
    dragCoefficient: { axial: 0.3, side: 0.6 },
    maxTemp: 1300,
    crashTolerance: 6,
    modules: [{ type: 'solarPanel', chargeRate: 1.5, tracking: true }],
    mesh: 'solarDeploy',
    meshParams: { panels: 4, panelLength: 0.48, panelWidth: 0.42 },
  },
  {
    id: 'solar-wing',
    name: 'Sunwing Array',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Large tracking array with six panels per wing. Gets very upset about atmospheric flight.',
    category: 'electrical',
    dryMass: 90,
    cost: 1500,
    resources: {},
    attachNodes: [srfNode(0.24)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.82, 0.9, 0.24),
    dragCoefficient: { axial: 0.3, side: 0.6 },
    maxTemp: 1300,
    crashTolerance: 6,
    modules: [{ type: 'solarPanel', chargeRate: 4.5, tracking: true }],
    mesh: 'solarDeploy',
    meshParams: { panels: 6, panelLength: 0.85, panelWidth: 0.8 },
  },
];

const utility: PartDef[] = [
  {
    id: 'chute-main',
    name: 'Bloom Main Parachute',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Packed main canopy that opens to a 24 m ringsail. Turns a fall into a float.',
    category: 'utility',
    dryMass: 100,
    cost: 420,
    resources: {},
    attachNodes: stackNodes(0.35, null, 0),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.26, 0.3125, 0.35),
    dragCoefficient: { axial: 0.6, side: 0.8 },
    maxTemp: 1700,
    crashTolerance: 10,
    modules: [{ type: 'parachute', deployedCdA: 420, semiCdA: 8, minPressure: 4000, deployAltitude: 1000, maxQ: 25_000 }],
    mesh: 'parachute',
    meshParams: { style: 'stack', canopyRadius: 12, colors: 'orange' },
  },
  {
    id: 'chute-drogue',
    name: 'Tug Drogue Chute',
    manufacturer: MANUFACTURERS.northlight,
    description: 'A small, tough drogue that steadies a tumbling capsule at speeds the main chute would rather not discuss.',
    category: 'utility',
    dryMass: 50,
    cost: 300,
    resources: {},
    attachNodes: stackNodes(0.25, null, 0),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.24, 0.3125, 0.25),
    dragCoefficient: { axial: 0.6, side: 0.8 },
    maxTemp: 1900,
    crashTolerance: 10,
    modules: [{ type: 'parachute', deployedCdA: 30, semiCdA: 3, minPressure: 1500, deployAltitude: 3500, maxQ: 70_000 }],
    mesh: 'parachute',
    meshParams: { style: 'stack', canopyRadius: 3, colors: 'red' },
  },
  {
    id: 'chute-radial',
    name: 'Bloom Side Parachute',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Radially mounted canopy pack. Clusters nicely; every capsule deserves a bouquet.',
    category: 'utility',
    dryMass: 70,
    cost: 350,
    resources: {},
    attachNodes: [srfNode(0.22)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.22, 0.4, 0.22),
    dragCoefficient: { axial: 0.4, side: 0.6 },
    maxTemp: 1700,
    crashTolerance: 10,
    modules: [{ type: 'parachute', deployedCdA: 300, semiCdA: 6, minPressure: 4000, deployAltitude: 1000, maxQ: 25_000 }],
    mesh: 'parachute',
    meshParams: { style: 'radial', canopyRadius: 10, colors: 'white' },
  },
  {
    id: 'shield-1',
    name: 'Ember Shield 1',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Tiled 1.25 m ablative heat shield. Chars beautifully so the crew does not.',
    category: 'utility',
    dryMass: 120,
    cost: 600,
    resources: { ablator: 150 },
    attachNodes: stackNodes(0.2, 1, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.625, 0.66, 0.2),
    dragCoefficient: { axial: 1.2, side: 0.9 },
    maxTemp: 3400,
    crashTolerance: 12,
    modules: [{ type: 'heatShield', ablationRate: 0.05, maxTemp: 3400 }],
    mesh: 'heatShield',
  },
  {
    id: 'shield-2',
    name: 'Ember Shield 2',
    manufacturer: MANUFACTURERS.northlight,
    description: 'A 2.5 m shield for lunar-return speeds. Every tile individually blessed by the night shift.',
    category: 'utility',
    dryMass: 450,
    cost: 1800,
    resources: { ablator: 600 },
    attachNodes: stackNodes(0.35, 2, 2),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: false,
    shape: cyl(1.25, 1.31, 0.35),
    dragCoefficient: { axial: 1.2, side: 0.9 },
    maxTemp: 3600,
    crashTolerance: 12,
    modules: [{ type: 'heatShield', ablationRate: 0.05, maxTemp: 3600 }],
    mesh: 'heatShield',
  },
  {
    id: 'leg-stilt',
    name: 'Stilt Landing Leg',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Folding leg with a crushable damper and a dinner-plate foot. Good for probes and light landers.',
    category: 'ground',
    dryMass: 50,
    cost: 350,
    resources: {},
    attachNodes: [srfNode(0.2, 0.15)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.2, 1.0, 0.2),
    dragCoefficient: { axial: 0.3, side: 0.5 },
    maxTemp: 1800,
    crashTolerance: 12,
    modules: [{ type: 'landingLeg', spring: 40_000, damper: 4_000, travel: 0.3, footPosition: landingLegLayout(1).contact }],
    mesh: 'landingLeg',
    meshParams: { scale: 1 },
  },
  {
    id: 'leg-strider',
    name: 'Strider Landing Leg',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Heavy lander leg with a twin-cylinder shock strut. Rated for crewed landers and overconfident pilots.',
    category: 'ground',
    dryMass: 160,
    cost: 800,
    resources: {},
    attachNodes: [srfNode(0.36, 0.27)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.36, 1.8, 0.36),
    dragCoefficient: { axial: 0.3, side: 0.5 },
    maxTemp: 1800,
    crashTolerance: 14,
    modules: [{ type: 'landingLeg', spring: 150_000, damper: 15_000, travel: 0.5, footPosition: landingLegLayout(1.8).contact }],
    mesh: 'landingLeg',
    meshParams: { scale: 1.8 },
  },
  {
    id: 'light-beacon',
    name: 'Beacon Floodlamp',
    manufacturer: MANUFACTURERS.northlight,
    description: 'A rugged floodlamp for night landings, EVA work and finding your keys in the lunar regolith.',
    category: 'utility',
    dryMass: 6,
    cost: 90,
    resources: {},
    attachNodes: [srfNode(0.14)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.18, 0.18, 0.14),
    dragCoefficient: { axial: 0.3, side: 0.5 },
    maxTemp: 1400,
    crashTolerance: 8,
    modules: [{ type: 'light' }],
    mesh: 'light',
  },
];

// ---------------------------------------------------------------------------------------------
// Aircraft: jet engines, intakes, fuselage, landing gear, wings
// ---------------------------------------------------------------------------------------------

interface JetSpec {
  id: string;
  name: string;
  description: string;
  height: number;
  dryMass: number;
  cost: number;
  /** Static sea-level thrust, N. */
  thrust: number;
  /** Fuel-specific impulse, s. */
  isp: number;
  machCurve: [number, number][];
  densityExponent: number;
  airRatio: number;
  spool: number;
  plume: 'jet' | 'afterburner';
  exitRadius: number;
}

function jetEngine(s: JetSpec): PartDef {
  const r = SIZE_RADIUS[1];
  return {
    id: s.id,
    name: s.name,
    manufacturer: MANUFACTURERS.aldercrest,
    description: s.description,
    category: 'engine',
    dryMass: s.dryMass,
    cost: s.cost,
    resources: {},
    attachNodes: stackNodes(s.height, 1, 1),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: cyl(r, r, s.height),
    dragCoefficient: { axial: 0.35, side: 0.9 },
    maxTemp: 2000,
    crashTolerance: 8,
    modules: [
      {
        type: 'engine',
        maxThrustVac: s.thrust,
        ispVac: s.isp,
        ispAsl: s.isp,
        propellants: { liquidFuel: 1 },
        minThrottle: 0,
        throttleable: true,
        gimbalRange: 0,
        thrustDirection: v(0, 1, 0),
        spoolTime: s.spool,
        plume: s.plume,
        ignitions: -1,
        airBreathing: { machCurve: s.machCurve, densityExponent: s.densityExponent, airRatio: s.airRatio },
      },
    ],
    mesh: 'jetEngine',
    meshParams: { style: s.plume === 'afterburner' ? 'afterburner' : 'turbofan', exitRadius: s.exitRadius },
  };
}

/** Fuel-only (no oxidiser) fuselage section. */
function fuselage(id: string, name: string, sizeTop: number, sizeBottom: number | null, length: number, rBottom: number, litres: number, dryMass: number, cost: number, style: 'tank' | 'tailcone' | 'adapter', description: string): PartDef {
  return {
    id,
    name,
    manufacturer: MANUFACTURERS.tessellate,
    description,
    category: litres > 0 ? 'fuelTank' : 'structural',
    dryMass,
    cost,
    resources: litres > 0 ? { liquidFuel: litres } : {},
    attachNodes: stackNodes(length, sizeTop, sizeBottom),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: cyl(SIZE_RADIUS[sizeTop], rBottom, length),
    dragCoefficient: { axial: style === 'tank' ? 0.3 : 0.2, side: 0.9 },
    maxTemp: 1700,
    crashTolerance: 10,
    modules: [],
    mesh: 'fuselage',
    meshParams: { style },
  };
}

/**
 * Landing-gear kinematics shared with the mesh builder. The gear hangs along part +Z from a hinge just
 * outside the mount face; `fold` = +1 folds the strut rearward (toward -Y) when stowed, -1 forward, 0 = fixed.
 */
export function gearLayout(radius: number, strut: number, fold: -1 | 0 | 1) {
  const depth = 2 * radius + 0.06;
  const mountZ = -depth / 2;
  const hinge = v(0, (fold * strut) / 2, mountZ + radius + 0.03);
  const wheelCenter = v(0, hinge.y, hinge.z + strut);
  const width = Math.max(0.24, radius * 1.1);
  return { depth, mountZ, hinge, wheelCenter, width, stowedAngle: (fold * Math.PI) / 2, tyreWidth: radius * 0.75, size: v(width, strut + 2 * radius, depth) };
}

interface GearSpec {
  id: string;
  name: string;
  description: string;
  dryMass: number;
  cost: number;
  radius: number;
  strut: number;
  fold: -1 | 0 | 1;
  spring: number;
  damper: number;
  travel: number;
  brakeTorque: number;
  steerDeg?: number;
  crashTolerance: number;
}

function landingGear(s: GearSpec): PartDef {
  const L = gearLayout(s.radius, s.strut, s.fold);
  return {
    id: s.id,
    name: s.name,
    manufacturer: MANUFACTURERS.tread,
    description: s.description,
    category: 'ground',
    dryMass: s.dryMass,
    cost: s.cost,
    resources: {},
    attachNodes: [srfNode(L.depth)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(L.size.x, L.size.y, L.size.z),
    dragCoefficient: { axial: 0.5, side: 0.7 },
    maxTemp: 1500,
    crashTolerance: s.crashTolerance,
    modules: [
      {
        type: 'wheel',
        radius: s.radius,
        spring: s.spring,
        damper: s.damper,
        travel: s.travel,
        wheelCenter: L.wheelCenter,
        brakeTorque: s.brakeTorque,
        ...(s.steerDeg ? { steerAngle: s.steerDeg * DEG } : {}),
        retractable: s.fold !== 0,
      },
    ],
    mesh: 'gear',
    meshParams: { radius: s.radius, strut: s.strut, fold: s.fold, steerable: !!s.steerDeg },
  };
}

const aircraft: PartDef[] = [
  jetEngine({
    id: 'jet-kittiwake', name: 'Kittiwake Turbofan', height: 2.4, dryMass: 900, cost: 2400,
    thrust: 55_000, isp: 6500, spool: 1.6, plume: 'jet', exitRadius: 0.42,
    machCurve: [[0, 1], [0.3, 0.93], [0.6, 0.92], [0.9, 0.95], [1.1, 0.8], [1.35, 0.4], [1.55, 0.08], [1.65, 0]],
    densityExponent: 0.7, airRatio: 22,
    description: 'High-bypass turbofan with a fan you could lose a hat in. Sips fuel, hums politely, gives up past Mach 1.5.',
  }),
  jetEngine({
    id: 'jet-shrike', name: 'Shrike Afterburning Turbojet', height: 3.2, dryMass: 1300, cost: 4200,
    thrust: 70_000, isp: 2800, spool: 1.2, plume: 'afterburner', exitRadius: 0.46,
    machCurve: [[0, 1], [0.6, 1.05], [1.0, 1.3], [1.6, 1.65], [2.2, 1.9], [2.6, 1.85], [3.0, 1.25], [3.3, 0.55], [3.55, 0]],
    densityExponent: 0.75, airRatio: 8,
    description: 'Straight turbojet with a reheat section bolted on the back. Comes alive above Mach 1 and drinks like it.',
  }),
  {
    id: 'intake-gill',
    name: 'Gill Radial Intake',
    manufacturer: MANUFACTURERS.aldercrest,
    description: 'Side-mounted scoop that feeds engines with whatever the sky is offering. Needs a little speed to really breathe.',
    category: 'aero',
    dryMass: 40,
    cost: 220,
    resources: { intakeAir: 0.1 },
    attachNodes: [srfNode(0.3)],
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: box(0.36, 1.0, 0.3),
    dragCoefficient: { axial: 0.3, side: 0.6 },
    maxTemp: 1700,
    crashTolerance: 9,
    modules: [{ type: 'intake', area: 0.22 }],
    mesh: 'intake',
    meshParams: { style: 'radial' },
  },
  {
    id: 'intake-snout',
    name: 'Snout Inline Intake',
    manufacturer: MANUFACTURERS.aldercrest,
    description: 'Pitot nose intake with a spike in the middle. Swallows enough air for any single engine, standing still or supersonic.',
    category: 'aero',
    dryMass: 90,
    cost: 500,
    resources: { intakeAir: 0.2 },
    attachNodes: stackNodes(1.0, null, 1),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.56, 0.625, 1.0),
    dragCoefficient: { axial: 0.25, side: 0.9 },
    maxTemp: 1900,
    crashTolerance: 9,
    modules: [{ type: 'intake', area: 0.45 }],
    mesh: 'intake',
    meshParams: { style: 'inline' },
  },
  {
    id: 'cockpit-skylark',
    name: 'Skylark Canopy Cockpit',
    manufacturer: MANUFACTURERS.northlight,
    description: 'Single-seat bubble canopy on a pointed nose. Superb visibility, an ejection handle nobody has dared to pull.',
    category: 'command',
    dryMass: 850,
    cost: 2600,
    resources: { electricCharge: 80 },
    attachNodes: stackNodes(2.4, null, 1),
    surfaceAttachable: false,
    allowSurfaceAttachChildren: true,
    shape: cyl(0.12, 0.625, 2.4),
    dragCoefficient: { axial: 0.18, side: 0.9 },
    maxTemp: 1800,
    crashTolerance: 10,
    modules: [
      { type: 'command', crew: 1, sasLevel: 1, ecPerSecond: 0.02 },
      { type: 'reactionWheel', torque: 1500, ecRate: 0.1 },
    ],
    mesh: 'cockpit',
  },
  fuselage('fuse-spar', 'Spar Fuselage Tank', 1, 1, 2.5, 0.625, 900, 180, 450, 'tank',
    'Riveted 1.25 m fuselage barrel with an integral fuel cell and room for the wing spar. The backbone of most jets.'),
  fuselage('fuse-spar-short', 'Spar Fuselage Stub', 1, 1, 1.25, 0.625, 420, 95, 260, 'tank',
    'Half-length fuselage barrel for tuning the balance of a design. Also holds fuel, as fuselages should.'),
  fuselage('fuse-reducer', 'Spar Reducer 1-0', 1, 0, 1.2, SIZE_RADIUS[0], 300, 70, 240, 'adapter',
    'Tapered fuselage section stepping down to 0.625 m, with a fuel cell in the fat end.'),
  fuselage('fuse-tailcone', 'Taper Tailcone', 1, null, 1.8, 0.18, 0, 80, 180, 'tailcone',
    'Smooth aft closure for a fuselage. Cuts base drag and gives the tail fin somewhere dignified to live.'),
  landingGear({
    id: 'gear-skid', name: 'Skid Fixed Gear', dryMass: 30, cost: 120, radius: 0.2, strut: 0.35, fold: 0,
    spring: 50_000, damper: 5_000, travel: 0.12, brakeTorque: 600, crashTolerance: 10,
    description: 'Fixed spring-leg wheel for light aircraft and rovers. No hydraulics to fail, no drag savings either.',
  }),
  landingGear({
    id: 'gear-trundle', name: 'Trundle Nose Gear', dryMass: 70, cost: 450, radius: 0.24, strut: 0.85, fold: -1, steerDeg: 35,
    spring: 70_000, damper: 8_000, travel: 0.22, brakeTorque: 300, crashTolerance: 12,
    description: 'Steerable nose leg with an oleo strut that folds forward into the belly. Turns with the rudder pedals.',
  }),
  landingGear({
    id: 'gear-bogie', name: 'Bogie Main Gear', dryMass: 130, cost: 700, radius: 0.34, strut: 1.05, fold: 1,
    spring: 150_000, damper: 16_000, travel: 0.28, brakeTorque: 6_000, crashTolerance: 14,
    description: 'Heavy retractable main leg with carbon brakes. Takes a firm landing without complaint, and a soft one with pride.',
  }),
  liftingSurface({
    id: 'wing-broadleaf', name: 'Broadleaf Wing', dryMass: 420, cost: 1100,
    rootChord: 3.0, tipChord: 1.3, span: 4.4, sweep: 1.3, thickness: 0.18, liftSlope: 5.0, deflectionDeg: 0, ctrlFraction: 0, mesh: 'wing',
    description: 'Generous, gently swept main wing. Lifts a light jet off the runway at a very civilised speed.',
  }),
  liftingSurface({
    id: 'tail-hawk', name: 'Hawktail Stabilizer', dryMass: 70, cost: 380,
    rootChord: 1.5, tipChord: 0.7, span: 1.5, sweep: 0.9, thickness: 0.08, liftSlope: 4.2, deflectionDeg: 22, ctrlFraction: 0.45, mesh: 'fin', category: 'control',
    description: 'Tail surface with a hinged trailing edge: mount it upright as a fin and rudder, or flat as a tailplane and elevator.',
  }),
];

/** Compact radial instrument housings and telemetry arrays. */
const scienceParts: PartDef[] = [
  ['sensor-thermal', 'Ember Thermometer Probe', 'temperature', 5, 180],
  ['sensor-pressure', 'Isobar Pressure Capsule', 'pressure', 8, 250],
  ['sensor-seismic', 'Tremor Seismic Sensor', 'seismic', 18, 650],
  ['sensor-magnetic', 'Flux Magnetometer Boom', 'magnetic', 22, 900],
  ['sensor-gravity', 'Contour Gravity Gradiometer', 'gravity', 35, 1400],
  ['sensor-exposure', 'Patina Material Exposure Bay', 'exposure', 65, 1900],
].map(([id, name, experiment, mass, cost]) => ({
  id: String(id), name: String(name), manufacturer: MANUFACTURERS.brightfield,
  description: 'Records environmental measurements for the research archive. Return the hardware for full science credit.',
  category: 'science', dryMass: Number(mass), cost: Number(cost), resources: {},
  attachNodes: [srfNode(0.2)], surfaceAttachable: true, allowSurfaceAttachChildren: false,
  shape: box(0.3, 0.35, 0.2), dragCoefficient: { axial: 0.3, side: 0.5 }, maxTemp: 1400, crashTolerance: 10,
  modules: [{ type: 'science', experiment: String(experiment) }], mesh: 'instrument',
}));
const antennas: PartDef[] = [0, 1].map(i => ({
  id: i ? 'antenna-relay' : 'antenna-thread', name: i ? 'Lattice Relay Array' : 'Thread Telemetry Aerial',
  manufacturer: MANUFACTURERS.lumen, description: `Transmits ${i ? 65 : 40}% of recorded science. Recover hardware for the balance.`,
  category: 'electrical', dryMass: i ? 35 : 5, cost: i ? 1200 : 120, resources: {},
  attachNodes: [srfNode(0.15)], surfaceAttachable: true, allowSurfaceAttachChildren: false,
  shape: box(0.2, i ? 0.8 : 0.4, 0.15), dragCoefficient: { axial: 0.2, side: 0.4 }, maxTemp: 1400, crashTolerance: 10,
  modules: [{ type: 'antenna', transmission: i ? 0.65 : 0.4 }], mesh: 'instrument',
}));

/** Expansion hardware shares the catalogue frame and resource conventions above. */
function hardware(id: string, name: string, category: PartDef['category'], mass: number, cost: number,
  shape: PartDef['shape'], mesh: string, modules: PartModule[] = [], params: PartDef['meshParams'] = {},
  size?: number, description = 'Modular expedition hardware with reinforced attachment fittings and accessible service connections.'): PartDef {
  const depth = shape.kind === 'box' ? shape.size.z : shape.radiusTop * 2;
  return { id, name, category, dryMass: mass, cost, shape, mesh, modules, meshParams: params, description,
    manufacturer: category === 'electrical' ? MANUFACTURERS.lumen : category === 'ground' ? MANUFACTURERS.tread : category === 'command' || category === 'utility' ? MANUFACTURERS.northlight : category === 'science' ? MANUFACTURERS.brightfield : MANUFACTURERS.tessellate,
    resources: {}, attachNodes: size === undefined ? [srfNode(depth)] : stackNodes(shape.kind === 'box' ? shape.size.y : shape.height, size, size),
    surfaceAttachable: size === undefined, allowSurfaceAttachChildren: true,
    dragCoefficient: { axial: 0.6, side: 0.9 }, maxTemp: 1600, crashTolerance: 12 };
}
function expandedEngine(id: string, name: string, size: number, height: number, mass: number, cost: number,
  thrust: number, vac: number, asl: number, style: EngineSpec['style'], plume: EngineSpec['plume'], exitRadius: number): PartDef {
  return liquidEngine({ id, name, size, height, dryMass: mass, cost, thrustVac: thrust, ispVac: vac, ispAsl: asl,
    style, plume, exitRadius, gimbalDeg: 4, minThrottle: 0.15, ignitions: -1, spool: 0.6,
    description: `${name} provides restartable propulsion with reinforced feed ducts and an actively cooled thrust chamber.` });
}
const expansion: PartDef[] = [
  fuelTank('tank-4-short', 'Cistern 5-25 Tank', 4, 2.5, 'white', 'Five metre propellant reservoir with shallow domes and redundant fill manifolds for heavy orbital stacks.'),
  fuelTank('tank-4-mid', 'Cistern 5-50 Tank', 4, 5, 'orange', 'Insulated five metre reservoir for large launchers. Internal baffles suppress propellant slosh during ascent.'),
  fuelTank('tank-4-long', 'Cistern 5-100 Tank', 4, 10, 'white', 'Long five metre booster reservoir with an external service raceway and reinforced skirt attachments.'),
  { ...expandedEngine('eng-monsoon', 'Monsoon Heavy Cluster', 4, 4.5, 14000, 23000, 6200000, 330, 295, 'cluster', 'kerolox', 0.95),
    meshParams: { style: 'cluster', exitRadius: 0.95, bells: 4, nozzleSegments: 18, nozzleRings: 7 } },
  adapter('adapt-3-4', 'Bellmouth 375-500 Adapter', 3, 4, 1.5, 680, 1600, 'Five metre load spreader with a tapered shell and uninterrupted propellant crossfeed.'),
  stackDecoupler('dec-4', 'Breakwater 500 Decoupler', 4, 0.3, 620, 9000, 2100, 'Heavy five metre separation ring with distributed explosive bolts and balanced ejector springs.'),
  { ...hardware('shield-4', 'Cinder 500 Heat Shield', 'utility', 1800, 6200, cyl(2.5, 2.62, 0.5), 'heatShield', [{ type: 'heatShield', ablationRate: 0.05, maxTemp: 3600 }], {}, 4), resources: { ablator: 2400 }, maxTemp: 3600 },
  noseCone('nose-4', 'Spire 500 Nose Cone', 4, 3.8, 550, 1400, 'Ogive cap for five metre boosters, with a flush tip and a lightweight ribbed internal shell.'),
  { ...expandedEngine('eng-hearth', 'Hearth Thermal Drive', 1, 3.2, 3000, 26000, 65000, 850, 185, 'vacuum', 'hydrolox', 0.6), mesh: 'nuclearEngine',
    modules: [{ type: 'engine', maxThrustVac: 65000, ispVac: 850, ispAsl: 185, propellants: { liquidFuel: 1 }, minThrottle: 0.2,
      throttleable: true, gimbalRange: 3 * DEG, thrustDirection: v(0,1,0), spoolTime: 2, plume: 'hydrolox', ignitions: -1 }],
    description: 'Shielded nuclear thermal reactor heats liquid fuel without oxidizer. Heavy hardware trades low thrust for exceptional vacuum efficiency.' },
  expandedEngine('eng-mistral', 'Mistral Methalox Engine', 0, 1.1, 150, 1000, 28000, 355, 305, 'fullflow', 'methalox', 0.27),
  expandedEngine('eng-boreal', 'Boreal Methalox Engine', 1, 1.8, 950, 3400, 350000, 365, 320, 'fullflow', 'methalox', 0.53),
  { ...expandedEngine('eng-needle', 'Needle Annular Aerospike', 1, 1.1, 1050, 4600, 240000, 340, 330, 'compact', 'methalox', 0.5), mesh: 'aerospike',
    description: 'Annular combustion chambers surround a truncated expansion plug. Pressure compensation keeps specific impulse nearly constant.' },
  { ...expandedEngine('eng-dewdrop', 'Dewdrop Maneuver Engine', 0, 0.45, 25, 280, 2500, 240, 100, 'compact', 'kerolox', 0.12),
    modules: [{ type: 'engine', maxThrustVac: 2500, ispVac: 240, ispAsl: 100, propellants: { monopropellant: 1 }, minThrottle: 0,
      throttleable: true, gimbalRange: 0, thrustDirection: v(0,1,0), spoolTime: 0, plume: 'monoprop', ignitions: -1 }] },
  solidMotor({ id: 'srb-reed', name: 'Reed Tall Booster', size: 1, height: 9, dryMass: 1700, cost: 2400, thrustVac: 450000, ispVac: 275, ispAsl: 245, segments: 4, description: 'Tall composite booster for medium and heavy launchers, with a segmented grain and fixed expansion nozzle.' }),
  solidMotor({ id: 'srb-furnace', name: 'Furnace Heavy Booster', size: 2, height: 12, dryMass: 9800, cost: 9200, thrustVac: 2300000, ispVac: 285, ispAsl: 250, segments: 5, description: 'Large segmented solid booster for heavy launch stacks. Once lit, its full thrust continues until the grain is spent.' }),
  { ...solidMotor({ id: 'srb-candle', name: 'Candle Vacuum Kick Motor', size: 0, height: 0.9, dryMass: 55, cost: 500, thrustVac: 12000, ispVac: 295, ispAsl: 130, segments: 1, description: 'Compact single ignition solid kick stage for final orbit insertion and small payload escape burns.' }), meshParams: { segments: 1, nozzleLength: 0.25, exitRadius: 0.28 } },
  ...[0,1].map(i => { const p = expandedEngine(i ? 'eng-radial-rill' : 'eng-radial-spray', i ? 'Rill Radial Descent Engine' : 'Spray Radial Thruster', 0, i ? 1 : 0.65, i ? 180 : 60, i ? 900 : 420, i ? 32000 : 8000, 315, 245, 'lander', 'kerolox', i ? 0.28 : 0.18);
    return { ...p, surfaceAttachable: true, attachNodes: [srfNode(0.625)], mesh: 'radialEngine' }; }),
  ...[1,2].map(i => hardware(`beam-${i}`, `Web I-Beam ${i}`, 'structural', i * 35, i * 160, box(0.22, i * 1.2, 0.22), 'framework', [], { style: 'beam' }, 0)),
  ...[1,2].map(i => hardware(`panel-${i}`, `Deck Structural Panel ${i}`, 'structural', i * i * 30, i * 220, box(i, i, 0.08), 'framework', [], { style: 'panel' })),
  hardware('strut-cubic', 'Cell Cubic Strut', 'structural', 18, 140, box(0.5,0.5,0.5), 'framework', [], { style: 'truss', sides: 4 }, 0),
  hardware('truss-octagonal', 'Octant Open Truss', 'structural', 170, 650, cyl(0.625,0.625,2), 'framework', [], { style: 'truss', sides: 8 }, 1),
  hardware('mount-radial', 'Saddle Radial Mount', 'structural', 65, 250, box(0.7,0.5,0.4), 'framework', [], { style: 'mount' }),
  ...[1,2].map(i => hardware(`bay-cargo-${i}`, `Vault ${i === 1 ? '125' : '250'} Cargo Bay`, 'structural', i === 1 ? 350 : 1100, i * 1800,
    cyl(SIZE_RADIUS[i],SIZE_RADIUS[i],i * 2), 'bay', [{ type: 'bay' }], { style: 'cargo' }, i,
    'Clamshell cargo enclosure with an open interior and twin hinged doors. Use the gear toggle to open or close the bay.')),
  ...[1,2].map(i => hardware(`bay-service-${i}`, `Locker ${i === 1 ? '125' : '250'} Service Bay`, 'structural', i * 180, i * 800,
    cyl(SIZE_RADIUS[i],SIZE_RADIUS[i],i * 0.7), 'bay', [{ type: 'bay' }], { style: 'service' }, i,
    'Short equipment enclosure with hinged access doors and internal mounting rails. Use the gear toggle to open or close the bay.')),
  ...[3,4].map(i => ({ ...hardware(`fairing-${i}`, `Petal ${i === 3 ? '375' : '500'} Payload Fairing`, 'aero', i * 180, i * 900,
    cyl(SIZE_RADIUS[i],SIZE_RADIUS[i],0.25), 'fairing', [{ type: 'fairing', ejectionImpulse: i * 300 }], { shellHeight: i * 2, shellRadius: SIZE_RADIUS[i] * 1.08 }, i),
    description: 'Split payload shell on a reinforced base ring. The tapered enclosure protects wide orbital payloads during ascent.' })),
  adapter('adapt-0-2', 'Collar 062-250 Docking Adapter', 0, 2, 0.7, 180, 500, 'Compact load spreader connecting a small docking port to a two and a half metre module.'),
  adapter('adapt-1-3', 'Collar 125-375 Docking Adapter', 1, 3, 1.1, 420, 950, 'Wide station endcap supporting a standard docking port and maintaining stack crossfeed.'),
  hardware('cabin-wayfarer', 'Wayfarer Crew Cabin', 'command', 2500, 5400, cyl(1.25,1.25,2.5), 'habitat', [{ type: 'command', crew: 4, sasLevel: 0, ecPerSecond: 0.04, controllable: false }], { windows: 8 }, 2,
    'Four passenger seats, insulated bunks and a transfer hatch. Requires a separate cockpit or probe core for flight control.'),
  hardware('lab-crucible', 'Crucible Orbital Laboratory', 'science', 3200, 9000, cyl(1.25,1.25,3.2), 'habitat', [{ type: 'command', crew: 2, sasLevel: 0, ecPerSecond: 0.12, controllable: false }, { type: 'science', experiment: 'exposure' }], { windows: 4, lab: true }, 2,
    'Two-seat laboratory with material exposure equipment and insulated workstations. Requires independent flight control.'),
  ...[1,2].map(i => hardware(`ladder-${i}`, `Rung Access Ladder ${i}`, 'utility', i * 8, i * 90, box(0.35,i * 1.2,0.12), 'framework', [], { style: 'ladder' }, undefined,
    'Lightweight external access ladder with contrasting safety rungs. Visual access hardware; astronauts do not yet climb it.')),
  ...[1,2].map(i => hardware(`light-${i === 1 ? 'task' : 'area'}`, i === 1 ? 'Glint Task Lamp' : 'Daybreak Area Lamp', 'utility', i * 6, i * 130, box(i * 0.2,0.22,0.2), 'light', [{ type: 'light' }])),
  ...[1,5].map(i => hardware(`rcs-${i === 1 ? 'linear' : 'quint'}`, i === 1 ? 'Tap Linear RCS Port' : 'Flurry Five-Way RCS Block', 'control', i === 1 ? 6 : 32, i === 1 ? 160 : 620, box(0.3,0.3,0.24), 'rcsPorts',
    [{ type: 'rcs', thrustPerNozzle: i === 1 ? 250 : 1200, ispVac: 245, ispAsl: 110,
      nozzles: (i === 1 ? [v(0,0,1)] : [v(0,0,1),v(1,0,0),v(-1,0,0),v(0,1,0),v(0,-1,0)]).map(direction => ({ position: v(direction.x * 0.14,direction.y * 0.14,0.02 + direction.z * 0.14), direction })) }])),
  ...[2,3].map(i => hardware(`wheel-reaction-${i}`, `Flywheel ${i === 2 ? '250' : '375'} Attitude Ring`, 'control', i * 150, i * 1300, cyl(SIZE_RADIUS[i],SIZE_RADIUS[i],0.25), 'reactionWheel', [{ type: 'reactionWheel', torque: i === 2 ? 30000 : 75000, ecRate: i === 2 ? 2.4 : 5 }], {}, i)),
  ...[2,3].map(i => ({ ...hardware(`battery-bank-${i}`, `Reservoir ${i === 2 ? '250' : '375'} Battery Bank`, 'electrical', i * 200, i * 1700, cyl(SIZE_RADIUS[i],SIZE_RADIUS[i],0.3), 'battery', [{ type: 'battery' }], {}, i), resources: { electricCharge: i === 2 ? 8000 : 18000 } })),
  ...[1,2].map(i => hardware(`fuelcell-${i}`, i === 1 ? 'Catalyst Fuel Cell' : 'Catalyst Fuel Cell Bank', 'electrical', i * 45, i * 650, box(i * 0.4,0.55,0.25), 'powerUnit',
    [{ type: 'fuelCell', chargeRate: i * 3, fuelRate: i * 0.012, oxidizerRate: i * 0.022 }], { style: 'fuelCell' }, undefined,
    'Automatically combines stack-fed liquid fuel and oxidizer to replenish electrical storage. Stops consuming propellant when batteries are full.')),
  hardware('generator-isotope', 'Isotope Thermoelectric Generator', 'electrical', 85, 14000, box(0.35,0.65,0.35), 'powerUnit', [{ type: 'generator', chargeRate: 0.8 }], { style: 'rtg' }, undefined,
    'Finned radioisotope generator supplies constant electrical power in darkness and far from the Sun, without consuming stored resources.'),
  ...[1,2].map(i => hardware(`solar-grand-${i}`, i === 1 ? 'Sundial Large Solar Wing' : 'Solstice Expedition Array', 'electrical', i * 180, i * 3800, box(1.2,1.8,0.25), 'solarDeploy',
    [{ type: 'solarPanel', chargeRate: i * 16, tracking: true }], { panels: i === 1 ? 6 : 10, panelLength: 1.5, panelWidth: 1.1 })),
  ...[1,2].map(i => hardware(`radiator-${i}`, i === 1 ? 'Finch Cooling Panel' : 'Heron Radiator Bank', 'utility', i * 60, i * 450, box(i * 0.8,1.4,0.12), 'framework', [], { style: 'radiator' }, undefined,
    'External ribbed radiator panel with coolant headers. Visual thermal hardware pending active heat-transfer simulation.')),
  ...[0,1,2].map(i => ({ ...utility.find(p => p.id === (i === 2 ? 'chute-radial' : 'chute-main'))!, id: ['chute-brake','chute-heavy','chute-radial-heavy'][i], name: ['Reef High-Speed Drogue','Orchard Heavy Parachute','Orchard Radial Parachute'][i],
    dryMass: [90,280,160][i], cost: [550,1200,850][i], description: 'Reinforced recovery canopy with a staged reefing system and high strength suspension lines for heavy payloads.',
    modules: [{ type: 'parachute' as const, deployedCdA: [65,1500,750][i], semiCdA: [8,25,14][i], minPressure: i ? 4000 : 1500, deployAltitude: i ? 1200 : 4000, maxQ: i ? 25000 : 85000 }],
    meshParams: { style: i === 2 ? 'radial' : 'stack', canopyRadius: [4.5,22,16][i], colors: i ? 'white' : 'red' } })),
  { ...utility.find(p => p.id === 'leg-strider')!, id: 'leg-colossus', name: 'Colossus Landing Leg', dryMass: 420, cost: 1700,
    shape: box(0.56,2.8,0.56), attachNodes: [srfNode(0.56,0.42)], meshParams: { scale: 2.8 },
    modules: [{ type: 'landingLeg', spring: 400000, damper: 40000, travel: 0.7, footPosition: landingLegLayout(2.8).contact }] },
  ...[0,1].map(i => { const p = landingGear({ id: `rover-wheel-${i}`, name: i ? 'Boulder Powered Rover Wheel' : 'Pebble Powered Rover Wheel', description: 'Fixed powered terrain wheel with steering, a sprung hub and independent braking for surface exploration.', dryMass: i ? 110 : 35, cost: i ? 850 : 350, radius: i ? 0.48 : 0.25, strut: i ? 0.55 : 0.3, fold: 0, spring: i ? 80000 : 25000, damper: i ? 7000 : 2500, travel: i ? 0.3 : 0.15, brakeTorque: i ? 1800 : 350, steerDeg: 30, crashTolerance: 18 });
    return { ...p, modules: p.modules.map(m => m.type === 'wheel' ? { ...m, motorTorque: i ? 1500 : 250 } : m) }; }),
  { ...hardware('rover-chassis', 'Trailhead Rover Chassis', 'structural', 220, 1200, box(1.5,2,0.35), 'framework', [], { style: 'chassis' }, 1), resources: { electricCharge: 800 } },
];

export const PART_DEFS: PartDef[] = [...pods, ...tanks, ...engines, ...coupling, ...structural, ...aero, ...control, ...electrical, ...utility, ...aircraft, ...scienceParts, ...antennas, ...expansion];

export const PART_CATALOG: Map<string, PartDef> = new Map(PART_DEFS.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const p = PART_CATALOG.get(id);
  if (!p) throw new Error(`Unknown part id: ${id}`);
  return p;
}

/** Full (wet) mass of a part with all resources loaded, kg. */
export function partWetMass(def: PartDef): number {
  let m = def.dryMass;
  for (const k in def.resources) {
    const id = k as ResourceId;
    m += (def.resources[id] ?? 0) * RESOURCES[id].density;
  }
  return m;
}

/** Convenience lookup of a module by type. */
export function findModule<T extends PartModule['type']>(def: PartDef, type: T): Extract<PartModule, { type: T }> | undefined {
  return def.modules.find((m) => m.type === type) as Extract<PartModule, { type: T }> | undefined;
}
