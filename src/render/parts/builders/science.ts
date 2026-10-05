import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { decals } from '../decals';
import { around, box, cyl, grp, lathe, mk, pipe, rod, sphere, torus, type Profile } from '../geom';
import { M } from '../materials';
import { boxDims, srfMount } from './common';
import { Markings } from './markings';

const PI = Math.PI;

/**
 * Radial science instruments and antennas. Every design sits on a bolted mount plate whose back
 * face is the authored srf mount plane (−Z); the instrument faces +Z. Each experiment and antenna
 * gets its own recognisable silhouette.
 */
export function buildInstrument(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('instrument');
  const D = new Markings(def);
  // mount plate with corner bolts
  const pt = 0.014;
  const plate = box(w * 0.92, h * 0.92, pt);
  plate.translate(0, 0, zm + pt / 2);
  root.add(mk(plate, M.gunmetal(), 'mountPlate'));
  const bolts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const b = cyl(0.008, 0.008, 0.008, 6);
      b.rotateX(PI / 2);
      b.translate(sx * w * 0.4, sy * h * 0.4, zm + pt + 0.004);
      bolts.push(b);
    }
  root.add(mk(bolts, M.chrome()));
  const z0 = zm + pt; // front of the plate
  const builder = DESIGNS[def.id] ?? housingOnly;
  builder({ root, D, w, h, d, z0 });
  D.addTo(root);
  return root;
}

interface Ctx {
  root: THREE.Object3D;
  D: Markings;
  w: number;
  h: number;
  d: number;
  /** Front face of the mount plate. */
  z0: number;
}

/** Electronics housing with a logo and a status LED; returns its front z. */
function housing(c: Ctx, hw: number, hh: number, depth: number, mat: THREE.Material = M.whitePanel(), y = 0): number {
  const b = box(hw, hh, depth, 0.5);
  b.translate(0, y, c.z0 + depth / 2);
  c.root.add(mk(b, mat, 'housing'));
  // edge trim
  const trim = box(hw + 0.006, 0.01, depth + 0.004);
  c.root.add(mk([trim.clone().translate(0, y + hh / 2, c.z0 + depth / 2), trim.translate(0, y - hh / 2, c.z0 + depth / 2)], M.gunmetal()));
  const zf = c.z0 + depth;
  const lg = c.D.logo;
  const s = Math.min(hw, hh) * 0.28;
  c.D.plane(lg, s, (g) => g.translate(-hw / 2 + s * 0.7, y + hh / 2 - s * 0.7, zf + 0.002));
  const led = box(0.012, 0.008, 0.006);
  led.translate(hw / 2 - 0.02, y - hh / 2 + 0.02, zf + 0.003);
  c.root.add(mk(led, M.statusLed('green')));
  return zf;
}

function housingOnly(c: Ctx) {
  housing(c, c.w * 0.8, c.h * 0.8, c.d * 0.6);
}

