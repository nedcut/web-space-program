import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { grp, mk } from '../geom';
import { num, srfMount } from './common';

/**
 * Planform in (z = span, y = chord) with the root centre at the origin, extruded in X by the
 * thickness with rounded (bevelled) edges. Returns geometry in part orientation.
 */
function slab(poly: [number, number][], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([z, y]) => new THREE.Vector2(z, y)));
  const bevel = thickness * 0.42;
  const depth = Math.max(thickness - bevel * 2, thickness * 0.15);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: Math.min(bevel, 0.03),
    bevelSegments: 3,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // shape X -> part +Z, extrusion -> part X
  g.computeVertexNormals();
  return g;
}

interface Planform {
  cr: number;
  ct: number;
  span: number;
  sweep: number;
  t: number;
  f: number;
}

function planform(def: PartDef): Planform {
  return {
    cr: num(def, 'rootChord', 1),
    ct: num(def, 'tipChord', 0.5),
    span: num(def, 'span', 1),
    sweep: num(def, 'sweep', 0),
    t: num(def, 'thickness', 0.06),
    f: num(def, 'ctrlFraction', 0),
  };
}

function surface(def: PartDef, skin: THREE.Material, edge: THREE.Material, flapSkin: THREE.Material, allMoving: boolean): THREE.Object3D {
  const p = planform(def);
  const { y: my, z: mz } = srfMount(def);
  const root = grp('surface');
  const holder = grp();
  holder.position.set(0, my, mz);
  root.add(holder);
  const inset = Math.min(p.t * 0.42, 0.03);
  const z0 = inset;
  const z1 = p.span - inset;
  const leR = p.cr / 2 - inset;
  const teR = -p.cr / 2 + inset;
  const leT = p.cr / 2 - p.sweep - inset;
  const teT = p.cr / 2 - p.sweep - p.ct + inset;
  const f = allMoving ? 1 : p.f;
  const hR = leR + (teR - leR) * (1 - f);
  const hT = leT + (teT - leT) * (1 - f);
  const gap = f > 0 && f < 1 ? 0.012 : 0;

  if (f < 1) {
    const poly: [number, number][] = [[z0, leR], [z1, leT], [z1, f > 0 ? hT + gap : teT], [z0, f > 0 ? hR + gap : teR]];
    holder.add(mk(slab(poly, p.t), [skin, edge], 'fixedSurface'));
  }
  if (f > 0) {
    const pivot = new THREE.Vector3(0, hR, z0);
    const axis = new THREE.Vector3(0, hT - hR, z1 - z0).normalize();
    const cs = grp('controlSurface');
    cs.position.copy(pivot);
    cs.userData.hingeAxis = [axis.x, axis.y, axis.z];
    const poly: [number, number][] = [[z0, hR - gap], [z1, hT - gap], [z1, teT], [z0, teR]];
    const g = slab(poly, p.t * (allMoving ? 1 : 0.8));
    g.translate(-pivot.x, -pivot.y, -pivot.z);
    cs.add(mk(g, [flapSkin, edge], 'flap'));
    if (allMoving) {
      const hinge = new THREE.CylinderGeometry(p.t * 0.35, p.t * 0.35, z1 - z0 + 0.04, 10);
      hinge.rotateX(Math.PI / 2);
      hinge.translate(0, 0, (z1 - z0) / 2);
      holder.add(mk(hinge, M.gunmetal(), 'hinge'));
      // hinge root fitting
      const fit = new THREE.BoxGeometry(p.t * 1.4, p.cr * 0.5, 0.05);
      fit.translate(0, hR - p.cr * 0.15, 0.02);
      holder.add(mk(fit, M.gunmetal()));
    }
    holder.add(cs);
  }
  return root;
}

export function buildFin(def: PartDef): THREE.Object3D {
  return surface(def, M.whitePanel(), M.charcoalPanel(), M.accent('orange'), false);
}

export function buildWing(def: PartDef): THREE.Object3D {
  const big = num(def, 'rootChord', 1) > 2.5;
  return surface(def, big ? M.satinWhite() : M.greyPanel(), M.charcoalPanel(), M.greyPanel(), false);
}

export function buildControlSurface(def: PartDef): THREE.Object3D {
  return surface(def, M.greyPanel(), M.charcoalPanel(), M.greyPanel(), true);
}
