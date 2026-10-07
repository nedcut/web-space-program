import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, bevelBox, box, cyl, detailLevel, grp, lathe, mk, pipe, rod, sphere, torus, type Profile } from '../geom';
import { cylDims, str } from './common';
import { decals } from '../decals';
import { Markings } from './markings';

const PI = Math.PI;

/** A patch following a surface of revolution r(y), offset outward. */
function patch(rOf: (y: number) => number, y0: number, y1: number, phiC: number, phiW: number, off: number, steps = 4, seg = 8): THREE.BufferGeometry {
  const p: Profile = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    p.push([rOf(y) + off, y]);
  }
  return lathe(p, { segments: seg, phiStart: phiC - phiW / 2, phiLength: phiW, tile: 0.25 });
}

/** Four thin strips outlining a rectangle on a surface of revolution (raised bezel / hatch seam). */
function outline(rOf: (y: number) => number, y0: number, y1: number, phiC: number, phiW: number, w: number, off: number): THREE.BufferGeometry[] {
  const rm = rOf((y0 + y1) / 2);
  const wa = w / rm;
  return [
    patch(rOf, y0 - w, y0, phiC, phiW + wa * 2, off, 1, 8),
    patch(rOf, y1, y1 + w, phiC, phiW + wa * 2, off, 1, 8),
    patch(rOf, y0, y1, phiC - phiW / 2 - wa / 2, wa, off, 3, 1),
    patch(rOf, y0, y1, phiC + phiW / 2 + wa / 2, wa, off, 3, 1),
  ];
}

/** Window: recessed glass in a dark reveal, a gasket plate and a raised machined bezel with a bolt ring (High). */
function windowOn(rOf: (y: number) => number, y0: number, y1: number, phiC: number, phiW: number, frameW: number): THREE.Mesh[] {
  const fy = frameW;
  const fphi = frameW / rOf((y0 + y1) / 2);
  const out = [
    mk(patch(rOf, y0 - fy, y1 + fy, phiC, phiW + fphi * 2, 0.005), M.darkMetal(), 'windowFrame'),
    mk(patch(rOf, y0, y1, phiC, phiW, 0.0065), M.glass(), 'window'),
    mk(outline(rOf, y0, y1, phiC, phiW, fy * 0.55, 0.014), M.gunmetal(), 'windowBezel'),
  ];
  if (detailLevel() === 1) {
    // reveal: the bezel's inner walls step down to the glass
    out.push(mk(outline(rOf, y0 + fy * 0.18, y1 - fy * 0.18, phiC, phiW - (fy * 0.36) / rOf((y0 + y1) / 2), fy * 0.18, 0.0105), M.darkMetal(), 'windowReveal'));
    out.push(mk(boltsAround(rOf, y0 - fy * 0.28, y1 + fy * 0.28, phiC, phiW + fphi * 0.56, 0.075, 0.016, 0.0045), M.chrome(), 'windowBolts'));
  }
  return out;
}

/** Low conical fastener head (12 triangles) with its axis along +Z. */
function buttonHead(r: number, h: number): THREE.BufferGeometry {
  return lathe([[r, -h * 0.4], [0, h * 0.6]], { segments: 6 }).rotateX(PI / 2);
}

/** Small bolt heads along a rectangle on a surface of revolution (pitch in metres). */
function boltsAround(rOf: (y: number) => number, y0: number, y1: number, phiC: number, phiW: number, pitch: number, off: number, size: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const head = buttonHead(size, size * 0.9);
  const put = (y: number, a: number) => {
    const r = rOf(y) + off;
    out.push(head.clone().rotateY(a).translate(r * Math.sin(a), y, r * Math.cos(a)));
  };
  const rm = rOf((y0 + y1) / 2);
  const nx = Math.max(2, Math.round((phiW * rm) / pitch));
  const ny = Math.max(2, Math.round((y1 - y0) / pitch));
  for (let i = 0; i <= nx; i++) for (const y of [y0, y1]) put(y, phiC - phiW / 2 + (phiW * i) / nx);
  for (let j = 1; j < ny; j++) for (const a of [phiC - phiW / 2, phiC + phiW / 2]) put(y0 + ((y1 - y0) * j) / ny, a);
  return out;
}