const DESIGNS: Record<string, (c: Ctx) => void> = {
  'sensor-thermal': (c) => {
    // compact box with radiator fins and a long thermocouple probe on a stand-off
    const zf = housing(c, c.w * 0.62, c.h * 0.5, c.d * 0.35, M.whitePanel(), -c.h * 0.18);
    const fins = box(c.w * 0.62, 0.004, c.d * 0.25);
    const g: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) g.push(fins.clone().translate(0, c.h * 0.1 + i * 0.016, c.z0 + c.d * 0.13));
    c.root.add(mk(g, M.aluminium(), 'fins'));
    const zp = (zf + c.z0) / 2 + c.d * 0.2;
    c.root.add(mk([rod([0, -c.h * 0.05, zf - 0.01], [0, c.h * 0.12, zp], 0.008, 6), rod([0, c.h * 0.12, zp], [0, c.h * 0.46, zp], 0.004, 6)], M.chrome(), 'probe'));
    c.root.add(mk(sphere(0.009, 10, 8).translate(0, c.h * 0.47, zp), M.redOxide()));
    c.root.add(mk(cyl(0.012, 0.012, 0.03, 10, c.h * 0.14).translate(0, 0, zp), M.blackPaint()));
  },
  'sensor-pressure': (c) => {
    const zf = housing(c, c.w * 0.7, c.h * 0.42, c.d * 0.3, M.whitePanel(), -c.h * 0.22);
    // titanium capsule with an inlet grid on a short neck
    const R = Math.min(c.w, c.d) * 0.3;
    const zc = (c.z0 + zf) / 2 + 0.01;
    const yc = c.h * 0.2;
    c.root.add(mk(sphere(R, 24, 16).translate(0, yc, zc), M.titanium(), 'capsule'));
    c.root.add(mk(torus(R * 1.01, 0.004, 4, 32).rotateX(PI / 2).translate(0, yc, zc), M.gunmetal()));
    const yN0 = -c.h * 0.01;
    const yN1 = yc - R * 0.85;
    c.root.add(mk(cyl(R * 0.3, R * 0.4, yN1 - yN0, 12, (yN0 + yN1) / 2).translate(0, 0, zc), M.gunmetal(), 'neck'));
    const inlet = cyl(R * 0.35, R * 0.35, 0.02, 16);
    inlet.translate(0, yc + R * 0.98, zc);
    c.root.add(mk(inlet, M.darkMetal(), 'inlet'));
    c.root.add(mk(around(box(0.004, 0.022, R * 0.6).translate(0, yc + R * 0.98, 0), 6, 0).map((g) => g.translate(0, 0, zc)), M.chrome()));
  },
  'sensor-seismic': (c) => {
    // squat drum with a downward penetrator spike and three levelling feet
    const zf = c.z0 + c.d * 0.55;
    const R = Math.min(c.w, c.d) * 0.4;
    const zc = (c.z0 + zf) / 2 + 0.01;
    const drum = lathe([[0, -c.h * 0.05], [R, -c.h * 0.05], [R * 1.02, -c.h * 0.03], [R * 1.02, c.h * 0.18], [R * 0.9, c.h * 0.22], [0, c.h * 0.22]], { segments: 32, tile: 0.5 });
    drum.translate(0, 0, zc);
    c.root.add(mk(drum, M.goldFoil(), 'drum'));
    c.root.add(mk(lathe([[R * 1.03, c.h * 0.03], [R * 1.03, c.h * 0.09]], { segments: 32, tile: 0.25 }).translate(0, 0, zc), M.hazard(), 'band'));
    const spike = lathe([[0, -c.h * 0.48], [0.012, -c.h * 0.42], [0.016, -c.h * 0.05]], { segments: 12 });
    spike.translate(0, 0, zc);
    c.root.add(mk(spike, M.steel(), 'spike'));
    const feet: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2 + PI / 6;
      feet.push(rod([Math.sin(a) * R * 0.8, -c.h * 0.04, zc + Math.cos(a) * R * 0.5], [Math.sin(a) * R * 1.25, -c.h * 0.3, zc + Math.cos(a) * R * 0.75], 0.006, 6));
    }
    c.root.add(mk(feet, M.gunmetal(), 'feet'));
    c.root.add(mk(rod([0, c.h * 0.22, zc], [0, c.h * 0.3, c.z0 + 0.01], 0.007, 6), M.cable()));
    housing(c, c.w * 0.5, c.h * 0.16, c.d * 0.12, M.whitePanel(), c.h * 0.36);
  },
  'sensor-magnetic': (c) => {
    // stowed boom: hinge block, carbon boom along +Y and a gold sensor head
    const zf = housing(c, c.w * 0.55, c.h * 0.3, c.d * 0.35, M.whitePanel(), -c.h * 0.3);
    const zb = c.z0 + c.d * 0.5;
    c.root.add(mk(box(0.05, 0.05, 0.05).translate(0, -c.h * 0.12, zb), M.gunmetal(), 'hinge'));
    c.root.add(mk(cyl(0.012, 0.012, c.h * 0.5, 10, c.h * 0.15).translate(0, 0, zb), M.carbon(), 'boom'));
    const head = lathe([[0, 0], [0.03, 0.005], [0.035, 0.03], [0.03, 0.06], [0, 0.065]], { segments: 16 });
    head.translate(0, c.h * 0.4, zb);
    c.root.add(mk(head, M.goldFoil(), 'sensorHead'));
    c.root.add(mk(pipe([[0.012, -c.h * 0.15, zf], [0.02, -c.h * 0.1, zb], [0.014, c.h * 0.38, zb]], 0.003, 4, 16), M.cable()));
    c.root.add(mk([0.0, 0.2].map((t) => torus(0.014, 0.003, 4, 12).translate(0, c.h * t, zb)), M.aluminium()));
  },
  'sensor-gravity': (c) => {
    const zf = housing(c, c.w * 0.82, c.h * 0.78, c.d * 0.42, M.goldFoil());
    // twin proof-mass canisters with sealed caps
    for (const sx of [-1, 1]) {
      const can = lathe([[0, 0], [0.045, 0], [0.05, 0.01], [0.05, c.d * 0.28], [0.04, c.d * 0.3], [0, c.d * 0.3]], { segments: 20 });
      can.rotateX(PI / 2);
      can.translate(sx * c.w * 0.2, -c.h * 0.05, zf - 0.005);
      c.root.add(mk(can, M.titanium(), 'proofMass'));
      c.root.add(mk(torus(0.051, 0.004, 4, 20).translate(sx * c.w * 0.2, -c.h * 0.05, zf + c.d * 0.14), M.anodised('red')));
    }
    c.root.add(mk(pipe([[-c.w * 0.2, -c.h * 0.05, zf + c.d * 0.2], [0, c.h * 0.08, zf + c.d * 0.24], [c.w * 0.2, -c.h * 0.05, zf + c.d * 0.2]], 0.005, 5, 18), M.cable()));
  },
  'sensor-sample': (c) => {
    const zf = housing(c, c.w * 0.8, c.h * 0.7, c.d * 0.4, M.whitePanel(), -c.h * 0.05);
    // carousel drum with sample cups, and a scoop arm folded alongside
    const R = c.w * 0.22;
    const car = cyl(R, R, c.d * 0.18, 24);
    car.rotateX(PI / 2);
    car.translate(-c.w * 0.1, -c.h * 0.02, zf + c.d * 0.09);
    c.root.add(mk(car, M.aluminium(), 'carousel'));
    const cups = around(cyl(0.016, 0.014, 0.012, 10).rotateX(PI / 2), 6, R * 0.65, 0).map((g) => g.rotateX(PI / 2).translate(-c.w * 0.1, -c.h * 0.02, zf + c.d * 0.185));
    c.root.add(mk(cups, M.darkMetal(), 'cups'));
    c.root.add(mk([rod([c.w * 0.3, -c.h * 0.3, zf + 0.01], [c.w * 0.3, c.h * 0.25, zf + 0.03], 0.008, 6)], M.gunmetal(), 'arm'));
    const scoop = lathe([[0, 0], [0.02, 0.005], [0.028, 0.03], [0.026, 0.04]], { segments: 12, phiLength: PI });
    scoop.translate(c.w * 0.3, c.h * 0.26, zf + 0.03);
    c.root.add(mk(scoop, M.steel(), 'scoop'));
  },
  'sensor-exposure': (c) => {
    // open tray of material coupons with the lid hinged up
    const zf = housing(c, c.w * 0.86, c.h * 0.62, c.d * 0.22, M.whitePanel(), -c.h * 0.12);
    const mats = [M.goldFoil(), M.carbon(), M.copperTubes(), M.satinWhite(), M.anodised('blue'), M.titanium()];
    const cw = (c.w * 0.76) / 3;
    const ch = (c.h * 0.5) / 2;
    for (let i = 0; i < 6; i++) {
      const cpn = box(cw * 0.86, ch * 0.82, 0.008);
      cpn.translate(-c.w * 0.38 + cw * (i % 3 + 0.5), -c.h * 0.12 - c.h * 0.25 + ch * (Math.floor(i / 3) + 0.5), zf + 0.004);
      c.root.add(mk(cpn, mats[i]));
    }
    const lid = box(c.w * 0.86, 0.012, c.d * 0.5);
    lid.translate(0, c.h * 0.2, zf + c.d * 0.2);
    c.root.add(mk(lid, M.whitePanel(), 'lid'));
    c.root.add(mk(cyl(0.008, 0.008, c.w * 0.8, 8).rotateZ(PI / 2).translate(0, c.h * 0.19, zf - 0.005), M.chrome(), 'hinge'));
  },
  'antenna-thread': (c) => {
    // feed box and a three-stage telescoping whip
    const zf = housing(c, c.w * 0.7, c.h * 0.3, c.d * 0.35, M.whitePanel(), -c.h * 0.3);
    const za = (c.z0 + zf) / 2;
    const segs: THREE.BufferGeometry[] = [];
    let y = -c.h * 0.15;
    for (const [r, l] of [[0.009, 0.22], [0.0065, 0.2], [0.0045, 0.18]] as const) {
      segs.push(cyl(r, r, l * c.h, 8, y + (l * c.h) / 2).translate(0, 0, za));
      y += l * c.h * 0.95;
    }
    c.root.add(mk(segs, M.chrome(), 'whip'));
    c.root.add(mk(sphere(0.01, 10, 8).translate(0, y, za), M.blackPaint()));
    c.root.add(mk(cyl(0.02, 0.024, 0.04, 12, -c.h * 0.13).translate(0, 0, za), M.blackPaint(), 'feed'));
  },
  'antenna-relay': (c) => {
    // lattice mast with Yagi-style elements
    housing(c, c.w * 0.8, c.h * 0.12, c.d * 0.4, M.whitePanel(), -c.h * 0.42);
    const zm2 = c.z0 + c.d * 0.45;
    const s = c.w * 0.12;
    const y0 = -c.h * 0.36;
    const y1 = c.h * 0.46;
    const legs: THREE.BufferGeometry[] = [];
    const corners: [number, number][] = [[-s, -s], [s, -s], [0, s]];
    for (const [x, z] of corners) legs.push(rod([x, y0, zm2 + z], [x * 0.5, y1, zm2 + z * 0.5], 0.004, 4));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const a = corners[i % 3];
      const b = corners[(i + 1) % 3];
      const k0 = 1 - 0.5 * t0;
      const k1 = 1 - 0.5 * t1;
      legs.push(rod([a[0] * k0, y0 + (y1 - y0) * t0, zm2 + a[1] * k0], [b[0] * k1, y0 + (y1 - y0) * t1, zm2 + b[1] * k1], 0.0025, 4));
    }
    c.root.add(mk(legs, M.aluminium(), 'mast'));
    const el: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const y = y0 + (y1 - y0) * (0.2 + i * 0.18);
      const half = c.w * (0.45 - i * 0.05);
      el.push(rod([-half, y, zm2 + s * 0.4], [half, y, zm2 + s * 0.4], 0.003, 4));
    }
    c.root.add(mk(el, M.chrome(), 'elements'));
    c.root.add(mk(sphere(0.014, 10, 8).translate(0, y1 + 0.01, zm2), M.statusLed('red'), 'beacon'));
  },
  'antenna-arc': (c) => dish(c, false),
  'antenna-horizon': (c) => dish(c, true),
};

