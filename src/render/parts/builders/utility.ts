import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { landingLegLayout } from '../../../data/parts';
import { M } from '../materials';
import { around, box, cyl, cylinder, grp, lathe, mk, rod, setDeployData, sphere, torus, type Profile } from '../geom';
import { boxDims, cylDims, num, srfMount, str } from './common';

const PI = Math.PI;

// ---------------------------------------------------------------------------------------------
// Parachutes
// ---------------------------------------------------------------------------------------------

function canopy(R: number, lineLen: number, scheme: 'orange' | 'red' | 'white'): THREE.Group {
  const g = grp('chuteCanopy');
  const prof: Profile = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (PI / 2 - 0.12);
    prof.push([R * Math.cos(a), R * 0.62 * Math.sin(a)]);
  }
  const dome = lathe(prof, { segments: 36, uRepeat: 1, tile: R * 1.2 });
  dome.translate(0, lineLen, 0);
  g.add(mk(dome, M.canopy(scheme), 'canopyDome'));
  // shroud lines converge at the attach point (origin)
  const pts: number[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    pts.push(0, 0, 0, R * Math.sin(a), lineLen, R * Math.cos(a));
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(lg, M.line());
  lines.name = 'chuteLines';
  g.add(lines);
  setDeployData(g, { scale0: [0.001, 0.001, 0.001], scale1: [1, 1, 1], visibleAbove: 0.0001 });
  return g;
}

