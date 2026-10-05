import type { ResourceDef, ResourceId } from '../sim/vessel/types';

/**
 * Resource table. 1 unit = 1 litre for all propellants, so `density` is kg/L.
 *
 * Note on liquid propellants: the resource model has a single "liquidFuel"/"oxidizer" pair. It is
 * defined as a kerosene-class fuel + liquid oxygen. Hydrolox/methalox-styled engines also burn this
 * pair (they differ in Isp, thrust and plume) until dedicated LH2/CH4 resources are added.
 */
export const RESOURCES: Record<ResourceId, ResourceDef> = {
  regolith: { id: 'regolith', name: 'Regolith', density: 2.5, flow: 'all' },
  liquidFuel: { id: 'liquidFuel', name: 'Kerolox Fuel', density: 0.81, flow: 'stack' },
  oxidizer: { id: 'oxidizer', name: 'Liquid Oxygen', density: 1.14, flow: 'stack' },
  monopropellant: { id: 'monopropellant', name: 'Hydrazine Monoprop', density: 1.0, flow: 'all' },
  xenon: { id: 'xenon', name: 'Xenon Gas', density: 2.9, flow: 'all' },
  solidFuel: { id: 'solidFuel', name: 'Solid Propellant Grain', density: 1.8, flow: 'none' },
  electricCharge: { id: 'electricCharge', name: 'Electric Charge', density: 0, flow: 'all' },
  ablator: { id: 'ablator', name: 'Ablative Resin', density: 1.0, flow: 'none' },
  /** Produced by intakes each step (1 unit = 1 kg of air); only a tiny buffer is held. Massless for simplicity. */
  intakeAir: { id: 'intakeAir', name: 'Intake Air', density: 0, flow: 'all' },
};

/** Mass of a resource bundle, kg. */
export function resourceMass(res: Partial<Record<ResourceId, number>>): number {
  let m = 0;
  for (const k in res) {
    const id = k as ResourceId;
    m += (res[id] ?? 0) * RESOURCES[id].density;
  }
  return m;
}

/**
 * Kerolox mixture by volume (O/F = 2.56 by mass with RP-1 0.81 kg/L and LOX 1.14 kg/L).
 * Fuel tanks are filled in this ratio and engines draw in this ratio, so they drain together.
 */
export const KEROLOX_FUEL_FRACTION = 0.355;
export const KEROLOX_OX_FRACTION = 0.645;
