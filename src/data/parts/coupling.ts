import type { PartDef } from '../../sim/vessel/types';
import { box, dockingPort, MANUFACTURERS, srfNode, stackDecoupler } from './builders';



export const coupling: PartDef[] = [
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
