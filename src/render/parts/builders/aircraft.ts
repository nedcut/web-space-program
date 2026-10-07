import * as THREE from 'three';
import type { PartDef, WheelModule } from '../../../sim/vessel/types';
import { gearLayout } from '../../../data/parts';
import { M } from '../materials';
import { bevelBox, box, cyl, cylinder, detailLevel, grp, lathe, mk, pipe, rod, setDeployData, sphere, torus, type Profile } from '../geom';
import { boxDims, cylDims, num, srfMount, str } from './common';

/**
 * Aircraft parts: jet engines, intakes, cockpit, fuselage sections and landing gear.
 *
 * Landing gear animation nodes (driven by setPartDeploy / setGearPose):
 *  - 'gearStrut'  rotates about X at the hinge: folded (stowed) -> straight down along +Z (deployed)
 *  - 'gearSlide'  slides along the strut by the suspension compression
 *  - 'gearSteer'  rotates about the strut axis (steerable gear)
 *  - 'gearWheel'  spins about the axle (part X)
 */

const PI = Math.PI;

function exhaustAnchor(y: number, exitRadius: number): THREE.Object3D {
  const a = new THREE.Object3D();
  a.name = 'exhaustAnchor';
  a.position.set(0, y, 0);
  a.userData.exitRadius = exitRadius;
  return a;
}

// ---------------------------------------------------------------------------------------------
// Jet engines
// ---------------------------------------------------------------------------------------------

export function buildJetEngine(def: PartDef): THREE.Object3D {
  const { rTop: R, h } = cylDims(def);
  const yT = h / 2, yB = -h / 2;
  const re = num(def, 'exitRadius', 0.42);
  const afterburner = str(def, 'style', 'turbofan') === 'afterburner';
  const root = grp('jetEngine');
  // Mounting flange at the top node.
  root.add(mk(lathe([[R * 0.9, yT - 0.06], [R, yT - 0.05], [R, yT], [R * 0.9, yT]], { segments: 48 }), M.gunmetal(), 'flange'));
  if (!afterburner) {
    // Fat turbofan nacelle: cowl, core cowl, and a short hot nozzle with a centre plug.
    const cowlEnd = yB + h * 0.32;
    const cowl: Profile = [[R * 0.97, yT - 0.06], [R, yT - 0.2], [R, cowlEnd + 0.25], [R * 0.93, cowlEnd + 0.04], [R * 0.9, cowlEnd]];
    root.add(mk(lathe(cowl, { segments: 56, tile: 0.8 }), M.satinWhite(), 'cowl'));
    root.add(mk(lathe([[R * 0.9, cowlEnd], [R * 0.86, cowlEnd], [R * 0.86, cowlEnd + 0.02]], { segments: 56 }), M.darkMetal()));
    // Accent band.
    root.add(mk(cylinder(R + 0.004, R + 0.004, 0.12, { segments: 56, caps: false, y: yT - 0.45 }), M.accent('teal')));
    // Core cowl down to the nozzle.
    const core: Profile = [[R * 0.78, cowlEnd + 0.02], [R * 0.74, yB + 0.22], [re, yB + 0.04], [re, yB]];
    root.add(mk(lathe(core, { segments: 48 }), M.titanium(), 'core'));
    root.add(mk(lathe([[re, yB], [re * 0.92, yB], [re * 0.92, yB + 0.12]], { segments: 40 }), M.soot()));
    // Centre plug.
    root.add(mk(lathe([[0, yB + 0.02], [re * 0.25, yB + 0.06], [re * 0.42, yB + 0.3], [re * 0.42, yB + 0.4]], { segments: 32 }), M.darkMetal(), 'plug'));
  } else {
    // Slim turbojet with a long reheat pipe and a convergent-divergent petal nozzle.
    const body: Profile = [[R * 0.97, yT - 0.06], [R, yT - 0.15], [R, yB + h * 0.45], [R * 0.9, yB + h * 0.3]];
    root.add(mk(lathe(body, { segments: 48, tile: 0.8 }), M.gunmetal(), 'body'));
    root.add(mk(cylinder(R + 0.004, R + 0.004, 0.1, { segments: 48, caps: false, y: yT - 0.35 }), M.accent('orange')));
    const pipe: Profile = [[R * 0.9, yB + h * 0.3], [R * 0.84, yB + 0.55], [R * 0.82, yB + 0.5]];
    root.add(mk(lathe(pipe, { segments: 48 }), M.titanium(), 'reheat'));
    const petals = 16;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * PI * 2;
      const g = box(0.17, 0.5, 0.025);
      g.rotateX(-0.12);
      g.translate(0, yB + 0.25, (R * 0.82 + re) / 2);
      g.rotateY(a);
      root.add(mk(g, M.darkMetal()));
    }
    root.add(mk(lathe([[re * 0.95, yB], [re * 0.95, yB + 0.5], [R * 0.6, yB + 0.6], [0, yB + 0.62]], { segments: 40 }), M.soot(), 'liner'));
    // Flame-holder ring.
    root.add(mk(torus(re * 0.55, 0.025, 6, 32).translate(0, yB + 0.45, 0), M.darkMetal()));
  }
  root.add(exhaustAnchor(yB, re));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Intakes
