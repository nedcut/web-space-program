import { hazardParts } from './parts/hazards';
import { pressureLimit } from '../sim/hazards/vessel';
import type { PartDef,PartModule,ResourceId } from '../sim/vessel/types';
import { ISRU_PARTS } from './isru';
import { aero } from './parts/aero';
import { aircraft } from './parts/aircraft';
import { antennas } from './parts/antennas';
import { control } from './parts/control';
import { coupling } from './parts/coupling';
import { electrical } from './parts/electrical';
import { engines } from './parts/engines';
import { expansion } from './parts/expansion';
import { pods } from './parts/pods';
import { scienceParts } from './parts/scienceParts';
import { structural } from './parts/structural';
import { tanks } from './parts/tanks';
import { utility } from './parts/utility';
import { RESOURCES } from './resources';
export { gearLayout,landingLegLayout,MANUFACTURERS,SIZE_RADIUS } from './parts/builders';


export const PART_DEFS: PartDef[] = [...pods, ...tanks, ...engines, ...coupling, ...structural, ...aero, ...control, ...electrical, ...utility, ...aircraft, ...scienceParts, ...antennas, ...expansion, ...ISRU_PARTS, ...hazardParts].map(p => ({ ...p, maxPressure: pressureLimit(p) }));


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
