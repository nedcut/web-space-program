import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { decalOnLathe, decalPlane, decals, type DecalPlacement, type Region } from '../decals';
import { detailLevel, merge, mk } from '../geom';
import { liveryFor, type Livery } from '../livery';
import { M } from '../materials';

/**
 * Collects decal quads for one part and emits them as a single mesh using the shared decal
 * material (see decals.ts). Decals never cast shadows.
 */
export class Markings {
  readonly livery: Livery;
  private geos: THREE.BufferGeometry[] = [];

  constructor(readonly def: PartDef) {
    this.livery = liveryFor(def.manufacturer);
  }

  /** Conforming decal on a surface of revolution r(y). */
  lathe(rOf: (y: number) => number, region: Region, p: DecalPlacement) {
    this.geos.push(decalOnLathe(rOf, region, p));
    return this;
  }

  /** On a cylinder of radius r. */
  cyl(r: number, region: Region, p: DecalPlacement) {
    return this.lathe(() => r, region, p);
  }

  /** Flat decal; `place` positions/orients the +Z-facing quad. */
  plane(region: Region, height: number, place: (g: THREE.BufferGeometry) => void, width?: number) {
    const g = decalPlane(region, height, width);
    place(g);
    this.geos.push(g);
    return this;
  }

  /** Fit a decal of `aspect` into a box (maxAlong × maxAcross), returning its height. */
  static fit(region: Region, maxH: number, maxW: number): number {
    return Math.min(maxH, maxW / region.aspect);
  }

  get badge() {
    return decals.badge(this.livery.id);
  }
  get badgeDark() {
    return decals.badge(this.livery.id, true);
  }
  get logo() {
    return decals.logo(this.livery.id);
  }
  get plate() {
    return decals.partPlate(this.def);
  }
  get plateDark() {
    return decals.partPlate(this.def, true);
  }

  /** Emit the decal mesh into `root` (no-op when empty). */
  addTo(root: THREE.Object3D, name = 'decals') {
    // Low-detail templates skip decals entirely (they are sub-pixel at LOD distances).
    if (!this.geos.length || detailLevel() < 1) return;
    const m = mk(merge(this.geos), M.decal(), name);
    m.castShadow = false;
    root.add(m);
  }
}
