import type { AttachNode, PartDef, PartModule } from '../../sim/vessel/types';
import { KEROLOX_FUEL_FRACTION, KEROLOX_OX_FRACTION, RESOURCES } from '../resources';


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


export const DEG = Math.PI / 180;

export const v = (x: number, y: number, z: number) => ({ x, y, z });


export function stackNodes(h: number, sizeTop: number | null, sizeBottom: number | null): AttachNode[] {
  const n: AttachNode[] = [];
  if (sizeTop !== null) n.push({ id: 'top', position: v(0, h / 2, 0), direction: v(0, 1, 0), size: sizeTop });
  if (sizeBottom !== null) n.push({ id: 'bottom', position: v(0, -h / 2, 0), direction: v(0, -1, 0), size: sizeBottom });
  return n;
}


/** Surface-attach node at the mount face (z = -depth/2), pointing into the parent. */
export function srfNode(depth: number, y = 0): AttachNode {
  return { id: 'srf', position: v(0, y, -depth / 2), direction: v(0, 0, -1), size: 0 };
}


export const cyl = (radiusTop: number, radiusBottom: number, height: number) =>
  ({ kind: 'cylinder', radiusTop, radiusBottom, height }) as const;

export const box = (x: number, y: number, z: number) => ({ kind: 'box', size: v(x, y, z) }) as const;


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


export function fuelTank(
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

export interface EngineSpec {
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


export function liquidEngine(s: EngineSpec): PartDef {
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


export interface SrbSpec {
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


export function solidMotor(s: SrbSpec): PartDef {
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

export function stackDecoupler(id: string, name: string, size: number, h: number, dryMass: number, impulse: number, cost: number, description: string, separator = false): PartDef {
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
export function dockingPort(id: string, name: string, size: number, h: number, dryMass: number, cost: number, capture: { range: number; speed: number; angleDeg: number }, description: string): PartDef {
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


export function adapter(id: string, name: string, sizeTop: number, sizeBottom: number, h: number, dryMass: number, cost: number, description: string): PartDef {
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


export function noseCone(id: string, name: string, size: number, h: number, dryMass: number, cost: number, description: string): PartDef {
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


export interface SurfaceSpec {
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


export function liftingSurface(s: SurfaceSpec): PartDef {
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
// Aircraft: jet engines, intakes, fuselage, landing gear, wings
// ---------------------------------------------------------------------------------------------

export interface JetSpec {
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


export function jetEngine(s: JetSpec): PartDef {
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
export function fuselage(id: string, name: string, sizeTop: number, sizeBottom: number | null, length: number, rBottom: number, litres: number, dryMass: number, cost: number, style: 'tank' | 'tailcone' | 'adapter', description: string): PartDef {
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


export interface GearSpec {
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


export function landingGear(s: GearSpec): PartDef {
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


/** Expansion hardware shares the catalogue frame and resource conventions above. */
export function hardware(id: string, name: string, category: PartDef['category'], mass: number, cost: number,
  shape: PartDef['shape'], mesh: string, modules: PartModule[] = [], params: PartDef['meshParams'] = {},
  size?: number, description = 'Modular expedition hardware with reinforced attachment fittings and accessible service connections.'): PartDef {
  const depth = shape.kind === 'box' ? shape.size.z : shape.radiusTop * 2;
  return { id, name, category, dryMass: mass, cost, shape, mesh, modules, meshParams: params, description,
    manufacturer: category === 'electrical' ? MANUFACTURERS.lumen : category === 'ground' ? MANUFACTURERS.tread : category === 'command' || category === 'utility' ? MANUFACTURERS.northlight : category === 'science' ? MANUFACTURERS.brightfield : MANUFACTURERS.tessellate,
    resources: {}, attachNodes: size === undefined ? [srfNode(depth)] : stackNodes(shape.kind === 'box' ? shape.size.y : shape.height, size, size),
    surfaceAttachable: size === undefined, allowSurfaceAttachChildren: true,
    dragCoefficient: { axial: 0.6, side: 0.9 }, maxTemp: 1600, crashTolerance: 12 };
}

export function expandedEngine(id: string, name: string, size: number, height: number, mass: number, cost: number,
  thrust: number, vac: number, asl: number, style: EngineSpec['style'], plume: EngineSpec['plume'], exitRadius: number): PartDef {
  return liquidEngine({ id, name, size, height, dryMass: mass, cost, thrustVac: thrust, ispVac: vac, ispAsl: asl,
    style, plume, exitRadius, gimbalDeg: 4, minThrottle: 0.15, ignitions: -1, spool: 0.6,
    description: `${name} provides restartable propulsion with reinforced feed ducts and an actively cooled thrust chamber.` });
}
