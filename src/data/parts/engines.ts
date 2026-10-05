import type { PartDef } from '../../sim/vessel/types';
import { cyl, liquidEngine, MANUFACTURERS, solidMotor, stackNodes, v } from './builders';



export const engines: PartDef[] = [
  liquidEngine({
    id: 'eng-gust', name: 'Gust Mini-Booster', size: 0, height: 0.9, dryMass: 110, cost: 400,
    thrustVac: 20_000, ispVac: 310, ispAsl: 265, gimbalDeg: 4, minThrottle: 0.4, ignitions: 3, spool: 0.6,
    plume: 'kerolox', style: 'compact', exitRadius: 0.25,
    description: 'Pocket-sized kerolox engine for sounding rockets and small upper stages. Loud for its size.',
  }),
  liquidEngine({
    id: 'eng-wisp', name: 'Wisp Vacuum Thruster', size: 0, height: 1.0, dryMass: 80, cost: 650,
    thrustVac: 9_000, ispVac: 340, ispAsl: 120, gimbalDeg: 3, minThrottle: 0.2, ignitions: 8, spool: 0.4,
    plume: 'kerolox', style: 'vacuum', exitRadius: 0.3,
    description: 'A delicate radiatively cooled bell for probes. Firing it at sea level is technically possible and deeply embarrassing.',
  }),
  liquidEngine({
    id: 'eng-sirocco', name: 'Sirocco Lifter', size: 1, height: 2.0, dryMass: 700, cost: 1300,
    thrustVac: 220_000, ispVac: 320, ispAsl: 285, gimbalDeg: 5, minThrottle: 0.5, ignitions: 1, spool: 1.0,
    plume: 'kerolox', style: 'lifter', exitRadius: 0.5,
    description: 'Gas-generator kerolox engine with a famously dependable turbopump. The workhorse of 1.25 m first stages.',
  }),
  liquidEngine({
    id: 'eng-zephyr', name: 'Zephyr Vacuum Engine', size: 1, height: 2.6, dryMass: 420, cost: 1600,
    thrustVac: 65_000, ispVac: 345, ispAsl: 255, gimbalDeg: 3, minThrottle: 0.3, ignitions: 4, spool: 0.8,
    plume: 'kerolox', style: 'vacuum', exitRadius: 0.6,
    description: 'Upper-stage engine with a niobium nozzle extension that glows cherry-red in a long burn.',
  }),
  liquidEngine({
    id: 'eng-doldrum', name: 'Doldrum Descent Engine', size: 1, height: 0.8, dryMass: 280, cost: 1500,
    thrustVac: 50_000, ispVac: 322, ispAsl: 230, gimbalDeg: 6, minThrottle: 0.1, ignitions: -1, spool: 0.3,
    plume: 'kerolox', style: 'lander', exitRadius: 0.42,
    description: 'Low-profile deep-throttling lander engine. Designed to hover patiently while you second-guess the landing site.',
  }),
  liquidEngine({
    id: 'eng-chinook', name: 'Chinook Heavy Lifter', size: 2, height: 3.2, dryMass: 3100, cost: 4800,
    thrustVac: 1_050_000, ispVac: 322, ispAsl: 288, gimbalDeg: 4, minThrottle: 0.55, ignitions: 1, spool: 1.4,
    plume: 'kerolox', style: 'lifter', exitRadius: 1.0,
    description: 'A megawatt-class kerolox booster engine. Rattles windows in three counties.',
  }),
  liquidEngine({
    id: 'eng-foehn', name: 'Foehn Hydrolox Upper', size: 2, height: 4.0, dryMass: 1300, cost: 7200,
    thrustVac: 200_000, ispVac: 450, ispAsl: 200, gimbalDeg: 4, minThrottle: 0.4, ignitions: 3, spool: 1.2,
    plume: 'hydrolox', style: 'hydrolox', exitRadius: 1.2,
    description: 'Staged-combustion hydrolox engine with a vast thin bell. Superb efficiency, invisible flame, eye-watering price.',
  }),
  liquidEngine({
    id: 'eng-harmattan', name: 'Harmattan Full-Flow', size: 2, height: 3.0, dryMass: 2400, cost: 6500,
    thrustVac: 900_000, ispVac: 355, ispAsl: 310, gimbalDeg: 5, minThrottle: 0.4, ignitions: 3, spool: 1.0,
    plume: 'methalox', style: 'fullflow', exitRadius: 0.95, maxTemp: 2500,
    description: 'Full-flow staged methalox engine with twin turbopumps. Clean blue flame, restartable, slightly smug.',
  }),
  liquidEngine({
    id: 'eng-tempest', name: 'Tempest Quad Cluster', size: 3, height: 3.6, dryMass: 7800, cost: 11000,
    thrustVac: 3_300_000, ispVac: 326, ispAsl: 290, gimbalDeg: 3, minThrottle: 0.6, ignitions: 1, spool: 1.6,
    plume: 'kerolox', style: 'cluster', exitRadius: 0.72, extra: { bells: 4 },
    description: 'Four gimballed kerolox chambers on one thrust frame. Liftoff becomes less of a question and more of a statement.',
  }),
  {
    id: 'eng-whisper',
    name: 'Whisper Ion Drive',
    manufacturer: MANUFACTURERS.lumen,
    description: 'Gridded xenon ion thruster. Pushes with the force of a held breath, for months on end.',
    category: 'engine',
    dryMass: 220,
    cost: 6000,
    resources: {},
    attachNodes: stackNodes(0.5, 0, 0),
    surfaceAttachable: true,
    allowSurfaceAttachChildren: false,
    shape: cyl(0.3125, 0.33, 0.5),
    dragCoefficient: { axial: 0.7, side: 0.9 },
    maxTemp: 1600,
    crashTolerance: 7,
    modules: [
      {
        type: 'engine',
        maxThrustVac: 250,
        ispVac: 4000,
        ispAsl: 100,
        // Volume ratio: ~0.0022 L/s xenon draws ~8 EC/s at full throttle.
        propellants: { xenon: 1, electricCharge: 3600 },
        minThrottle: 0,
        throttleable: true,
        gimbalRange: 0,
        thrustDirection: v(0, 1, 0),
        spoolTime: 0.5,
        plume: 'ion',
        ignitions: -1,
      },
    ],
    mesh: 'ionEngine',
    meshParams: { exitRadius: 0.3 },
  },
  solidMotor({
    id: 'srb-sparkler', name: 'Sparkler Solid Motor', size: 0, height: 2.2, dryMass: 90, cost: 180,
    thrustVac: 32_000, ispVac: 245, ispAsl: 215, segments: 2,
    description: 'Cheap, cheerful and impossible to switch off. A favourite for strap-on kicks and questionable decisions.',
  }),
  solidMotor({
    id: 'srb-roman-candle', name: 'Roman Candle Booster', size: 1, height: 6.0, dryMass: 1200, cost: 900,
    thrustVac: 340_000, ispVac: 250, ispAsl: 220, segments: 3,
    description: 'Segmented 1.25 m solid booster. About seventy seconds of extremely firm encouragement.',
  }),
  solidMotor({
    id: 'srb-thunderclap', name: 'Thunderclap Heavy Booster', size: 2, height: 11.0, dryMass: 8500, cost: 4200,
    thrustVac: 2_400_000, ispVac: 255, ispAsl: 225, segments: 4,
    description: 'Four steel segments packed with seventy-five tonnes of grain. The launch pad will need a moment.',
  }),
];
