import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { bevelBox, box, detailLevel, grp, lathe, mk, rod, tint } from '../geom';
import { decals } from '../decals';
import { Markings } from './markings';

const PI = Math.PI;
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

  const fine = detailLevel() === 1;
  // chord line helpers: leading/trailing edge y at span station z
  const at = (a: number, b: number, z: number) => a + ((b - a) * (z - z0)) / Math.max(1e-6, z1 - z0);
  const le = (z: number) => at(leR, leT, z);
  const te = (z: number) => at(teR, teT, z);
  const hy = (z: number) => at(hR, hT, z);
  /** Thin raised line on both faces between two (z, y) points; pz shifts it into a moving frame. */
  const line = (za: number, ya: number, zb: number, yb: number, w: number, th: number, out: THREE.BufferGeometry[], k: number, pz = new THREE.Vector3()) => {
    const len = Math.hypot(zb - za, yb - ya);
    if (len < 0.02) return;
    for (const sx of [-1, 1]) {
      const g = box(0.0024, w, len);
      g.rotateX(-Math.atan2(yb - ya, zb - za));
      g.translate(sx * (th / 2 + 0.0004), (ya + yb) / 2, (za + zb) / 2);
      g.translate(-pz.x, -pz.y, -pz.z);
      out.push(tint(g, k));
    }
  };

  if (f < 1) {
    const poly: [number, number][] = [[z0, leR], [z1, leT], [z1, f > 0 ? hT + gap : teT], [z0, f > 0 ? hR + gap : teR]];
    holder.add(mk(slab(poly, p.t), [skin, edge], 'fixedSurface'));
    if (fine) {
      // front spar, rear spar / hinge-line rivet rows and ribs about every 0.5 m (darker tint on the skin paint)
      const lines: THREE.BufferGeometry[] = [];
      const iz0 = z0 + 0.04, iz1 = z1 - 0.04;
      const rear = (z: number) => (f > 0 ? hy(z) + gap + 0.03 : te(z) + 0.04);
      line(iz0, le(iz0) - 0.22 * (le(iz0) - rear(iz0)), iz1, le(iz1) - 0.22 * (le(iz1) - rear(iz1)), 0.014, p.t, lines, 0.78);
      line(iz0, rear(iz0) + 0.03, iz1, rear(iz1) + 0.03, 0.014, p.t, lines, 0.78);
      const nR = Math.max(1, Math.round((z1 - z0) / 0.5));
      for (let i = 1; i < nR; i++) {
        const z = z0 + ((z1 - z0) * i) / nR;
        line(z, le(z) - 0.05, z, rear(z) + 0.03, 0.01, p.t, lines, 0.84);
      }
      if (lines.length) holder.add(mk(lines, skin, 'panelLines'));
      // no-step stencils near the root on both faces
      if ((z1 - z0) > 0.5 && (leR - teR) > 0.5) {
        const D = new Markings(def);
        const ns = decals.text('NO STEP', { color: '#2a2d33', stencil: true });
        const hgt = Math.min(0.05, (leR - teR) * 0.05);
        const zc = z0 + Math.min(0.35, (z1 - z0) * 0.25), yc = (le(zc) + rear(zc)) / 2;
        for (const sx of [-1, 1]) D.plane(ns, hgt, (g) => g.rotateY(sx * PI / 2).rotateX(sx > 0 ? -PI / 2 : PI / 2).translate(sx * (p.t / 2 + 0.0012), yc, zc));
        D.addTo(holder);
      }
    }
    // titanium leading-edge strip
    const rl = p.t * 0.48;
    const leG = rod([0, leR + inset - rl * 0.85, z0], [0, leT + inset - rl * 0.85, z1 + inset * 0.5], rl, fine ? 10 : 6);
    holder.add(mk(leG, M.titanium(), 'leadingEdge'));
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
    if (fine) {
      const lines: THREE.BufferGeometry[] = [];
      const ft = p.t * (allMoving ? 1 : 0.8);
      const nR = Math.max(1, Math.round((z1 - z0) / 0.35));
      for (let i = 1; i < nR; i++) {
        const z = z0 + ((z1 - z0) * i) / nR;
        line(z, hy(z) - gap - 0.03, z, te(z) + 0.03, 0.009, ft, lines, 0.82, pivot);
      }
      line(z0 + 0.03, hy(z0 + 0.03) - gap - 0.05, z1 - 0.03, hy(z1 - 0.03) - gap - 0.05, 0.012, ft, lines, 0.8, pivot);
      if (lines.length) cs.add(mk(lines, flapSkin, 'flapLines'));
    }
    if (allMoving) {
      const hinge = new THREE.CylinderGeometry(p.t * 0.35, p.t * 0.35, z1 - z0 + 0.04, 10);
      hinge.rotateX(Math.PI / 2);
      hinge.translate(0, 0, (z1 - z0) / 2);
      holder.add(mk(hinge, M.gunmetal(), 'hinge'));
      // hinge root fitting
      const fit = new THREE.BoxGeometry(p.t * 1.4, p.cr * 0.5, 0.05);
      fit.translate(0, hR - p.cr * 0.15, 0.02);
      holder.add(mk(fit, M.gunmetal()));
    } else {
      // dark seal in the hinge gap, hinge brackets straddling it, and an actuator fairing under the surface
      const ang = -Math.atan2(hT - hR, z1 - z0);
      const len = Math.hypot(hT - hR, z1 - z0);
      const seal = box(p.t * 0.62, gap * 2.2, len - 0.02).rotateX(ang).translate(0, (hR + hT) / 2, (z0 + z1) / 2);
      holder.add(mk(seal, M.darkMetal(), 'hingeGap'));
      const hw: THREE.BufferGeometry[] = [];
      const nH = Math.max(2, Math.round(len / 0.4));
      for (let i = 0; i < nH; i++) {
        const z = z0 + ((z1 - z0) * (i + 0.5)) / nH;
        hw.push(bevelBox(p.t * 0.9, gap * 2 + 0.05, 0.03).rotateX(ang).translate(0, hy(z), z));
      }
      if (fine) {
        // actuator fairing on one face at ~35 % span
        const za = z0 + (z1 - z0) * 0.35;
        const fl = Math.min(0.2, (le(za) - te(za)) * 0.28);
        const fair = lathe([[0, -fl / 2], [p.t * 0.22, -fl * 0.3], [p.t * 0.24, fl * 0.15], [p.t * 0.1, fl * 0.45], [0, fl / 2]], { segments: 10 });
        fair.scale(1, 1, 0.6);
        fair.translate(-p.t * 0.5, hy(za) + fl * 0.25, za);
        hw.push(fair);
      }
      holder.add(mk(hw, M.gunmetal(), 'hingeBrackets'));
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
