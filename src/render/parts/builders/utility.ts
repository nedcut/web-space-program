import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { landingLegLayout } from '../../../data/parts';
import { M } from '../materials';
import { around, bevelBox, box, cyl, cylinder, detailLevel, grp, lathe, mk, pipe, rod, setDeployData, sphere, tint, torus, type Profile } from '../geom';
import { boxDims, cylDims, num, srfMount, str } from './common';
import { charShield } from './command';

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
  if (detailLevel() === 1) {
    // pressure vents in the cap, base bolts, and the red arming-pin streamer on the canister
    const vents: THREE.BufferGeometry[] = [];
    const yv = yCap + h * 0.13, rv = (rb * 1.01 + rTop) / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      const c = new THREE.CircleGeometry(0.012, 10);
      c.rotateX(-0.5).translate(0, yv, rv + 0.003).rotateY(a);
      vents.push(c);
    }
    root.add(mk(vents, M.darkMetal(), 'vents'));
    const b = cyl(0.007, 0.007, 0.008, 6);
    root.add(mk(around(b.rotateX(PI / 2), Math.round(rBot * 40 + 8), rBot * 0.995, PI / 16, yB + 0.02), M.chrome(), 'baseBolts'));
    const tag = [cyl(0.006, 0.006, 0.03, 6).rotateX(PI / 2).translate(0, yCap - 0.04, rb + 0.012), box(0.025, 0.09, 0.002).translate(0.015, yCap - 0.1, rb + 0.016)];
    root.add(mk(tag, M.accent('red'), 'armingTag'));
  }
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
      charShield(lathe([[0, yB], [rb * 0.5, yB + h * 0.07], [rb * 0.82, yB + h * 0.18], [rb * 0.97, yB + h * 0.29], [rb, yEdge]], { segments: 64, tile: 0.5 }), rb, 6),
      M.heatTiles(),
      'tiles',
    ),
  );
  root.add(mk(charShield(lathe([[rb, yEdge], [rb, yB + h * 0.6], [r, yT - h * 0.15], [r, yT - h * 0.15]], { segments: 64 }), rb, 7), M.ablator(), 'sidewall'));
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

/** Hex nut / bolt head with its axis along +Y (6 flats read as hardware even at a few pixels). */
function hexNut(r: number, h: number): THREE.BufferGeometry {
  return cyl(r, r, h, 6);
}

/** A tube from a to b (both [x, y, z]) with `seg` sides. */
const tube = (a: [number, number, number], b: [number, number, number], r: number, seg = 10) => rod(a, b, r, seg);

/**
 * Landing leg: bolted mount rail with a clevis and through-pin, a hydraulic primary strut (white barrel with a
 * hex gland nut, wiper seal, reservoir and hose; chrome piston), a gusseted foot pad on a ball joint, and two
 * three-stage telescoping deploy braces that swing and extend with the leg ('legBrace*' nodes).
 */