// ---------------------------------------------------------------------------------------------

export function buildIntake(def: PartDef): THREE.Object3D {
  return str(def, 'style', 'radial') === 'inline' ? buildInlineIntake(def) : buildRadialIntake(def);
}

function buildInlineIntake(def: PartDef): THREE.Object3D {
  const { rTop, rBot, h } = cylDims(def);
  const yB = -h / 2, yT = h / 2;
  const root = grp('intake');
  const lip = rTop * 0.92;
  root.add(mk(lathe([[rBot, yB], [rBot, yB + 0.1], [rTop, yT - 0.08], [rTop * 0.98, yT - 0.02], [lip, yT]], { segments: 56, tile: 0.8 }), M.satinWhite(), 'cowl'));
  root.add(mk(lathe([[lip, yT], [lip * 0.97, yT - 0.01], [lip * 0.9, yT - 0.12]], { segments: 56 }), M.titanium(), 'lip'));
  // Duct interior (dark) and the compressor face.
  root.add(mk(lathe([[lip * 0.9, yT - 0.12], [lip * 0.8, yB + 0.2], [lip * 0.78, yB + 0.15]], { segments: 40 }), M.innerLining(), 'duct'));
  root.add(mk(cyl(lip * 0.8, lip * 0.8, 0.02, 40, yB + 0.16), M.darkMetal()));
  // Translating spike.
  root.add(mk(lathe([[rTop * 0.42, yB + 0.2], [rTop * 0.42, yT - 0.35], [0.02, yT + 0.12], [0, yT + 0.13]], { segments: 40 }), M.titanium(), 'spike'));
  // Struts holding the spike.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 2;
    root.add(mk(rod([Math.sin(a) * rTop * 0.4, yT - 0.4, Math.cos(a) * rTop * 0.4], [Math.sin(a) * lip * 0.84, yT - 0.4, Math.cos(a) * lip * 0.84], 0.02), M.gunmetal()));
  }
  return root;
}

function buildRadialIntake(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: mz } = srfMount(def);
  const root = grp('intake');
  // Tapered scoop: profile in (y, z) extruded across X.
  const shape = new THREE.Shape();
  shape.moveTo(-h / 2, 0);
  shape.lineTo(h / 2, 0);
  shape.lineTo(h / 2, d);
  shape.lineTo(h / 2 - 0.12, d);
  shape.quadraticCurveTo(-h * 0.1, d * 0.95, -h / 2, d * 0.15);
  shape.lineTo(-h / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -w / 2);
  // shape (x, y) = (part y, part z); extrusion along shape z -> part x
  const m = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  g.translate(0, 0, mz);
  g.computeVertexNormals();
  root.add(mk(g, M.greyPanel(), 'scoop'));
  // Dark mouth at the front (+Y) face and a titanium lip.
  const mouth = box(w * 0.8, 0.02, d * 0.7);
  mouth.translate(0, h / 2 + 0.006, mz + d * 0.55);
  root.add(mk(mouth, M.blackPaint(), 'mouth'));
  const lip = box(w + 0.02, 0.04, 0.04);
  lip.translate(0, h / 2, mz + d - 0.01);
  root.add(mk(lip, M.titanium()));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Cockpit & fuselage
