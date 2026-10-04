import type { PartDef } from '../sim/vessel/types';

/** Runtime-only part; deliberately absent from the editor catalog. 95 kg person/suit + 5 kg gas. */
export const EVA_PART: PartDef = {
  id: 'eva-astronaut', name: 'Astronaut', manufacturer: 'Web Space Program', description: 'Human astronaut in a mobility suit.',
  category: 'command', dryMass: 95, cost: 0, resources: { monopropellant: 5 }, attachNodes: [],
  surfaceAttachable: false, allowSurfaceAttachChildren: false,
  shape: { kind: 'box', size: { x: 0.7, y: 1.8, z: 0.65 } },
  dragCoefficient: { axial: 0.8, side: 1 }, maxTemp: 600, crashTolerance: 12, modules: [], mesh: 'astronaut',
};
