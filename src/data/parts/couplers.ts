import type { AttachNode, PartDef } from '../../sim/vessel/types';
import { cyl, MANUFACTURERS, SIZE_RADIUS, v } from './builders';

/**
 * Multi-way stack couplers: one top node splitting into two to four parallel bottom nodes for clustered engines or
 * side-by-side tanks. Propellant flows through like any structural stack part. Appended after the original catalogue so
 * existing part order and research placement stay stable.
 */
function coupler(id: string, name: string, size: number, ways: 2 | 3 | 4, h: number, dryMass: number, cost: number, description: string): PartDef {
  const R = SIZE_RADIUS[size], r = SIZE_RADIUS[size - 1];
  // Socket centres: side by side (2), a trefoil (3) or a square (4); sockets touch each other at the axis.
  const d = ways === 2 ? r : ways === 3 ? r / Math.sin(Math.PI / 3) : r;
  const offsets: [number, number][] = ways === 2 ? [[d, 0], [-d, 0]]
    : ways === 3 ? [0, 1, 2].map(i => [d * Math.sin((2 * Math.PI * i) / 3), d * Math.cos((2 * Math.PI * i) / 3)] as [number, number])
    : [[d, d], [-d, d], [-d, -d], [d, -d]];
  const nodes: AttachNode[] = [{ id: 'top', position: v(0, h / 2, 0), direction: v(0, 1, 0), size }];
  offsets.forEach(([x, z], i) => nodes.push({ id: i ? `bottom${i + 1}` : 'bottom', position: v(x, -h / 2, z), direction: v(0, -1, 0), size: size - 1 }));
  return {
    id, name, description, manufacturer: MANUFACTURERS.tessellate, category: 'coupling', dryMass, cost, resources: {},
    attachNodes: nodes, surfaceAttachable: false, allowSurfaceAttachChildren: true, shape: cyl(R, R, h),
    dragCoefficient: { axial: 0.5, side: 0.9 }, maxTemp: 2000, crashTolerance: 9, modules: [],
    mesh: 'coupler', meshParams: { socketRadius: r },
  };
}

export const couplers: PartDef[] = [
  coupler('coupler-1-x2', 'Wishbone 125 Twin Coupler', 1, 2, 0.45, 45, 180, 'Splits a 1.25 m stack into two 0.625 m mounts. Small engines, twice the opinions.'),
  coupler('coupler-1-x4', 'Crossbill 125 Quad Coupler', 1, 4, 0.5, 70, 260, 'Four 0.625 m mounts under one 1.25 m ring. Cluster small engines or hang a bundle of tanks.'),
  coupler('coupler-2-x2', 'Wishbone 250 Twin Coupler', 2, 2, 0.8, 180, 420, 'A 2.5 m crown dividing into two 1.25 m sockets, with internal ducts that keep propellant flowing to both.'),
  coupler('coupler-2-x3', 'Trefoil 250 Tri Coupler', 2, 3, 0.85, 220, 520, 'Three 1.25 m sockets in a trefoil under a 2.5 m stack. The classic way to cluster mid-size engines.'),
  coupler('coupler-2-x4', 'Crossbill 250 Quad Coupler', 2, 4, 0.9, 280, 650, 'Four 1.25 m sockets in a square. The outer engines sit slightly proud of the stack, which looks great on the pad.'),
];
