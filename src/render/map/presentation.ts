import type { Body } from '../../sim/bodies/types';

export interface LabelBox { x: number; y: number; width: number; height: number }
/** Mutates a reusable box pool; priority is supplied by caller order. */
export function placeLabel(box: LabelBox, accepted: LabelBox[], count: number): boolean {
  for (let i = 0; i < count; i++) {
    const other = accepted[i];
    if (box.x < other.x + other.width + 8 && box.x + box.width + 8 > other.x
      && box.y < other.y + other.height + 4 && box.y + box.height + 4 > other.y) return false;
  }
  return true;
}

export function bodyBreadcrumbs(body: Body, bodies: ReadonlyMap<string, Body>): Body[] {
  const chain = [body];
  let parent = body.parent;
  while (parent) {
    const b = bodies.get(parent);
    if (!b || chain.includes(b)) break;
    chain.unshift(b); parent = b.parent;
  }
  return chain;
}

const FAMILY_COLORS: Record<string, number> = {
  mercury: 0xb7b3aa, venus: 0xe8c982, earth: 0x70baff, mars: 0xe89976,
  jupiter: 0xd1b39c, saturn: 0xe7ce91, uranus: 0x8cdde0, neptune: 0x759cfa,
  pluto: 0xbfa6dc, ceres: 0xadbea0,
};
export function familyColor(body: Body, bodies: ReadonlyMap<string, Body>): number {
  let family = body;
  while (family.parent && bodies.get(family.parent)?.kind !== 'star') {
    const parent = bodies.get(family.parent);
    if (!parent) break;
    family = parent;
  }
  return FAMILY_COLORS[family.id] ?? 0xffe5a3;
}
