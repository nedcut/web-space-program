import type { PartDef } from '../../sim/vessel/types';
import { box, MANUFACTURERS, srfNode } from './builders';


export const antennas: PartDef[] = [0, 1].map(i => ({
  id: i ? 'antenna-relay' : 'antenna-thread', name: i ? 'Lattice Relay Array' : 'Thread Telemetry Aerial',
  manufacturer: MANUFACTURERS.lumen, description: `Transmits ${i ? 65 : 40}% of recorded science. Recover hardware for the balance.`,
  category: 'electrical', dryMass: i ? 35 : 5, cost: i ? 1200 : 120, resources: {},
  attachNodes: [srfNode(0.15)], surfaceAttachable: true, allowSurfaceAttachChildren: false,
  shape: box(0.2, i ? 0.8 : 0.4, 0.15), dragCoefficient: { axial: 0.2, side: 0.4 }, maxTemp: 1400, crashTolerance: 10,
  modules: [{ type: 'antenna', transmission: i ? 0.65 : 0.4, range: i ? 5e7 : 5e5, relay: !!i }], mesh: 'instrument',
}));

// Larger relay arrays share the radial mount contract, with distinct procedural dish meshes.
for (const [id, name, range, mass, cost, size] of [
  ['antenna-arc', 'Arcwatch Relay Dish', 5e9, 90, 3600, 0.65],
  ['antenna-horizon', 'Horizon Relay Reflector', 5e11, 220, 9000, 1.1],
] as const) antennas.push({
  ...antennas[1], id, name, dryMass: mass, cost,
  description: `Relay-capable deep-space antenna. Rated range ${(range / 1e9).toFixed(1)} Gm; transmits 65% science.`,
  shape: box(size, size, 0.3), attachNodes: [srfNode(0.3)],
  modules: [{ type: 'antenna', transmission: 0.65, range, relay: true }],
});