/** Vertical raised straps on a surface of revolution (shingle hold-downs, blanket close-out tapes). */
function straps(rOf: (y: number) => number, y0: number, y1: number, angles: number[], w: number, off: number, steps = 6): THREE.BufferGeometry[] {
  return angles.map((a) => patch(rOf, y0, y1, a, w / rOf((y0 + y1) / 2), off, steps, 1));
}

/** Angles of n evenly spaced straps, skipping blocked [centre, half-width] ranges (windows, hatch, insignia). */
function freeAngles(n: number, phase: number, blocked: [number, number][]): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * PI * 2;
    const hit = blocked.some(([c, w]) => {
      let d = Math.abs(((a - c) % (2 * PI)) + 2 * PI) % (2 * PI);
      if (d > PI) d = 2 * PI - d;
      return d < w;
    });
    if (!hit) out.push(a);
  }
  return out;
}

/** Profile of a straight cone run r(y) from y0 to y1 subdivided into n rings (for vertex-colour gradients). */
function coneRun(rOf: (y: number) => number, y0: number, y1: number, n: number): Profile {
  const p: Profile = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    p.push([rOf(y), y]);
  }
  return p;
}

/**
 * Bake RCS plume staining and handling grime into a capsule body's vertex colour: a dark blot around each
 * thruster port, fanning along its firing directions, plus faint vertical rain streaks from the shoulder.
 */