// ---------------------------------------------------------------------------------------------

export function buildCockpit(def: PartDef): THREE.Object3D {
  const { rTop, rBot: R, h } = cylDims(def);
  const yB = -h / 2, yT = h / 2;
  const root = grp('cockpit');
  // Ogive nose (body +Y = flight direction; canopy on +Z = top of the aircraft).
  const prof: Profile = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = yB + t * (h - 0.12);
    const r = rTop + (R - rTop) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.7)));
    prof.push([r, y]);
  }
  root.add(mk(lathe([[R, yB], ...prof.slice(1)], { segments: 56, tile: 0.8 }), M.satinWhite(), 'nose'));
  root.add(mk(lathe([[rTop, yT - 0.12], [rTop * 0.8, yT - 0.05], [0, yT]], { segments: 32 }), M.blackPaint(), 'radome'));
  root.add(mk(cylinder(R + 0.004, R + 0.004, 0.08, { segments: 56, caps: false, y: yB + 0.12 }), M.accent('blue')));
  // Bubble canopy and its frame.
  const canopy = sphere(1, 28, 16);
  canopy.scale(0.36, 0.82, 0.32);
  canopy.translate(0, yB + 0.95, R * 0.62);
  root.add(mk(canopy, M.glass(), 'canopy'));
  const frame = torus(1, 0.03, 6, 40);
  frame.rotateX(-PI / 2);
  frame.scale(0.37, 0.83, 1);
  frame.translate(0, yB + 0.95, R * 0.64);
  root.add(mk(frame, M.gunmetal(), 'canopyFrame'));
  root.add(mk(rod([0, yB + 0.95 + 0.55, R * 0.62 + 0.22], [0, yB + 0.95 + 0.6, R * 0.64], 0.025), M.gunmetal()));
  // Pitot probe and a step on the side.
  root.add(mk(rod([R * 0.25, yT - 0.6, 0.12], [R * 0.25, yT - 0.15, 0.12], 0.012), M.chrome()));
  root.add(mk(box(0.02, 0.18, 0.08).translate(R * 0.86, yB + 0.5, 0.1), M.darkMetal()));
  return root;
}

export function buildFuselage(def: PartDef): THREE.Object3D {
  const { rTop, rBot, h } = cylDims(def);
  const yB = -h / 2, yT = h / 2;
  const style = str(def, 'style', 'tank');
  const root = grp('fuselage');
  if (style === 'tailcone') {
    const prof: Profile = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      prof.push([rBot + (rTop - rBot) * Math.sin((t * PI) / 2), yB + t * h]);
    }
    root.add(mk(lathe([[0, yB], [rBot, yB], ...prof], { segments: 48, tile: 0.8 }), M.satinWhite(), 'cone'));
    root.add(mk(lathe([[rBot * 0.7, yB - 0.0], [rBot, yB]], { segments: 24 }), M.darkMetal()));
    root.add(mk(cylinder(rTop + 0.004, rTop + 0.004, 0.06, { segments: 48, caps: false, y: yT - 0.05 }), M.charcoalPanel()));
    return root;
  }
  root.add(mk(cylinder(rTop, rBot, h, { segments: 56, tile: 0.8 }), M.satinWhite(), 'skin'));
  // Frame bands at both joints, a stripe along the side, rivet-line band in the middle.
  root.add(mk(cylinder(rTop + 0.005, rTop + 0.005, 0.05, { segments: 56, caps: false, y: yT - 0.025 }), M.charcoalPanel()));
  root.add(mk(cylinder(rBot + 0.005, rBot + 0.005, 0.05, { segments: 56, caps: false, y: yB + 0.025 }), M.charcoalPanel()));
  if (style === 'tank') {
    root.add(mk(cylinder(rTop + 0.003, rTop + 0.003, 0.03, { segments: 56, caps: false }), M.gunmetal()));
    const stripe = box(0.01, h * 0.86, 0.08);
    stripe.translate(rTop + 0.003, 0, 0);
    root.add(mk(stripe, M.accent('blue')));
    const stripe2 = stripe.clone().translate(-2 * rTop - 0.006, 0, 0);
    root.add(mk(stripe2, M.accent('blue')));
    // Fuel filler cap on top.
    root.add(mk(cyl(0.06, 0.06, 0.02, 16).rotateX(PI / 2).translate(0, h * 0.25, rTop + 0.005), M.gunmetal()));
  }
  return root;
}

