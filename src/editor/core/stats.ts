import type { CraftDef, PartInstance, ResourceId } from '../../sim/vessel/types';
import { add, scale, v3, type Vec3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import { partBounds, requirePart, type PartCatalog } from './geometry';

export type ResourceDensities = Partial<Record<ResourceId, number>> | ReadonlyMap<ResourceId, number>;
function partMass(part: PartInstance, catalog: PartCatalog, densities: ResourceDensities): number {
  const def = requirePart(catalog, part.partId);
  let mass = def.dryMass;
  for (const [resource, capacity] of Object.entries(def.resources)) {
    const id = resource as ResourceId;
    const density = densities instanceof Map ? densities.get(id) : (densities as Partial<Record<ResourceId, number>>)[id];
    if (density === undefined) throw new Error(`Missing resource density: ${id}`);
    mass += (part.resources?.[id] ?? capacity ?? 0) * density;
  }
  return mass;
}
export interface CraftStats {
  totalMass: number; partCount: number; height: number; width: number; depth: number;
  bounds: { min: Vec3; max: Vec3 };
  centreOfMass: Vec3;
  /** Thrust-weighted engine origins; undefined without active engine definitions. */
  centreOfThrust?: Vec3;
  /**
   * Centre of lift: lifting surfaces weighted by their lift-curve slope × area × the share of their lift
   * normal that acts in the relevant plane (SPH: the pitch plane, normal · craft +Z; VAB: perpendicular to
   * the stack axis), each acting at its planform centre. Undefined without lifting surfaces.
   */
  centreOfLift?: Vec3;
}
/** Lift weight of a lifting surface instance for the centre-of-lift estimate. */
function liftWeight(part: PartInstance, module: { area: number; liftSlope: number }, craftType: CraftDef['type']): number {
  const n = qRotate(part.rotation, v3(1, 0, 0));
  const share = craftType === 'SPH' ? Math.abs(n.z) : Math.hypot(n.x, n.z);
  return module.area * module.liftSlope * share;
}
export function craftStats(craft: CraftDef, catalog: PartCatalog, densities: ResourceDensities): CraftStats {
  let mass = 0, thrust = 0, lift = 0;
  let com = v3(), cot = v3(), col = v3();
  const boxes = craft.parts.map(part => {
    const def = requirePart(catalog, part.partId);
    const m = partMass(part, catalog, densities);
    mass += m; com = add(com, scale(part.position, m));
    for (const module of def.modules) {
      if (module.type === 'engine') { const f = module.maxThrustVac * Math.max(0, Math.min(1, part.tweaks?.thrustLimit ?? 1)); thrust += f; cot = add(cot, scale(part.position, f)); }
      if (module.type === 'liftingSurface') {
        const w = liftWeight(part, module, craft.type);
        lift += w; col = add(col, scale(part.position, w));
      }
    }
    return partBounds(part, def);
  });
  const min = boxes.length ? v3(Math.min(...boxes.map(b => b.min.x)), Math.min(...boxes.map(b => b.min.y)), Math.min(...boxes.map(b => b.min.z))) : v3();
  const max = boxes.length ? v3(Math.max(...boxes.map(b => b.max.x)), Math.max(...boxes.map(b => b.max.y)), Math.max(...boxes.map(b => b.max.z))) : v3();
  return { totalMass: mass, partCount: craft.parts.length, bounds: { min, max }, height: max.y - min.y,
    width: max.x - min.x, depth: max.z - min.z, centreOfMass: mass ? scale(com, 1 / mass) : v3(),
    centreOfThrust: thrust ? scale(cot, 1 / thrust) : undefined, centreOfLift: lift > 1e-9 ? scale(col, 1 / lift) : undefined };
}
export interface CraftWarning { code: 'no-command' | 'no-fuel' | 'no-parachute' | 'overlap'; message: string; partUids: number[] }
export function validateCraft(craft: CraftDef, catalog: PartCatalog): CraftWarning[] {
  const warnings: CraftWarning[] = [];
  const defs = craft.parts.map(p => requirePart(catalog, p.partId));
  if (!defs.some(d => d.modules.some(m => m.type === 'command' && m.controllable !== false))) warnings.push({ code: 'no-command', message: 'Craft has no command part.', partUids: [] });
  if (!defs.some(d => d.modules.some(m => m.type === 'parachute'))) warnings.push({ code: 'no-parachute', message: 'Craft has no parachutes.', partUids: [] });
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  for (const part of craft.parts) {
    // Upstream includes the engine itself (solid fuel), then its ancestor chain.
    const sources: PartInstance[] = [];
    let upstream: PartInstance | undefined = part;
    const seen = new Set<number>();
    while (upstream && !seen.has(upstream.uid)) { sources.push(upstream); seen.add(upstream.uid); upstream = upstream.parent === undefined ? undefined : byUid.get(upstream.parent); }
    for (const module of requirePart(catalog, part.partId).modules) if (module.type === 'engine') {
      const missing = Object.entries(module.propellants).filter(([, ratio]) => (ratio ?? 0) > 0).map(([id]) => id as ResourceId).filter(id => !sources.some(p => (p.resources?.[id] ?? requirePart(catalog, p.partId).resources[id] ?? 0) > 0));
      if (missing.length) warnings.push({ code: 'no-fuel', message: `Engine ${part.uid} has no upstream source for ${missing.join(', ')}.`, partUids: [part.uid] });
    }
  }
  const boxes = craft.parts.map((p, i) => partBounds(p, defs[i]));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    // Face contact is valid; positive-volume AABB intersection is a warning only.
    if (['x', 'y', 'z'].every(axis => { const k = axis as keyof Vec3; return Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > 1e-6; })) {
      warnings.push({ code: 'overlap', message: `Parts ${craft.parts[i].uid} and ${craft.parts[j].uid} have overlapping bounds.`, partUids: [craft.parts[i].uid, craft.parts[j].uid] });
    }
  }
  return warnings;
}