export function buildLandingLeg(def: PartDef): THREE.Object3D {
  const s = num(def, 'scale', 1);
  const L = landingLegLayout(s);
  const { y: my, z: mz } = srfMount(def);
  const fine = detailLevel() === 1;
  const root = grp('landingLeg');
  const H = L.hinge;

  // --- mount: rail with bolted back plate, standoff lugs for the braces and clevis cheeks
  const rail = box(0.12 * s, 0.9 * s, 0.04 * s);
  rail.translate(0, -0.03 * s, mz + 0.02 * s);
  const bracket = bevelBox(0.16 * s, 0.1 * s, 0.07 * s);
  bracket.translate(0, my, mz + 0.035 * s);
  const mount: THREE.BufferGeometry[] = [rail, bracket];
  for (const sx of [-1, 1]) {
    // clevis cheeks either side of the strut eye
    const cheek = bevelBox(0.022 * s, 0.11 * s, 0.085 * s);
    cheek.translate(sx * 0.05 * s, H.y, mz + 0.055 * s);
    mount.push(cheek);
    // brace standoff lug
    const lug = bevelBox(0.045 * s, 0.07 * s, 0.05 * s);
    lug.translate(sx * 0.07 * s, H.y + 0.5 * s, mz + 0.045 * s);
    mount.push(lug);
  }
  root.add(mk(mount, M.gunmetal(), 'mount'));
  // hinge pin with nut caps, rail bolts
  const pin = cyl(0.022 * s, 0.022 * s, 0.15 * s, 12);
  pin.rotateZ(PI / 2);
  pin.translate(0, H.y, H.z);
  const hw: THREE.BufferGeometry[] = [pin];
  for (const sx of [-1, 1]) hw.push(hexNut(0.026 * s, 0.018 * s).rotateZ(PI / 2).translate(sx * 0.078 * s, H.y, H.z));
  if (fine)
    for (const y of [-0.42, -0.2, 0.05, 0.3])
      for (const sx of [-1, 1]) hw.push(hexNut(0.009 * s, 0.008 * s).rotateX(PI / 2).translate(sx * 0.04 * s, y * s, mz + 0.044 * s));
  root.add(mk(hw, M.chrome(), 'hingeHardware'));

  // --- primary strut (rotates about the hinge pin)
  const upper = grp('legUpper');
  upper.position.set(H.x, H.y, H.z);
  root.add(upper);
  const sleeveLen = 0.55 * s;
  upper.add(mk(cylinder(0.038 * s, 0.042 * s, sleeveLen, { segments: 16, y: sleeveLen / 2 }), M.satinWhite(), 'sleeve'));
  // eye at the pin, hex gland nut and black wiper seal at the rod end
  const eye = cyl(0.046 * s, 0.046 * s, 0.075 * s, 14).rotateZ(PI / 2);
  const gland = hexNut(0.05 * s, 0.045 * s).translate(0, sleeveLen - 0.005 * s, 0);
  const brCollar = box(0.17 * s, 0.035 * s, 0.035 * s).translate(0, 0.22 * s, 0);
  const wiper = tint(torus(0.03 * s, 0.006 * s, 6, 16).translate(0, sleeveLen + 0.018 * s, 0), 0.22);
  upper.add(mk([tint(eye, 1), tint(gland, 1), tint(brCollar, 1), wiper], M.gunmetal(), 'strutFittings'));
  // damper reservoir along the sleeve, hose to the gland, hazard band at the gland, clamp bands
  upper.add(mk(cyl(0.018 * s, 0.018 * s, sleeveLen * 0.5, 10, sleeveLen * 0.55).translate(0, 0, 0.055 * s), M.accent('blue'), 'reservoir'));
  upper.add(mk(pipe([[0, sleeveLen * 0.3, 0.055 * s], [0.02 * s, sleeveLen * 0.26, 0.06 * s], [0.04 * s, sleeveLen * 0.4, 0.03 * s], [0.04 * s, sleeveLen * 0.88, 0.02 * s], [0.015 * s, sleeveLen * 0.95, 0.04 * s]], 0.006 * s, 6, 28), M.cable(), 'hose'));
  upper.add(mk(lathe([[0.0425 * s, sleeveLen * 0.8], [0.0435 * s, sleeveLen * 0.81], [0.0435 * s, sleeveLen * 0.93], [0.0425 * s, sleeveLen * 0.94]], { segments: 16, tile: 0.25 }), M.hazard(), 'glandBand'));
  upper.add(mk([0.4, 0.75].map((t) => torus(0.0195 * s, 0.004 * s, 4, 12).translate(0, sleeveLen * t, 0.055 * s)), M.chrome()));

  const lower = grp('legLower');
  upper.add(lower);
  const rodLen = 0.68 * s;
  lower.add(mk(cyl(0.024 * s, 0.024 * s, rodLen, 14, -rodLen / 2), M.chrome(), 'piston'));
  // rod-end fork around the ball joint
  const fork: THREE.BufferGeometry[] = [cyl(0.032 * s, 0.03 * s, 0.05 * s, 12, 0.03 * s)];
  for (const sx of [-1, 1]) fork.push(bevelBox(0.014 * s, 0.06 * s, 0.05 * s).translate(sx * 0.035 * s, -0.005 * s, 0));
  lower.add(mk(fork, M.gunmetal(), 'rodEnd'));
  setDeployData(lower, { pos0: [0, L.stowedLength, 0], pos1: [0, L.deployedLength, 0] });

  // --- foot: ball joint, dished pad with a rolled rim, radial gussets, bolts and a crush-pad sole
  const foot = grp('legFoot');
  lower.add(foot);
  const R = L.padRadius, ph = L.padHeight, pd = L.padDrop;
  const pad = lathe(
    [
      [0, -pd - ph / 2],
      [R * 0.9, -pd - ph / 2],
      [R, -pd - ph * 0.25],
      [R, -pd + ph * 0.05],
      [R * 0.93, -pd + ph * 0.12],
      [R * 0.86, -pd + ph * 0.02],
      [R * 0.3, -pd + ph * 0.42],
      [0.035 * s, -pd * 0.5],
      [0, -pd * 0.42],
    ],
    { segments: 32 },
  );
  foot.add(mk(pad, M.gunmetal(), 'pad'));
  const ribs: THREE.BufferGeometry[] = [sphere(0.03 * s, 12, 8)];
  const nRib = fine ? 8 : 4;
  for (let i = 0; i < nRib; i++) {
    const a = (i / nRib) * PI * 2 + PI / nRib;
    const g = box(0.008 * s, ph * 0.5, R * 0.56);
    g.rotateX(0.32);
    g.translate(0, -pd + ph * 0.3, R * 0.56);
    g.rotateY(a);
    ribs.push(g);
  }
  foot.add(mk(ribs, M.gunmetal(), 'padRibs'));
  foot.add(mk(cyl(R * 0.94, R * 0.9, 0.012 * s, 24, -pd - ph / 2 + 0.006 * s), M.rubber(), 'sole'));
  setDeployData(upper, { rot0: [0, 0, 0], rot1: [L.deployAngle, 0, 0] });
  setDeployData(foot, { rot0: [0, 0, 0], rot1: [-L.deployAngle, 0, 0] });

  // --- deploy braces: telescopes from the rail lugs to the strut collar, either side of the strut; the barrel
  // runs back up past its lug pivot, and setPartDeploy aims it and slides the rod to the collar ('legBraceTip*').
  const bAt = 0.22 * s;
  const A = new THREE.Vector3(0, H.y + 0.5 * s, mz + 0.055 * s);
  const L0 = new THREE.Vector3(0, H.y + bAt, H.z).distanceTo(A);
  const rodL = 0.5 * s, back = rodL - L0 + 0.03 * s, T = 0.26 * s;
  for (const sx of [-1, 1]) {
    const tag = sx > 0 ? 'R' : 'L';
    const tip = new THREE.Object3D();
    tip.name = `legBraceTip${tag}`;
    tip.position.set(sx * 0.07 * s, bAt, 0);
    upper.add(tip);
    const br = grp(`legBrace${tag}`);
    br.position.set(sx * 0.07 * s, A.y, A.z);
    setDeployData(br, { aim: tip.name, tube: rodL });
    root.add(br);
    br.add(mk([tube([0, -back, 0], [0, T, 0], 0.017 * s, 10), torus(0.0195 * s, 0.004 * s, 4, 12).translate(0, T, 0), sphere(0.022 * s, 10, 8), torus(0.0195 * s, 0.004 * s, 4, 12).translate(0, -back, 0)], M.satinWhite(), 'braceBarrel'));
    const st = grp('braceStage');
    setDeployData(st, {}); // own AO group: it slides inside the barrel
    br.add(st);
    st.add(mk([tube([0, 0, 0], [0, rodL, 0], 0.011 * s, 8), sphere(0.019 * s, 10, 8).translate(0, rodL, 0)], M.chrome(), 'braceRod'));
  }
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
  const blk = bevelBox(0.11, 0.11, 0.08, 0.25);
  blk.translate(0, 0, zBlock);
  {
    // exhaust staining on the block faces around each thruster arm
    const pos = blk.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let s2 = 0;
      for (const n of nozzles) {
        const d = Math.hypot(v.x - n.position.x * 0.6, v.y - n.position.y * 0.6, v.z - (n.position.z * 0.6 + zBlock * 0.4));
        s2 += 0.6 * Math.exp(-(d * d) / 0.0012);
      }
      const k = 1 - Math.min(0.7, s2);
      col[i * 3] = k; col[i * 3 + 1] = k * 0.98; col[i * 3 + 2] = k * 0.95;
    }
    blk.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
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
  // sooted throats: dark discs just inside each exit
  const throats: THREE.BufferGeometry[] = [];
  for (const n of nozzles) {
    const dir = new THREE.Vector3(n.direction.x, n.direction.y, n.direction.z).normalize();
    const exit = new THREE.Vector3(n.position.x, n.position.y, n.position.z).addScaledVector(dir, 0.006);
    const c = new THREE.CircleGeometry(0.02, 12);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
    c.translate(exit.x, exit.y, exit.z);
    throats.push(c);
  }
  if (throats.length) root.add(mk(throats, M.soot(), 'throats'));
  if (detailLevel() === 1) {
    const hw: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) hw.push(cyl(0.008, 0.008, 0.008, 6).rotateX(PI / 2).translate(sx * 0.062, sy * 0.062, zm + 0.024));
    root.add(mk(hw, M.chrome(), 'mountBolts'));
    root.add(mk(pipe([[0.05, -0.07, zm + 0.02], [0.05, -0.05, zm + 0.04], [0.035, -0.03, zBlock - 0.02]], 0.006, 5, 10), M.aluminium(), 'feedLine'));
  }
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