/** Parabolic dish facing +Z on a gimbal post; `large` adds a Cassegrain sub-reflector and foil backing. */
function dish(c: Ctx, large: boolean) {
  const R = Math.min(c.w, c.h) * 0.48;
  const depth = R * 0.32;
  const zPost = c.z0 + c.d * 0.25;
  // post + yoke
  c.root.add(mk(cyl(R * 0.08, R * 0.11, c.d * 0.25, 16).rotateX(PI / 2).translate(0, -R * 0.05, c.z0 + c.d * 0.125), M.gunmetal(), 'post'));
  c.root.add(mk(box(R * 0.32, R * 0.12, R * 0.12).translate(0, -R * 0.05, zPost), M.darkMetal(), 'gimbal'));
  // reflector: front (paint) and back (foil/structure)
  const prof: Profile = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const r = (i / n) * R;
    prof.push([r, (r * r) / (R * R) * depth]);
  }
  // rim -> centre so normals face the concave (front) side
  const front = lathe(prof.slice().reverse(), { segments: large ? 48 : 40, tile: R });
  front.rotateX(PI / 2);
  front.translate(0, 0, zPost + 0.03);
  c.root.add(mk(front, M.satinWhite(), 'reflector'));
  const back = lathe(prof.map(([r, y]) => [r, y - 0.012] as [number, number]), { segments: large ? 48 : 40, tile: R });
  back.rotateX(PI / 2);
  back.translate(0, 0, zPost + 0.03);
  c.root.add(mk(back, large ? M.goldFoil() : M.greyPanel(), 'reflectorBack'));
  c.root.add(mk(torus(R, 0.008, 4, large ? 48 : 40).rotateX(PI / 2).translate(0, 0, zPost + 0.03 + depth), M.aluminium(), 'rim'));
  // ribs on the back
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    ribs.push(rod([Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12, zPost + 0.015], [Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, zPost + 0.02 + depth * 0.9], 0.005, 4));
  }
  c.root.add(mk(ribs, M.gunmetal(), 'ribs'));
  // feed: tripod struts to a horn (and sub-reflector for the large dish)
  const zFeed = zPost + 0.03 + depth + R * (large ? 0.42 : 0.55);
  const struts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = PI / 2 + (i / 3) * PI * 2;
    struts.push(rod([Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92, zPost + 0.03 + depth * 0.95], [0, 0, zFeed - 0.02], 0.005, 5));
  }
  c.root.add(mk(struts, M.aluminium(), 'feedStruts'));
  const horn = lathe([[0.012, 0], [0.03, 0.06], [0.034, 0.065]], { segments: 16 });
  horn.rotateX(-PI / 2);
  horn.translate(0, 0, zFeed);
  c.root.add(mk(horn, M.gunmetal(), 'feedHorn'));
  if (large) {
    const sub = lathe([[0, 0], [R * 0.12, -0.012], [R * 0.13, -0.006]], { segments: 24 });
    sub.rotateX(PI / 2);
    sub.translate(0, 0, zFeed + 0.01);
    c.root.add(mk(sub, M.chrome(), 'subReflector'));
  }
  // agency insignia on the reflector face
  c.D.plane(decals.insignia(), R * 0.28, (g) => g.translate(0, -R * 0.55, zPost + 0.03 + depth * 0.3 + 0.012));
}