// ---------------------------------------------------------------------------------------------
// Landing gear
// ---------------------------------------------------------------------------------------------

function tyre(radius: number, width: number): THREE.BufferGeometry {
  const ri = radius * 0.6;
  const w = width / 2;
  // bead, sidewall with a rim-protector rib, rounded shoulder, tread crown
  const p: Profile = [
    [ri, -w * 0.88], [radius * 0.68, -w * 0.97], [radius * 0.72, -w * 1.01], [radius * 0.76, -w * 0.98],
    [radius * 0.9, -w * 0.94], [radius * 0.97, -w * 0.72], [radius, -w * 0.42], [radius, w * 0.42],
    [radius * 0.97, w * 0.72], [radius * 0.9, w * 0.94], [radius * 0.76, w * 0.98], [radius * 0.72, w * 1.01],
    [radius * 0.68, w * 0.97], [ri, w * 0.88],
  ];
  let arc = 0;
  for (let i = 1; i < p.length; i++) arc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  const g = lathe(p, { segments: 48, creaseAngle: PI, tile: arc, uRepeat: Math.max(4, Math.round(radius * 18)) });
  g.rotateZ(PI / 2); // axle along X
  return g;
}

/** Split-rim wheel: flanged rim halves, dished web with lightening holes, tie bolts, hub cap and valve stem. */
function wheelHub(radius: number, tw: number, fine: boolean): { metal: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; bolts: THREE.BufferGeometry[] } {
  const rr = radius * 0.6, w = tw / 2;
  const rim: Profile = [
    [rr * 0.2, -w * 0.62], [rr * 0.46, -w * 0.6], [rr * 0.56, -w * 0.78], [rr * 0.94, -w * 0.82], [rr * 1.04, -w * 0.9],
    [rr * 1.04, -w * 0.82], [rr * 0.98, -w * 0.72], [rr * 0.98, w * 0.72], [rr * 1.04, w * 0.82], [rr * 1.04, w * 0.9],
    [rr * 0.94, w * 0.82], [rr * 0.56, w * 0.78], [rr * 0.46, w * 0.6], [rr * 0.2, w * 0.62],
  ];
  // the lathe runs along Y; turn it so the axle is X
  const metal = [lathe(rim, { segments: 32, creaseAngle: 0.5 }).rotateZ(PI / 2)];
  // hub cap
  metal.push(lathe([[rr * 0.2, w * 0.62], [rr * 0.14, w * 0.74], [0, w * 0.76]], { segments: 16 }).rotateZ(PI / 2));
  metal.push(lathe([[0, -w * 0.76], [rr * 0.14, -w * 0.74], [rr * 0.2, -w * 0.62]], { segments: 16 }).rotateZ(PI / 2));
  const dark: THREE.BufferGeometry[] = [];
  const bolts: THREE.BufferGeometry[] = [];
  const nH = 6;
  for (let i = 0; i < nH; i++) {
    const a = (i / nH) * PI * 2 + PI / nH;
    // lightening holes on both web faces (dark discs just proud of the web)
    for (const sx of [-1, 1]) {
      const hole = new THREE.CircleGeometry(rr * 0.13, 12);
      hole.rotateY((sx * PI) / 2);
      hole.translate(sx * (w * 0.79 + 0.002), Math.sin(a) * rr * 0.74, Math.cos(a) * rr * 0.74);
      dark.push(hole);
    }
  }
  const nB = fine ? 10 : 5;
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * PI * 2;
    bolts.push(cyl(rr * 0.045, rr * 0.045, tw * 0.9, 6).rotateZ(PI / 2).translate(0, Math.sin(a) * rr * 0.36, Math.cos(a) * rr * 0.36));
  }
  if (fine) bolts.push(cyl(rr * 0.025, rr * 0.025, w * 0.5, 6).rotateZ(PI / 2).translate(w * 0.9, rr * 0.9, 0));
  return { metal, dark, bolts };
}