// ---------------------------------------------------------------------------------------------
// Docking ports
// ---------------------------------------------------------------------------------------------

/**
 * Androgynous docking collar: bolted base flange, tapered white collar, dark mating ring with a crew tunnel,
 * three inward-leaning guide petals and six latch hooks. The mating face (the 'dock' node) is the top plane.
 */
export function buildDockingPort(def: PartDef): THREE.Object3D {
  const { rTop, rBot: r, h } = cylDims(def);
  const root = grp('dockingPort');
  const seg = 56;
  const y0 = -h / 2;
  const y1 = h / 2;
  const fl = Math.min(0.04, h * 0.16);
  const ringH = h * 0.22;
  const rRing = rTop * 0.84;
  const rTunnel = rTop * 0.56;
  // Base flange + bolt heads.
  root.add(mk(lathe([[r * 0.97, y0], [r, y0 + 0.004], [r, y0 + fl], [r * 0.95, y0 + fl]], { segments: seg }), M.aluminium(), 'flange'));
  const bolt = cyl(0.008 + 0.005 * r, 0.008 + 0.005 * r, 0.012, 6);
  bolt.rotateX(PI / 2);
  root.add(mk(around(bolt, Math.round(14 * r + 8), r * 0.995, 0, y0 + fl / 2), M.chrome(), 'bolts'));
  // Tapered collar and the mating ring.
  root.add(
    mk(lathe([[r * 0.95, y0 + fl], [r * 0.95, y0 + fl + 0.004], [rTop * 0.98, y1 - ringH - 0.01], [rTop * 0.9, y1 - ringH]], { segments: seg, tile: 0.6 }), M.satinWhite(), 'collar'),
  );
  root.add(mk(lathe([[rTop * 0.9, y1 - ringH], [rRing, y1 - ringH], [rRing, y1 - 0.006], [rRing * 0.98, y1]], { segments: seg }), M.anodised('blue'), 'matingRing'));
  // Mating face (annulus, normal up), crew tunnel and hatch.
  root.add(mk(lathe([[rRing * 0.98, y1], [rTunnel * 1.08, y1], [rTunnel, y1 - 0.01]], { segments: seg }), M.darkMetal(), 'matingFace'));
  root.add(mk(lathe([[rTunnel, y0 + fl], [rTunnel, y1 - 0.01]], { segments: seg }), M.innerLining(), 'tunnel'));
  root.add(mk(lathe([[rTunnel, y0 + fl + 0.02], [rTunnel * 0.5, y0 + fl + 0.02], [0, y0 + fl + 0.02]], { segments: 32 }), M.darkMetal(), 'hatch'));
  // Rubber seal on the face.
  const seal = torus((rRing + rTunnel) / 2, 0.005 + 0.004 * r, 6, seg);
  seal.translate(0, y1 - 0.004, 0);
  root.add(mk(seal, M.rubber(), 'seal'));
  // Guide petals: trapezoidal plates rising from the collar to the face plane, tips leaning inward.
  const petalH = Math.min(h * 0.75, ringH + h * 0.45);
  const petalW = rTop * 0.55;
  const t = 0.012 + 0.006 * r;
  const petal = new THREE.BufferGeometry();
  {
    const wB = petalW / 2;
    const wT = petalW * 0.18;
    const P = [
      [-wB, 0, t / 2], [wB, 0, t / 2], [wT, petalH, t / 2], [-wT, petalH, t / 2],
      [-wB, 0, -t / 2], [wB, 0, -t / 2], [wT, petalH, -t / 2], [-wT, petalH, -t / 2],
    ];
    const idx = [0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 1, 5, 6, 1, 6, 2, 4, 0, 3, 4, 3, 7, 3, 2, 6, 3, 6, 7];
    const pos: number[] = [];
    for (const i of idx) pos.push(...P[i]);
    petal.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uv: number[] = [];
    for (const i of idx) uv.push(P[i][0] + 0.5, P[i][1]);
    petal.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    petal.computeVertexNormals();
    petal.rotateX(-0.22); // tip toward -Z, i.e. toward the axis once placed by `around`
    petal.translate(0, y1 - petalH * Math.cos(0.22), 0);
  }
  root.add(mk(around(petal, 3, rRing * 1.02, PI / 6), M.aluminium(), 'guidePetals'));
  // Latch hooks between the petals.
  const latch = box(0.035 + 0.03 * r, ringH * 0.7, 0.025 + 0.01 * r);
  latch.translate(0, y1 - ringH * 0.45, 0);
  root.add(mk(around(latch, 6, rRing + 0.006, 0), M.accent('yellow'), 'latches'));
  // Alignment chevrons on the face + status light on the collar.
  const chev = box(0.02 + 0.02 * r, 0.004, 0.05 + 0.03 * r);
  chev.translate(0, y1 - 0.002, 0);
  root.add(mk(around(chev, 3, (rRing + rTunnel) / 2, PI / 2), M.satinWhite(), 'chevrons'));
  const led = box(0.02, 0.012, 0.01);
  led.translate(0, y0 + fl + (h - fl - ringH) * 0.4, (r * 0.95 + rTop * 0.98) / 2 + 0.006);
  root.add(mk(led, M.statusLed('green'), 'statusLight'));
  return root;
}