function capsuleGrime(g: THREE.BufferGeometry, ports: { y: number; phi: number }[], r: number, yLo: number, yHi: number, seed: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const phi = Math.atan2(x, z);
    let s = 0;
    for (const p of ports) {
      let dphi = Math.abs(phi - p.phi);
      if (dphi > PI) dphi = 2 * PI - dphi;
      const arc = dphi * r;
      const dy = y - p.y;
      // blot plus streaks fanning sideways (yaw thrusters) and down (pitch)
      s += 0.5 * Math.exp(-(arc * arc + dy * dy) / 0.005);
      s += 0.22 * Math.exp(-(dy * dy) / 0.0006) * Math.exp(-arc / 0.11);
      if (dy < 0) s += 0.2 * Math.exp(-(arc * arc) / 0.0015) * Math.exp(dy / 0.22);
    }
    const t = (y - yLo) / Math.max(1e-3, yHi - yLo);
    const rain = Math.max(0, Math.sin(phi * 23 + seed) * Math.sin(phi * 7.3 + seed * 3)) * 0.12 * Math.pow(Math.max(0, t), 0.7);
    s = Math.min(0.75, s + rain);
    col[i * 3] = 1 - s * 0.9;
    col[i * 3 + 1] = 1 - s * 0.95;
    col[i * 3 + 2] = 1 - s;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Char gradient on a heat-shield / ablator lathe: darker toward the rim and in a blotchy band. */
function charShield(g: THREE.BufferGeometry, R: number, seed: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const rr = Math.hypot(x, z) / R;
    const phi = Math.atan2(x, z);
    const blot = 0.5 + 0.5 * Math.sin(phi * 5 + seed) * Math.sin(phi * 11 + seed * 2);
    const k = 1 - 0.38 * Math.pow(rr, 3) - 0.12 * blot * rr;
    col[i * 3] = k;
    col[i * 3 + 1] = k * 0.97;
    col[i * 3 + 2] = k * 0.94;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Heat-shield carrier ring at the rim: a gunmetal band with a bolt ring and compression-pad bumps. */
function shieldCarrier(root: THREE.Object3D, R: number, y: number, h: number, nPads: number, seg: number) {
  root.add(mk(lathe([[R * 1.003, y - h / 2], [R * 1.012, y - h * 0.3], [R * 1.012, y + h * 0.3], [R * 1.003, y + h / 2]], { segments: seg }), M.gunmetal(), 'shieldCarrier'));
  if (detailLevel() < 1) return;
  root.add(mk(around(buttonHead(0.0085, 0.008), Math.round(R * 28), R * 1.014, 0, y), M.chrome(), 'carrierBolts'));
  const pad = box(0.07 * R, h * 1.25, 0.03);
  root.add(mk(around(pad.translate(0, 0, 0), nPads, R * 1.02, PI / nPads, y), M.darkMetal(), 'compressionPads'));
}

/** Crew hatch: panel, seam outline, hinge blocks, grab handle and rescue markings. */
function hatchOn(root: THREE.Object3D, D: Markings, rOf: (y: number) => number, y0: number, y1: number, phiC: number, phiW: number, panel: THREE.Material) {
  root.add(mk(patch(rOf, y0, y1, phiC, phiW, 0.006, 6), panel, 'hatch'));
  root.add(mk(outline(rOf, y0, y1, phiC, phiW, 0.018, 0.009), M.gunmetal(), 'hatchSeam'));
  const parts: THREE.BufferGeometry[] = [];
  for (const t of [0.22, 0.78]) {
    const y = y0 + (y1 - y0) * t;
    const a = phiC - phiW / 2 - 0.03;
    const r = rOf(y) + 0.02;
    const b = box(0.05, 0.08, 0.035);
    b.rotateY(a);
    b.translate(r * Math.sin(a), y, r * Math.cos(a));
    parts.push(b);
  }
  root.add(mk(parts, M.gunmetal(), 'hatchHinges'));
  if (detailLevel() === 1) {
    // hinge pins, latch housing opposite the hinges and a pressure-equalisation valve
    const hw: THREE.BufferGeometry[] = [];
    for (const t of [0.22, 0.78]) {
      const y = y0 + (y1 - y0) * t;
      const a = phiC - phiW / 2 - 0.03;
      const r = rOf(y) + 0.04;
      hw.push(cyl(0.008, 0.008, 0.11, 8).translate(r * Math.sin(a), y, r * Math.cos(a)));
    }
    const yl = y0 + (y1 - y0) * 0.45;
    const al = phiC + phiW / 2 - 0.05;
    const rl = rOf(yl) + 0.016;
    hw.push(bevelBox(0.05, 0.12, 0.022).rotateY(al).translate(rl * Math.sin(al), yl, rl * Math.cos(al)));
    const yv = y0 + (y1 - y0) * 0.8;
    const rv = rOf(yv) + 0.012;
    hw.push(cyl(0.022, 0.026, 0.02, 12).rotateX(PI / 2).rotateY(phiC).translate(rv * Math.sin(phiC), yv, rv * Math.cos(phiC)));
    root.add(mk(hw, M.chrome(), 'hatchHardware'));
  }
  const yh = y0 + (y1 - y0) * 0.45;
  const ah = phiC + phiW * 0.3;
  const pts: [number, number, number][] = [];
  for (const [dy, out] of [[-0.07, 0.006], [-0.06, 0.035], [0.06, 0.035], [0.07, 0.006]] as const) {
    const r = rOf(yh + dy) + out;
    pts.push([r * Math.sin(ah), yh + dy, r * Math.cos(ah)]);
  }
  root.add(mk(pipe(pts, 0.008, 6, 16), M.accent('yellow'), 'hatchHandle'));
  const rr = (y: number) => rOf(y) + 0.006;
  const rescue = decals.text('RESCUE', { color: '#f2f1ec', plate: '#b3261e', weight: 800 });
  D.lathe(rr, rescue, { y: y1 - 0.06, phi: phiC, height: 0.045 });
  D.lathe(rr, decals.symbol('arrow'), { y: yh, phi: ah + 0.12, height: 0.07 });
}

export function buildPod(def: PartDef): THREE.Object3D {
  return str(def, 'style', 'lantern') === 'harbor' ? buildHarbor(def) : buildLantern(def);
}

function buildLantern(def: PartDef): THREE.Object3D {
  const { rTop, rBot: R, h } = cylDims(def);
  const yB = -h / 2;
  const yT = h / 2;
  const root = grp('pod');
  const yRim = yB + 0.1;
  const yShoulder = yB + 1.3;
  const rS = rTop + 0.07;
  const cone = (y: number) => 0.61 * (R / 0.625) + ((rS - 0.61 * (R / 0.625)) * (y - (yRim + 0.06))) / (yShoulder - 0.08 - (yRim + 0.06));

  // heat shield (charred toward the rim), ablator lip and the bolted carrier ring with compression pads
  root.add(mk(charShield(lathe([[0, yB], [R * 0.5, yB + 0.015], [R * 0.8, yB + 0.04], [R * 0.96, yB + 0.07], [R, yRim]], { segments: 56, tile: 0.5 }), R, 1), M.heatTiles(), 'heatShield'));
  root.add(mk(charShield(lathe([[R, yRim], [R, yRim + 0.02], [R * 0.985, yRim + 0.04]], { segments: 56 }), R, 2), M.ablator()));
  shieldCarrier(root, R * 0.985, yRim + 0.058, 0.03, 6, 56);
  // shingled cone, subdivided so RCS staining and rain streaks have rings to live on
  const yPorts = yShoulder - 0.15;
  const portPhis = [0, 1, 2, 3].map((i) => PI / 4 + (i * PI) / 2);
  const body: Profile = [[R * 0.985, yRim + 0.04], ...coneRun(cone, yRim + 0.06, yShoulder - 0.08, 10)];
  body.push([rS - 0.025, yShoulder - 0.02], [rTop + 0.01, yShoulder]);
  const bodyG = lathe(body, { segments: 64, tile: 0.5 });
  root.add(mk(capsuleGrime(bodyG, portPhis.map((phi) => ({ y: yPorts, phi })), cone(yPorts), yRim, yShoulder, 3), M.shingle(), 'body'));
  // shingle hold-down straps clear of the window, hatch and insignia
  if (detailLevel() === 1) {
    const ang = freeAngles(20, PI / 20, [[0, 0.48], [PI / 2, 0.62], [-PI / 2, 0.32], [-PI * 0.75, 0.2], [PI * 0.15, 0.08]]);
    root.add(mk(straps(cone, yRim + 0.17, yShoulder - 0.1, ang, 0.016, 0.0035, 8), M.gunmetal(), 'straps'));
  }
  // accent band above the rim
  root.add(mk(patch(cone, yRim + 0.09, yRim + 0.15, 0, PI * 2, 0.004, 1, 64), M.accent('blue'), 'band'));
  // neck (antenna / chute section)
  root.add(
    mk(
      lathe(
        [
          [rTop + 0.01, yShoulder],
          [rTop - 0.01, yShoulder + 0.01],
          [rTop - 0.01, yT - 0.05],
          [rTop, yT - 0.04],
          [rTop, yT],
          [rTop, yT],
          [rTop * 0.85, yT],
          [rTop * 0.85, yT],
          [rTop * 0.85, yT - 0.015],
          [0, yT - 0.015],
        ],
        { segments: 48, tile: 0.5 },
      ),
      M.aluminium(),
      'neck',
    ),
  );
  root.add(mk(torus(rTop - 0.005, 0.01, 6, 40).translate(0, yShoulder + 0.12, 0), M.gunmetal()));
  // big forward window (+Z) and hatch with porthole (+X)
  for (const m of windowOn(cone, yB + 0.95, yB + 1.15, 0, 0.75, 0.025)) root.add(m);
  const D = new Markings(def);
  hatchOn(root, D, cone, yB + 0.3, yB + 1.0, PI / 2, 0.95, M.darkMetal());
  for (const m of windowOn(cone, yB + 0.75, yB + 0.9, PI / 2, 0.35, 0.02)) root.add(m);
  const rr = (y: number) => cone(y) + 0.004;
  D.lathe(rr, decals.insignia(), { y: yB + 0.75, phi: -PI / 2, height: 0.3 });
  D.lathe(rr, D.badgeDark, { y: yB + 0.42, phi: -PI / 2, height: 0.075 });
  D.lathe(rr, decals.text('LANTERN I', { color: '#eceae4', stencil: true }), { y: yB + 1.08, phi: -PI * 0.75, height: 0.06 });
  D.lathe(rr, decals.symbol('warn'), { y: yShoulder - 0.15, phi: PI * 0.15, height: 0.06 });
  // hand rails beside hatch
  const rails: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const a = PI / 2 + side * 0.62;
    const pts: [number, number, number][] = [];
    for (const y of [yB + 0.38, yB + 0.4, yB + 0.85, yB + 0.87]) {
      const rr = cone(y) + (y === yB + 0.38 || y === yB + 0.87 ? 0.005 : 0.04);
      pts.push([rr * Math.sin(a), y, rr * Math.cos(a)]);
    }
    rails.push(pipe(pts, 0.009, 6, 20));
  }
  root.add(mk(rails, M.accent('yellow'), 'handRails'));
  // RCS ports near the shoulder: a recessed dark plate with a bezel and three thruster throats each
  const ports: THREE.BufferGeometry[] = [];
  const plates: THREE.BufferGeometry[] = [];
  const bezels: THREE.BufferGeometry[] = [];
  const pw = 0.13 / cone(yPorts);
  for (const a of portPhis) {
    plates.push(patch(cone, yPorts - 0.06, yPorts + 0.06, a, pw, 0.0025, 2, 4));
    bezels.push(...outline(cone, yPorts - 0.06, yPorts + 0.06, a, pw, 0.01, 0.005));
    for (const [dy, dphi] of [[0.025, 0], [-0.025, -0.05], [-0.025, 0.05]] as const) {
      const y = yPorts + dy;
      const g = cyl(0.011, 0.016, 0.03, 8);
      g.rotateX(PI / 2);
      g.translate(0, y, cone(y) + 0.008);
      g.rotateY(a + dphi);
      ports.push(g);
    }
  }
  root.add(mk(ports, M.soot(), 'rcsPorts'));
  root.add(mk(plates, M.darkMetal(), 'rcsRecess'));
  root.add(mk(bezels, M.gunmetal(), 'rcsBezels'));
  D.addTo(root);
  return root;
}

function buildHarbor(def: PartDef): THREE.Object3D {
  const { rTop, rBot: R, h } = cylDims(def);
  const yB = -h / 2;
  const yT = h / 2;
  const root = grp('pod');
  const yRim = yB + 0.2;
  const yShoulder = yB + 2.0;
  const rS = rTop + 0.06;
  const r0 = R * 0.985;
  const y0 = yRim + 0.08;
  const y1 = yShoulder - 0.08;
  const cone = (y: number) => r0 + ((rS + 0.02 - r0) * (y - y0)) / (y1 - y0);

  root.add(mk(charShield(lathe([[0, yB], [R * 0.45, yB + 0.03], [R * 0.78, yB + 0.08], [R * 0.95, yB + 0.14], [R, yRim]], { segments: 72, tile: 0.5 }), R, 4), M.heatTiles(), 'heatShield'));
  root.add(mk(charShield(lathe([[R, yRim], [R, yRim + 0.04], [r0, y0]], { segments: 72 }), R, 5), M.ablator()));
  shieldCarrier(root, R, yRim + 0.022, 0.036, 8, 72);
  // quilted blanket body, subdivided so RCS staining and rain streaks have rings to live on
  const yRcs = yB + 1.25;
  const rcsPhis = [0, 1, 2, 3].map((i) => PI / 4 + (i * PI) / 2 + PI / 2);
  const bodyP: Profile = [...coneRun(cone, y0, y1, 8), [rS - 0.02, yShoulder - 0.02], [rTop + 0.02, yShoulder]];
  root.add(mk(capsuleGrime(lathe(bodyP, { segments: 72, tile: 1 }), rcsPhis.map((phi) => ({ y: yRcs, phi })), cone(yRcs), y0, yShoulder, 7), M.quilt(), 'body'));
  root.add(mk(patch(cone, y0 + 0.06, y0 + 0.14, 0, PI * 2, 0.008, 1, 72), M.accent('blue'), 'band'));
  root.add(mk(patch(cone, y0 + 0.17, y0 + 0.19, 0, PI * 2, 0.008, 1, 72), M.accent('blue')));
  if (detailLevel() === 1) {
    // blanket close-out tapes: vertical seams clear of windows, hatch, insignia and thruster clusters, and a
    // circumferential seam under the shoulder
    const blocked: [number, number][] = [[-0.32, 0.24], [0.32, 0.24], [PI / 2, 0.42], [-PI / 2, 0.3], [PI, 0.2], ...rcsPhis.map((a): [number, number] => [a, 0.13])];
    const tapes = straps(cone, y0 + 0.2, y1 - 0.06, freeAngles(24, PI / 24, blocked), 0.035, 0.005, 10);
    tapes.push(patch(cone, y1 - 0.06, y1 - 0.025, 0, PI * 2, 0.005, 1, 72));
    root.add(mk(tapes, M.satinWhite(), 'closeoutTapes'));
    // grab rails either side of the hatch
    const rails: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const a = PI / 2 + side * 0.48;
      const pts: [number, number, number][] = [];
      for (const [y, out] of [[yB + 0.62, 0.008], [yB + 0.65, 0.05], [yB + 1.2, 0.05], [yB + 1.23, 0.008]] as const) {
        const rr = cone(y) + out;
        pts.push([rr * Math.sin(a), y, rr * Math.cos(a)]);
      }
      rails.push(pipe(pts, 0.011, 6, 14));
    }
    root.add(mk(rails, M.accent('yellow'), 'handRails'));
  }
  // docking tunnel
  root.add(
    mk(
      lathe(
        [
          [rTop + 0.02, yShoulder],
          [rTop - 0.03, yShoulder + 0.02],
          [rTop - 0.03, yT - 0.07],
          [rTop, yT - 0.06],
          [rTop, yT],
          [rTop, yT],
          [rTop * 0.82, yT],
          [rTop * 0.82, yT],
          [rTop * 0.8, yT - 0.02],
          [0, yT - 0.02],
        ],
        { segments: 56, tile: 0.5 },
      ),
      M.aluminium(),
      'tunnel',
    ),
  );
  root.add(mk(torus(rTop * 0.7, 0.025, 6, 40).translate(0, yT - 0.015, 0), M.gunmetal(), 'dockingRing'));
  const latches = box(0.06, 0.05, 0.04);
  latches.translate(0, yT - 0.02, rTop * 0.88);
  root.add(mk(around(latches, 8, 0), M.gunmetal()));
  // windows: two rendezvous windows, hatch window
  for (const a of [-0.32, 0.32]) for (const m of windowOn(cone, yB + 1.45, yB + 1.7, a, 0.28, 0.03)) root.add(m);
  const D = new Markings(def);
  hatchOn(root, D, cone, yB + 0.55, yB + 1.3, PI / 2, 0.75, M.satinWhite());
  for (const m of windowOn(cone, yB + 0.95, yB + 1.15, PI / 2, 0.18, 0.025)) root.add(m);
  const rr = (y: number) => cone(y) + 0.012;
  D.lathe(rr, decals.insignia(), { y: yB + 1.15, phi: -PI / 2, height: 0.5 });
  D.lathe(rr, D.badge, { y: yB + 0.62, phi: -PI / 2, height: 0.11 });
  D.lathe(rr, decals.text('HARBOR III', { color: '#1d3f78', weight: 800 }), { y: yB + 1.62, phi: PI, height: 0.09 });
  D.lathe(rr, D.plate, { y: yB + 0.5, phi: PI * 0.8, height: 0.07 });
  for (const a of [PI * 0.25, PI * 1.25]) D.lathe(rr, decals.text('NO STEP', { color: '#24272c', stencil: true }), { y: yB + 1.85, phi: a, height: 0.04 });
  // RCS clusters
  const rcs: THREE.BufferGeometry[] = [];
  const noz: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2 + PI / 2;
    rcs.push(patch(cone, yB + 1.15, yB + 1.35, a, 0.18, 0.009, 2, 4));
    for (const [dy, dphi] of [[0.1, 0], [0.04, -0.05], [0.04, 0.05]] as const) {
      const y = yB + 1.15 + dy + 0.03;
      const g = cyl(0.012, 0.022, 0.035, 8);
      g.rotateX(PI / 2);
      g.translate(0, y, cone(y) + 0.015);
      g.rotateY(a + dphi);
      noz.push(g);
    }
  }
  root.add(mk(rcs, M.darkMetal(), 'rcsPanels'));
  root.add(mk(noz, M.soot()));
  // umbilical
  const umb = box(0.16, 0.12, 0.06);
  umb.translate(0, yB + 0.5, cone(yB + 0.5) + 0.02);
  umb.rotateY(PI);
  root.add(mk(umb, M.gunmetal(), 'umbilical'));
  D.addTo(root);
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildProbeCore(def: PartDef): THREE.Object3D {
  const style = str(def, 'style', 'pebble');
  const { rTop: r, h } = cylDims(def);
  const root = grp('probeCore');
  const ringH = style === 'cairn' ? 0.05 : 0.03;
  const seg = 48;
  root.add(
    mk(
      [
        lathe([[r * 0.97, h / 2 - ringH], [r, h / 2 - ringH], [r, h / 2 - 0.004], [r * 0.98, h / 2]], { segments: seg }),
        lathe([[r * 0.98, -h / 2], [r, -h / 2 + 0.004], [r, -h / 2 + ringH], [r * 0.97, -h / 2 + ringH]], { segments: seg }),
      ],
      M.aluminium(),
      'rings',
    ),
  );
  root.add(mk([lathe([[r * 0.98, h / 2], [r * 0.4, h / 2 - 0.006], [0, h / 2 - 0.006]], { segments: seg }), lathe([[0, -h / 2 + 0.006], [r * 0.4, -h / 2 + 0.006], [r * 0.98, -h / 2]], { segments: seg })], M.darkMetal()));
  const oct = r * 0.96;
  const bodyH = h - ringH * 2;
  const body = new THREE.CylinderGeometry(oct, oct, bodyH, 8, 1, false, PI / 8);
  const uv = body.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * oct * 6.1 * 0.5, uv.getY(i) * bodyH * 0.5);
  root.add(mk(body, M.goldFoil(), 'foilBody'));
  const ap = oct * Math.cos(PI / 8);
  const faceW = 2 * oct * Math.sin(PI / 8);
  // corner tapes
  const tape = box(0.022, bodyH, 0.01);
  tape.translate(0, 0, oct - 0.002);
  root.add(mk(around(tape, 8, 0, PI / 8), M.silverFoil(), 'tapes'));

  // maker's mark on a foil face
  {
    const D = new Markings(def);
    const lg = D.logo;
    const s = Math.min(bodyH * 0.55, faceW * 0.8);
    D.plane(lg, s, (g) => g.translate(0, style === 'cairn' ? -bodyH * 0.15 : 0, ap + 0.003).rotateY(style === 'cairn' ? (7 * PI) / 4 : -PI / 2));
    D.addTo(root);
  }
  if (style === 'cairn') {
    // radiator panels on alternate faces
    const rad = box(faceW * 0.8, bodyH * 0.82, 0.012, 0.25);
    rad.translate(0, 0, ap + 0.006);
    root.add(mk(around(rad, 4, 0, 0), M.louvre(), 'radiators'));
    // star tracker on face 1
    const fa = (i: number) => (i * PI) / 4;
    const st = grp('starTracker');
    st.add(mk(cyl(0.055, 0.055, 0.1, 16).rotateX(PI / 2).translate(0, 0, ap + 0.05), M.gunmetal()));
    st.add(mk(lathe([[0.05, 0], [0.09, 0.09]], { segments: 20 }).rotateX(PI / 2).translate(0, 0, ap + 0.1), M.blackPaint()));
    st.add(mk(new THREE.CircleGeometry(0.04, 20).translate(0, 0, ap + 0.101), M.glass()));
    st.rotation.y = fa(1);
    st.position.y = bodyH * 0.12;
    root.add(st);
    // patch antenna (face 5) and avionics box (face 3)
    const pa = grp();
    pa.add(mk(cyl(0.09, 0.09, 0.015, 24).rotateX(PI / 2).translate(0, 0, ap + 0.008), M.satinWhite()));
    pa.rotation.y = fa(5);
    root.add(pa);
    const av = grp();
    av.add(mk(box(0.16, 0.12, 0.05).translate(0, 0, ap + 0.025), M.darkMetal()));
    av.add(mk([box(0.012, 0.012, 0.01).translate(-0.04, 0.03, ap + 0.052), box(0.012, 0.012, 0.01).translate(-0.015, 0.03, ap + 0.052)], M.statusLed('teal')));
    av.add(mk(box(0.012, 0.012, 0.01).translate(0.01, 0.03, ap + 0.052), M.statusLed('red')));
    av.rotation.y = fa(3);
    root.add(av);
  } else {
    // small avionics box, sun sensor and whip antenna
    const g = grp();
    g.add(mk(box(0.09, 0.08, 0.03).translate(0, 0, ap + 0.015), M.darkMetal()));
    g.add(mk(box(0.01, 0.01, 0.008).translate(0.025, 0.02, ap + 0.032), M.statusLed('teal')));
    root.add(g);
    const sun = grp();
    sun.add(mk(cyl(0.022, 0.022, 0.02, 12).rotateX(PI / 2).translate(0, 0, ap + 0.01), M.gunmetal()));
    sun.add(mk(new THREE.CircleGeometry(0.016, 12).translate(0, 0, ap + 0.0205), M.glass()));
    sun.rotation.y = PI;
    root.add(sun);
    const ant = grp();
    ant.add(mk(rod([ap + 0.01, 0.02, 0], [ap + 0.06, 0.13, 0], 0.004, 6), M.chrome()));
    ant.add(mk(sphere(0.008, 8, 6).translate(ap + 0.06, 0.13, 0), M.gunmetal()));
    ant.add(mk(box(0.02, 0.03, 0.03).translate(ap + 0.005, 0.02, 0), M.gunmetal()));
    root.add(ant);
  }
  return root;
}
