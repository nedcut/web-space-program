import type { PartDef } from '../../sim/vessel/types';
import { box, MANUFACTURERS, srfNode } from './builders';



/** Compact radial instrument housings and telemetry arrays. */
export const scienceParts: PartDef[] = [
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
