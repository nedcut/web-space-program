import type { PartDef } from '../../sim/vessel/types';
import { pods } from './pods';
import { cyl, stackNodes, MANUFACTURERS } from './builders';

const core = pods.find(p => p.id === 'probe-cairn')!;
export const hazardParts: PartDef[] = [
  { ...core, id: 'probe-kiln', name: 'Kiln Venus-rated Probe', dryMass: 240, cost: 6800,
    description: 'A 15 MPa pressure vessel with insulated avionics and a finite thermal reserve. At Venus datum it lasts about 105 minutes at real scale (33 minutes at Standard). Carries battery power for the surface experiment window and a hull-mounted low-gain antenna that reaches Earth from Venus (transmits 40% of recorded science).',
    maxPressure: 15e6, maxTemp: 1600, maxOperatingTemp: 400, heatSoakTime: 22000,
    resources: { electricCharge: 1200 }, modules: [...core.modules, { type: 'radiationShield', factor: 0.3 },
      // Nothing outside the shell survives the surface: the link is built into the hull (2 Gm rating, 126 Gm to a ground station).
      { type: 'antenna', transmission: 0.4, range: 2e9, relay: false, fixed: true }] },
  { ...core, id: 'probe-vault', name: 'Bastion Shielded Avionics', dryMass: 300, cost: 7500,
    description: 'A radiation vault reduces dose to all connected hardware to ten percent. Vault factors do not stack. Adds mass, not unlimited immunity.',
    modules: [...core.modules, { type: 'radiationShield', factor: 0.1 }] },
  { id: 'shell-kiln', name: 'Kiln Venus Lander Shell', manufacturer: MANUFACTURERS.tessellate,
    description: 'A 15 MPa, 1600 K landing shell with an impact-tolerant base and surface thermometer. Pair with the Kiln probe. The shell rating applies to this part; attached exposed hardware still needs its own pressure rating.',
    category: 'structural', dryMass: 480, cost: 3200, resources: {}, shape: cyl(0.625, 0.85, 0.6),
    attachNodes: stackNodes(0.6, 1, 1), surfaceAttachable: false, allowSurfaceAttachChildren: true,
    dragCoefficient: { axial: 1.2, side: 1 }, maxTemp: 1600, maxPressure: 15e6,
    maxOperatingTemp: 400, heatSoakTime: 22000, crashTolerance: 18,
    modules: [{ type: 'science', experiment: 'temperature' }], mesh: 'probeCore', meshParams: { style: 'cairn' } },
];
