import type { PartDef, PartModule } from '../sim/vessel/types';

function hardware(id: string, name: string, modules: PartModule[], mass: number, height: number, stack = false): PartDef {
  return {
    id, name, manufacturer: 'Bedrock Process Engineering',
    description: 'Surface resource equipment with an integral process radiator. Refining uses a vessel-wide transfer manifold; provide empty product tanks and electric charge.',
    category: modules.some(m => m.type === 'surfaceScanner' || m.type === 'surveyScanner') ? 'science' : 'utility',
    dryMass: mass, cost: mass * 12, resources: {},
    attachNodes: stack ? [
      { id: 'top', position: { x: 0, y: height / 2, z: 0 }, direction: { x: 0, y: 1, z: 0 }, size: 1 },
      { id: 'bottom', position: { x: 0, y: -height / 2, z: 0 }, direction: { x: 0, y: -1, z: 0 }, size: 1 },
    ] : [{ id: 'srf', position: { x: 0, y: 0, z: -0.2 }, direction: { x: 0, y: 0, z: -1 }, size: 0 }],
    surfaceAttachable: !stack, allowSurfaceAttachChildren: stack,
    shape: stack ? { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.625, height }
      : { kind: 'box', size: { x: 0.4, y: height, z: 0.4 } },
    dragCoefficient: { axial: 0.3, side: 0.6 }, maxTemp: 1500, crashTolerance: 12,
    modules, mesh: 'isru',
  };
}
export const ISRU_PARTS: PartDef[] = [
  hardware('drill-burrow', 'Burrow Surface Drill', [{ type: 'drill', rate: 0.3, ecRate: 2, heat: 800 }], 90, 1.2),
  hardware('drill-quarry', 'Quarry Surface Drill', [{ type: 'drill', rate: 1.2, ecRate: 7, heat: 2400 }], 280, 2),
  { ...hardware('regolith-hopper', 'Scree Radial Hopper', [], 40, 0.8), resources: { regolith: 120 }, category: 'fuelTank' },
  { ...hardware('regolith-silo', 'Talus Stack Silo', [], 160, 1.5, true), resources: { regolith: 900 }, category: 'fuelTank' },
  hardware('converter-foundry', 'Foundry Resource Processor', [{ type: 'converter', rate: 0.2, ecRate: 4, heat: 1800 }], 350, 1, true),
  hardware('scanner-meridian', 'Meridian Resource Surveyor', [{ type: 'surveyScanner' }], 45, 0.7),
  hardware('scanner-assay', 'Assay Surface Spectrometer', [{ type: 'surfaceScanner' }], 12, 0.3),
];