export function buildParachute(def: PartDef): THREE.Object3D {
  const style = str(def, 'style', 'stack');
  const scheme = str(def, 'colors', 'orange') as 'orange' | 'red' | 'white';
  const R = num(def, 'canopyRadius', 10);
  const capMat = scheme === 'red' ? M.accent('red') : scheme === 'white' ? M.satinWhite() : M.accent('orange');
  const root = grp('parachute');
  if (style === 'radial') {
    const { h, d } = boxDims(def);
    const { z: zm } = srfMount(def);
    const rc = d / 2 - 0.01;
    const zc = zm + d / 2;
    const plate = box(rc * 1.4, h * 0.9, 0.02);
    plate.translate(0, 0, zm + 0.01);
    root.add(mk(plate, M.gunmetal()));
    const body = cylinder(rc, rc, h * 0.75, { segments: 32, caps: false });
    body.translate(0, -h * 0.1, zc);
    root.add(mk(body, M.satinWhite(), 'canister'));
    const cap = lathe([[rc * 1.02, 0], [rc * 1.02, h * 0.08], [rc * 0.8, h * 0.14], [0, h * 0.16]], { segments: 32 });
    cap.translate(0, h / 2 - h * 0.16 - 0.005, zc);
    root.add(mk(cap, capMat, 'cap'));
    root.add(mk(lathe([[0, -h / 2], [rc * 1.02, -h / 2], [rc * 1.02, -h / 2 + 0.03]], { segments: 32 }).translate(0, 0, zc), M.gunmetal()));
    const straps = box(0.02, h * 0.74, 0.008);
    straps.translate(0, -h * 0.1, rc + 0.002);
    root.add(mk(around(straps, 3, 0, PI / 3).map((g) => g.translate(0, 0, zc)), M.cable()));
    const c = canopy(R, R * 1.3, scheme);
    c.position.set(0, h / 2, zc);
    root.add(c);
    return root;
  }
  const { rTop, rBot, h } = cylDims(def);
  const yB = -h / 2;
  const yT = h / 2;
  const rb = rTop * 1.08;
  root.add(
    mk(
      lathe(
        [
          [0, yB],
          [rBot * 0.97, yB],
          [rBot, yB + 0.006],
          [rBot, yB + 0.035],
          [rBot, yB + 0.035],
          [rb, yB + 0.045],
        ],
        { segments: 48 },
      ),
      M.gunmetal(),
      'base',
    ),
  );
  const yCap = yT - h * 0.32;
  root.add(mk(lathe([[rb, yB + 0.045], [rb, yCap]], { segments: 48, tile: 0.5 }), M.satinWhite(), 'canister'));
  root.add(
    mk(
      lathe([[rb * 1.01, yCap - 0.005], [rb * 1.01, yCap + h * 0.1], [rTop, yCap + h * 0.16], [rTop * 0.7, yT - 0.012], [0, yT]], { segments: 48 }),
      capMat,
      'cap',
    ),
  );
  root.add(mk(torus(rTop * 0.35, 0.008, 6, 24).translate(0, yT - 0.004, 0), M.chrome(), 'pullRing'));
  const strap = box(0.025, yCap - yB - 0.05, 0.008);
  strap.translate(0, (yCap + yB + 0.05) / 2, rb + 0.003);
  root.add(mk(around(strap, 4, 0, PI / 4), M.cable(), 'straps'));
  const c = canopy(R, R * 1.4, scheme);
  c.position.y = yT;
  root.add(c);
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildHeatShield(def: PartDef): THREE.Object3D {
  const { rTop: r, rBot: rb, h } = cylDims(def);
  const root = grp('heatShield');
  const yB = -h / 2;
  const yT = h / 2;
  const yEdge = yB + h * 0.35;
  root.add(
    mk(
      lathe([[0, yB], [rb * 0.5, yB + h * 0.07], [rb * 0.82, yB + h * 0.18], [rb * 0.97, yB + h * 0.29], [rb, yEdge]], { segments: 64, tile: 0.5 }),
      M.heatTiles(),
      'tiles',
    ),
  );
  root.add(mk(lathe([[rb, yEdge], [rb, yB + h * 0.6], [r, yT - h * 0.15], [r, yT - h * 0.15]], { segments: 64 }), M.ablator(), 'sidewall'));
  root.add(
    mk(
      lathe([[r, yT - h * 0.15], [r, yT - 0.006], [r * 0.97, yT], [r * 0.97, yT], [r * 0.85, yT], [r * 0.83, yT - 0.01], [0, yT - 0.01]], { segments: 64 }),
      M.gunmetal(),
      'carrier',
    ),
  );
  const b = cyl(0.012, 0.012, 0.012, 6);
  root.add(mk(around(b, Math.round(20 * r + 6), r * 0.91, 0, yT + 0.002), M.chrome()));
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildLandingLeg(def: PartDef): THREE.Object3D {
  const s = num(def, 'scale', 1);
  const L = landingLegLayout(s);
  const { y: my, z: mz } = srfMount(def);
  const root = grp('landingLeg');
  const rail = box(0.12 * s, 0.9 * s, 0.04 * s);
  rail.translate(0, -0.03 * s, mz + 0.02 * s);
  const bracket = box(0.16 * s, 0.1 * s, 0.07 * s);
  bracket.translate(0, my, mz + 0.035 * s);
  const clevis = box(0.15 * s, 0.08 * s, 0.07 * s);
  clevis.translate(0, L.hinge.y, mz + 0.05 * s);
  root.add(mk([rail, bracket, clevis], M.gunmetal(), 'mount'));
  const pin = cyl(0.025 * s, 0.025 * s, 0.17 * s, 12);
  pin.rotateZ(PI / 2);
  pin.translate(0, L.hinge.y, L.hinge.z);
  root.add(mk(pin, M.chrome()));

  const upper = grp('legUpper');
  upper.position.set(L.hinge.x, L.hinge.y, L.hinge.z);
  root.add(upper);
  const sleeveLen = 0.55 * s;
  upper.add(mk(cylinder(0.038 * s, 0.042 * s, sleeveLen, { segments: 16, y: sleeveLen / 2 }), M.satinWhite(), 'sleeve'));
  upper.add(mk([torus(0.04 * s, 0.008 * s, 6, 16).translate(0, sleeveLen, 0), sphere(0.045 * s, 12, 8)], M.gunmetal()));
  // damper reservoir along the sleeve
  upper.add(mk(cyl(0.018 * s, 0.018 * s, sleeveLen * 0.6, 10, sleeveLen * 0.45).translate(0, 0, 0.05 * s), M.accent('blue')));

  const lower = grp('legLower');
  upper.add(lower);
  const rodLen = 0.68 * s;
  lower.add(mk(cyl(0.024 * s, 0.024 * s, rodLen, 12, -rodLen / 2), M.chrome(), 'piston'));
  lower.add(mk(sphere(0.035 * s, 12, 8), M.gunmetal()));
  setDeployData(lower, { pos0: [0, L.stowedLength, 0], pos1: [0, L.deployedLength, 0] });

  const foot = grp('legFoot');
  lower.add(foot);
  const pad = lathe(
    [
      [0, -L.padDrop - L.padHeight / 2],
      [L.padRadius * 0.92, -L.padDrop - L.padHeight / 2],
      [L.padRadius, -L.padDrop - L.padHeight * 0.2],
      [L.padRadius * 0.85, -L.padDrop + L.padHeight / 2],
      [L.padRadius * 0.25, -L.padDrop + L.padHeight * 0.6],
      [0.03 * s, -L.padDrop * 0.4],
      [0, -L.padDrop * 0.3],
    ],
    { segments: 24 },
  );
  foot.add(mk(pad, M.gunmetal(), 'pad'));
  foot.add(mk(cyl(L.padRadius * 0.95, L.padRadius * 0.95, 0.008 * s, 24, -L.padDrop - L.padHeight / 2 + 0.004 * s), M.rubber()));
  setDeployData(upper, { rot0: [0, 0, 0], rot1: [L.deployAngle, 0, 0] });
  setDeployData(foot, { rot0: [0, 0, 0], rot1: [-L.deployAngle, 0, 0] });
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildLight(def: PartDef): THREE.Object3D {
  const { w, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('light');
  const base = box(w * 0.85, w * 0.85, 0.02);
  base.translate(0, 0, zm + 0.01);
  const yoke: THREE.BufferGeometry[] = [base];
  for (const sx of [-1, 1]) {
    const a = box(0.014, 0.05, d * 0.55);
    a.translate(sx * w * 0.42, 0, zm + d * 0.3);
    yoke.push(a);
  }
  root.add(mk(yoke, M.gunmetal(), 'yoke'));
  const rl = w * 0.36;
  const zc = zm + d * 0.58;
  const housing = lathe([[rl * 0.6, -d * 0.3], [rl, -d * 0.1], [rl, d * 0.3], [rl * 0.95, d * 0.34]], { segments: 28 });
  housing.rotateX(PI / 2);
  housing.translate(0, 0, zc);
  root.add(mk(housing, M.darkMetal(), 'housing'));
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) fins.push(torus(rl * 0.98, 0.004, 4, 24).rotateX(PI / 2).translate(0, 0, zc - d * 0.12 + i * 0.012));
  root.add(mk(fins, M.gunmetal()));
  const lens = new THREE.CircleGeometry(rl * 0.92, 28);
  lens.translate(0, 0, zc + d * 0.33);
  root.add(mk(lens, M.lamp(), 'lightLens'));
  const anchor = new THREE.Object3D();
  anchor.name = 'lightAnchor';
  anchor.position.set(0, 0, zc + d * 0.34);
  root.add(anchor);
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildRcsQuad(def: PartDef): THREE.Object3D {
  const { d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('rcsQuad');
  const plate = box(0.16, 0.16, 0.02);
  plate.translate(0, 0, zm + 0.01);
  const ped = cyl(0.05, 0.06, d * 0.4, 16);
  ped.rotateX(PI / 2);
  ped.translate(0, 0, zm + 0.02 + d * 0.2);
  root.add(mk([plate, ped], M.gunmetal(), 'mount'));
  const rcsMod = def.modules.find((m) => m.type === 'rcs');
  const nozzles = rcsMod && rcsMod.type === 'rcs' ? rcsMod.nozzles : [];
  const zBlock = nozzles[0]?.position.z ?? 0.04;
  const blk = box(0.11, 0.11, 0.08, 0.25);
  blk.translate(0, 0, zBlock);
  root.add(mk(blk, M.whitePanel(), 'block'));
  const arms: THREE.BufferGeometry[] = [];
  const bells: THREE.BufferGeometry[] = [];
  const valves: THREE.BufferGeometry[] = [];
  for (const n of nozzles) {
    const dir = new THREE.Vector3(n.direction.x, n.direction.y, n.direction.z).normalize();
    const exit = new THREE.Vector3(n.position.x, n.position.y, n.position.z).addScaledVector(dir, 0.015);
    const len = 0.045;
    const throat = exit.clone().addScaledVector(dir, -len);
    arms.push(rod([0, 0, zBlock], [throat.x, throat.y, throat.z], 0.012, 8));
    const b = lathe([[0.024, -len], [0.012, -len * 0.2], [0.008, 0]], { segments: 16 });
    // lathe axis +Y: exit at -len, throat at 0 -> orient so -Y maps to dir
    b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir));
    b.translate(throat.x, throat.y, throat.z);
    bells.push(b);
    const v = cyl(0.016, 0.016, 0.02, 10);
    v.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    v.translate(throat.x - dir.x * 0.01, throat.y - dir.y * 0.01, throat.z - dir.z * 0.01);
    valves.push(v);
  }
  if (arms.length) root.add(mk(arms, M.aluminium(), 'arms'));
  if (bells.length) root.add(mk(bells, M.darkMetal(), 'nozzles'));
  if (valves.length) root.add(mk(valves, M.gunmetal()));
  // interior of nozzles (soot): small discs at the throat are enough at this scale
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildReactionWheel(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const root = grp('reactionWheel');
  const fl = Math.min(0.035, h * 0.18);
  root.add(
    mk(
      [
        lathe([[r * 0.97, h / 2 - fl], [r, h / 2 - fl], [r, h / 2 - 0.004], [r * 0.98, h / 2]], { segments: 48 }),
        lathe([[r * 0.98, -h / 2], [r, -h / 2 + 0.004], [r, -h / 2 + fl], [r * 0.97, -h / 2 + fl]], { segments: 48 }),
      ],
      M.aluminium(),
      'flanges',
    ),
  );
  root.add(mk(lathe([[r * 0.93, -h / 2 + fl], [r * 0.93, h / 2 - fl]], { segments: 48, tile: 0.5 }), M.charcoalPanel(), 'housing'));
  root.add(mk([lathe([[r * 0.98, h / 2], [r * 0.5, h / 2 - 0.006], [r * 0.48, h / 2 - 0.012], [0, h / 2 - 0.012]], { segments: 48 }), lathe([[0, -h / 2 + 0.012], [r * 0.48, -h / 2 + 0.012], [r * 0.5, -h / 2 + 0.006], [r * 0.98, -h / 2]], { segments: 48 })], M.darkMetal()));
  const fin = box(0.008 + 0.006 * r, (h - fl * 2) * 0.7, r * 0.05);
  fin.translate(0, 0, r * 0.955);
  root.add(mk(around(fin, Math.round(36 * r + 12), 0), M.gunmetal(), 'coolingFins'));
  // three motor covers (one per axis) and status light
  const cov = box(r * 0.28, (h - fl * 2) * 0.8, 0.02);
  cov.translate(0, 0, r * 0.94);
  root.add(mk(around(cov, 3, 0, PI / 6), M.aluminium(), 'motorCovers'));
  const led = box(0.02, 0.012, 0.01);
  led.translate(0, (h - fl * 2) * 0.25, r * 0.955);
  root.add(mk(led, M.statusLed('teal'), 'statusLight'));
  return root;
}
