import type { PartDef } from '../../sim/vessel/types';
import { adapter, box, MANUFACTURERS, srfNode, stackNodes } from './builders';



export const structural: PartDef[] = [
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