/** Torque-link (scissor) pose for an oleo whose link pivots are `d` apart; links have length l. */
function linkAngles(l: number, d: number): { up: number; low: number } {
  const half = Math.min(l * 0.98, Math.max(0.01, d / 2));
  const h = Math.sqrt(Math.max(0, l * l - half * half));
  return { up: -Math.asin(h / l), low: Math.atan2(-h / l, -half / l) };
}

export function buildGear(def: PartDef): THREE.Object3D {
  const radius = num(def, 'radius', 0.25);
  const strut = num(def, 'strut', 0.8);
  const fold = num(def, 'fold', 0) as -1 | 0 | 1;
  const steerable = def.meshParams?.steerable === true;
  const L = gearLayout(radius, strut, fold);
  const wheelMod = def.modules.find((m): m is WheelModule => m.type === 'wheel');
  const fine = detailLevel() === 1;
  const root = grp('gear');
  // Mount bracket on the parent surface (mount face at z = L.mountZ).
  const plate = box(L.width * 0.9, Math.min(L.size.y * 0.5, 0.5), 0.05);
  plate.translate(0, L.hinge.y * 0.5, L.mountZ + 0.025);
  const yoke = box(L.width * 0.7, 0.14, L.hinge.z - L.mountZ);
  yoke.translate(0, L.hinge.y, (L.hinge.z + L.mountZ) / 2);
  root.add(mk([plate, yoke], M.gunmetal(), 'mount'));
  if (fine) {
    const mb: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) mb.push(cyl(0.012, 0.012, 0.012, 6).rotateX(PI / 2).translate(sx * L.width * 0.38, L.hinge.y * 0.5 + sy * Math.min(L.size.y * 0.5, 0.5) * 0.4, L.mountZ + 0.054));
    mb.push(cyl(0.022, 0.022, L.width * 0.78, 10).rotateZ(PI / 2).translate(0, L.hinge.y, L.hinge.z));
    root.add(mk(mb, M.chrome(), 'mountBolts'));
  }
  // Strut: local +Z runs from the hinge to the wheel axle.
  const strutG = grp('gearStrut');
  strutG.position.set(0, L.hinge.y, L.hinge.z);
  root.add(strutG);
  const r0 = Math.max(0.035, radius * 0.16);
  const outer = cyl(r0, r0 * 1.1, strut * 0.55, 14).rotateX(PI / 2).translate(0, 0, strut * 0.275);
  strutG.add(mk([outer, sphere(r0 * 1.2, 12, 8)], M.satinWhite(), 'oleo'));
  // gland nut at the bottom of the oleo, hydraulic line down its side
  const fit: THREE.BufferGeometry[] = [cyl(r0 * 1.22, r0 * 1.22, 0.035, 6).rotateX(PI / 2).translate(0, 0, strut * 0.54)];
  if (fine) fit.push(pipe([[r0 * 0.9, 0.02, 0.02], [r0 * 1.2, 0.01, strut * 0.2], [r0 * 1.2, 0.0, strut * 0.45], [r0 * 1.05, 0, strut * 0.52]], 0.006, 5, 14));
  strutG.add(mk(fit, M.gunmetal(), 'oleoFittings'));
  // Drag brace for retractable gear.
  if (fold !== 0) strutG.add(mk(rod([0, 0, strut * 0.15], [0, fold * strut * 0.35, strut * 0.05], r0 * 0.4), M.gunmetal()));
  const slide = grp('gearSlide');
  strutG.add(slide);
  const piston = cyl(r0 * 0.7, r0 * 0.7, strut * 0.55, 12).rotateX(PI / 2).translate(0, 0, strut * 0.7);
  slide.add(mk(piston, M.chrome(), 'piston'));
  // torque links: scissor between the oleo and the axle beam, posed by setGearPose from the compression
  const zU = strut * 0.48, zL = strut * 0.86, l = (zL - zU) * 0.62;
  const ang = linkAngles(l, zL - zU);
  const side = fold === 0 ? 1 : -fold;
  for (const [name, z, parent, rot] of [['gearLinkU', zU, strutG, ang.up], ['gearLinkL', zL, slide, ang.low]] as const) {
    const lk = grp(name);
    lk.position.set(0, 0, z);
    lk.rotation.x = rot * side;
    lk.userData.link = { l, d0: zL - zU, side };
    const arm = box(r0 * 0.5, r0 * 0.45, l).translate(0, 0, l / 2);
    const lug = cyl(r0 * 0.42, r0 * 0.42, r0 * 1.6, 10).rotateZ(PI / 2);
    lk.add(mk([arm, lug], M.gunmetal(), 'torqueLink'));
    parent.add(lk);
  }
  const steer = grp('gearSteer');
  steer.position.set(0, 0, strut);
  slide.add(steer);
  // Fork: two arms either side of the tyre (single wheel), axle along X.
  const tw = L.tyreWidth;
  const fork = [
    bevelBox(0.04, 0.08, radius * 0.9).translate(tw / 2 + 0.04, 0, -radius * 0.45),
    bevelBox(0.04, 0.08, radius * 0.9).translate(-tw / 2 - 0.04, 0, -radius * 0.45),
    bevelBox(tw + 0.12, 0.08, 0.06).translate(0, 0, -radius * 0.9),
  ];
  // brake caliper on the inboard arm (does not spin)
  const braked = (wheelMod?.brakeTorque ?? 0) > 0;
  if (braked && fine) fork.push(bevelBox(0.05, radius * 0.32, radius * 0.22).translate(-tw / 2 - 0.005, radius * 0.38, -radius * 0.08));
  steer.add(mk(fork, M.gunmetal(), 'fork'));
  if (steerable) steer.add(mk(torus(r0 * 1.4, 0.015, 6, 20).rotateX(-PI / 2).translate(0, 0, -radius * 0.95), M.accent('yellow')));
  const wheel = grp('gearWheel');
  steer.add(wheel);
  wheel.add(mk(tyre(radius, tw), M.tyre(), 'tyre'));
  const hub = wheelHub(radius, tw, fine);
  wheel.add(mk(hub.metal, M.aluminium(), 'hub'));
  wheel.add(mk(hub.dark, M.darkMetal(), 'hubWeb'));
  wheel.add(mk(hub.bolts, M.chrome(), 'tieBolts'));
  // brake disc between the rim and the inboard fork arm
  if (braked) wheel.add(mk(cyl(radius * 0.5, radius * 0.5, 0.012, 24).rotateZ(PI / 2).translate(-tw * 0.5 + 0.004, 0, 0), M.steel(), 'brakeDisc'));
  wheel.add(mk(cyl(0.025, 0.025, tw + 0.16, 8).rotateZ(PI / 2), M.chrome(), 'axle'));
  // Deploy: rotate the strut from folded (stowedAngle about X) to straight down (+Z).
  if (fold !== 0) setDeployData(strutG, { rot0: [L.stowedAngle, 0, 0], rot1: [0, 0, 0] });
  strutG.userData.gear = { travel: wheelMod?.travel ?? 0.2, radius };
  return root;
}

/** Pose landing gear: suspension compression (m), steering angle about the strut (part-frame sign, rad) and wheel spin (rad). */
export function setGearPose(root: THREE.Object3D, compression: number, steer: number, spin: number) {
  root.traverse((o) => {
    if (o.name === 'gearSlide') o.position.z = -compression;
    else if (o.name === 'gearSteer') o.rotation.set(0, 0, steer);
    else if (o.name === 'gearWheel') o.rotation.set(spin, 0, 0);
    else if (o.name === 'gearLinkU' || o.name === 'gearLinkL') {
      const k = o.userData.link as { l: number; d0: number; side: number } | undefined;
      if (!k) return;
      const a = linkAngles(k.l, k.d0 - compression);
      o.rotation.x = (o.name === 'gearLinkU' ? a.up : a.low) * k.side;
    }
  });
}
