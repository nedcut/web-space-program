import type { PartDef } from '../../../sim/vessel/types';

export type Builder = (def: PartDef) => import('three').Object3D;

export function cylDims(def: PartDef): { rTop: number; rBot: number; h: number } {
  if (def.shape.kind === 'cylinder') return { rTop: def.shape.radiusTop, rBot: def.shape.radiusBottom, h: def.shape.height };
  return { rTop: def.shape.size.x / 2, rBot: def.shape.size.x / 2, h: def.shape.size.y };
}

export function boxDims(def: PartDef): { w: number; h: number; d: number } {
  if (def.shape.kind === 'box') return { w: def.shape.size.x, h: def.shape.size.y, d: def.shape.size.z };
  const r = Math.max(def.shape.radiusTop, def.shape.radiusBottom);
  return { w: r * 2, h: def.shape.height, d: r * 2 };
}

/** Surface-attach mount point (y, z) of a radial part. */
export function srfMount(def: PartDef): { y: number; z: number } {
  const n = def.attachNodes.find((a) => a.id === 'srf');
  return n ? { y: n.position.y, z: n.position.z } : { y: 0, z: -boxDims(def).d / 2 };
}

export const num = (def: PartDef, key: string, fallback: number): number => {
  const v = def.meshParams?.[key];
  return typeof v === 'number' ? v : fallback;
};
export const str = (def: PartDef, key: string, fallback: string): string => {
  const v = def.meshParams?.[key];
  return typeof v === 'string' ? v : fallback;
};
