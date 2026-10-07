import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, bevelBox, box, cyl, cylinder, detailLevel, grp, lathe, merge, mk, pipe, rod, sphere, torus, type Profile } from '../geom';
import { boxDims, cylDims, num, srfMount, str } from './common';
import { decals } from '../decals';
import { Markings } from './markings';

const PI = Math.PI;

/** Recessed dark bulkhead cap (top if dir=1, bottom if dir=-1). */
function bulkhead(r: number, y: number, dir: 1 | -1, seg = 48): THREE.BufferGeometry {
  const d = dir;
  const p: Profile = [
    [r, y],
    [r * 0.92, y - d * 0.006],
    [r * 0.62, y - d * 0.006],
    [r * 0.6, y - d * 0.016],
    [r * 0.32, y - d * 0.016],
    [r * 0.3, y - d * 0.01],
    [0, y - d * 0.01],
  ];
  // top cap profile runs outer->inner (normal up); bottom must run inner->outer.
  return lathe(dir === 1 ? p : p.slice().reverse(), { segments: seg });
}

function boltRing(r: number, y: number, n: number, size: number): THREE.BufferGeometry[] {
  const b = cyl(size, size, size * 1.2, 6);
  b.rotateX(PI / 2);
  return around(b, n, r, 0, y);
}

// ---------------------------------------------------------------------------------------------

/** Smooth periodic 1D value noise over angle (n cells around), deterministic per seed. */
function ringNoise(phi: number, n: number, seed: number): number {
  const x = ((phi / (2 * PI)) % 1 + 1) % 1 * n;
  const i = Math.floor(x);
  const f = x - i;
  const h = (k: number) => {
    const v = Math.sin(((k % n) + 1) * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const t = f * f * (3 - 2 * f);
  return h(i) * (1 - t) + h(i + 1) * t;
}

export interface WeatherOpts {
  /** Generic soot darkening at the bottom (0..1); engine-aware soot is baked per craft (soot.ts). */
  soot: number;
  /** Fraction of the height the soot reaches. */
  reach?: number;
  /** Vertical stain streak strength. */
  streaks?: number;
  /** Per-part paint batch brightness (multiplies everything). */
  tint?: number;
  seed?: number;
}

/**
 * Large-scale weathering baked into a body's vertex colour (AO multiplies it later): engine soot at the bottom,
 * faint handling dirt at the top, vertical stains hanging from the top frame and a per-part paint batch tint.
 * These read at whole-vehicle distance where texture detail is sub-pixel, and break up texture tiling.
 */
export function weather(g: THREE.BufferGeometry, y0: number, y1: number, o: WeatherOpts): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const reach = o.reach ?? 0.4;
  const seed = o.seed ?? 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / Math.max(1e-3, y1 - y0);
    const phi = Math.atan2(pos.getX(i), pos.getZ(i));
    const k = Math.max(0, 1 - t / reach);
    let s = o.soot * k * k * (3 - 2 * k) + 0.03 * Math.max(0, (t - 0.85) / 0.15);
    if (o.streaks) {
      const streak = Math.max(0, ringNoise(phi, 37, seed) * 0.7 + ringNoise(phi, 91, seed + 3) * 0.5 - 0.55) / 0.65;
      const hang = Math.pow(Math.max(0, t), 1.6) * (0.6 + 0.4 * ringNoise(phi, 13, seed + 7));
      s += o.streaks * streak * hang + o.streaks * 0.35 * (ringNoise(phi, 7, seed + 11) - 0.5);
    }
    const tint = o.tint ?? 1;
    col[i * 3] = tint * (1 - s * 0.92);
    col[i * 3 + 1] = tint * (1 - s * 0.97);
    col[i * 3 + 2] = tint * (1 - s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Deterministic 0..1 hash of a part id (paint batches, stain layouts). */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/** Straight run [rOut, y0..y1] subdivided so vertex colour gradients have rings to live on. */
function shellProfile(r: number, y0: number, y1: number, step = 0.5): Profile {
  const n = Math.min(8, Math.max(3, Math.ceil((y1 - y0) / step)));
  const p: Profile = [];
  for (let i = 0; i <= n; i++) p.push([r, y0 + ((y1 - y0) * i) / n]);
  return p;
}

/** Stepped end frame: lip, machined groove, bolt flange and chamfer. Ordered so normals face outward. */
function endFrame(r: number, rb: number, yIn: number, yEdge: number): Profile {
  const s = Math.sign(yEdge - yIn);
  const b = Math.abs(yEdge - yIn);
  const p: Profile = [
    [rb, yIn],
    [r * 1.003, yIn + s * b * 0.32],
    [r * 0.994, yIn + s * (b * 0.32 + 0.006)],
    [r * 0.994, yIn + s * b * 0.46],
    [r * 1.006, yIn + s * (b * 0.46 + 0.006)],
    [r * 1.006, yEdge - s * 0.012],
    [r * 0.985, yEdge],
  ];
  return s > 0 ? p : p.reverse();
}

export function buildTank(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const finish = str(def, 'finish', 'white');
  const root = grp('tank');
  const band = Math.min(0.07 + 0.06 * r, h * 0.14);
  const rb = r * 0.992;
  const white = finish === 'white';
  const orange = finish === 'orange';
  const bodyMat = orange ? M.orangeFoam() : finish === 'steel' ? M.steel() : finish === 'charcoal' ? M.charcoalPanel() : M.whitePanel();
  const frameMat = white || orange ? M.aluminium() : M.gunmetal();
  const tile = orange ? 1.5 : finish === 'steel' ? 1.2 : 1;
  const seg = r > 0.9 ? 96 : r > 0.5 ? 72 : 56;
  const yBody0 = -h / 2 + band;
  const yBody1 = h / 2 - band;
  const bodyLen = yBody1 - yBody0;

  const shell = shellProfile(rb, yBody0, yBody1);
  // one extra ring near the aft end so engine soot (baked per craft, soot.ts) has a gradient to live on
  if (detailLevel() === 1 && shell[1][1] - yBody0 > 0.45) shell.splice(1, 0, [rb, yBody0 + 0.28]);
  const body = lathe(shell, { segments: seg, tile, vOffset: 0.5 * tile });
  const hid = idHash(def.id);
  weather(body, yBody0, yBody1, { soot: 0, streaks: orange ? 0.26 : white ? 0.17 : 0.1, tint: 0.95 + 0.05 * hid, seed: 1 + Math.floor(hid * 97) });
  root.add(mk(body, bodyMat, 'body'));
  root.add(mk([lathe(endFrame(r, rb, yBody1, h / 2), { segments: seg }), lathe(endFrame(r, rb, yBody0, -h / 2), { segments: seg })], frameMat, 'frames'));
  root.add(mk([bulkhead(r * 0.985, h / 2, 1, 48), bulkhead(r * 0.985, -h / 2, -1, 48)], M.darkMetal(), 'bulkheads'));

  // fasteners on the bolt flanges
  const nb = Math.round(8 * r + 10);
  const bs = 0.009 + 0.005 * r;
  root.add(mk([...boltRing(r * 1.006, h / 2 - band * 0.3, nb, bs), ...boltRing(r * 1.006, -h / 2 + band * 0.3, nb, bs)], M.chrome(), 'bolts'));

  // raised weld lands (white/charcoal) or external hat stringers (charcoal intertank look); High detail only
  const fine = detailLevel() === 1;
  const paintDetail: THREE.BufferGeometry[] = [];
  if (fine && !orange && finish !== 'steel') {
    const lands = Math.min(2, Math.floor(bodyLen / 1.6));
    for (let i = 1; i <= lands; i++) {
      const y = yBody0 + (bodyLen * i) / (lands + 1);
      const w = 0.028 + 0.008 * r;
      paintDetail.push(lathe([[rb, y - w], [rb + 0.0045, y - w * 0.4], [rb + 0.0045, y + w * 0.4], [rb, y + w]], { segments: seg, tile, creaseAngle: PI }));
    }
  }
  if (fine && finish === 'charcoal') {
    const n = Math.max(12, Math.round((2 * PI * r) / 0.17));
    const s = box(0.04, bodyLen - 0.02, 0.022, 0.5);
    s.translate(0, 0, rb + 0.008);
    paintDetail.push(...around(s, n, 0, PI / n));
  }
  if (fine && orange && h / r > 4) {
    // ribbed intertank band: foam-sprayed hat stringers between two bare-metal flange rings
    const yc = yBody0 + bodyLen * 0.77;
    const hb = Math.min(0.32 + 0.12 * r, bodyLen * 0.12);
    const n = Math.max(16, Math.round((2 * PI * r) / 0.15));
    const rib = box(0.05, hb - 0.05, 0.03, 0.5);
    rib.translate(0, yc, rb + 0.012);
    paintDetail.push(...around(rib, n, 0, PI / n));
    const fl = (y: number) => lathe([[rb, y - 0.022], [rb + 0.016, y - 0.016], [rb + 0.016, y + 0.016], [rb, y + 0.022]], { segments: seg });
    root.add(mk([fl(yc - hb / 2), fl(yc + hb / 2)], M.aluminium(), 'intertankFlanges'));
  }
  if (paintDetail.length) root.add(mk(paintDetail, bodyMat, 'skinDetail'));

  // cable raceway with tie-down straps and a pressurisation line in clamps
  const phiRw = 0.44 * PI; // between the propellant stencils and the insignia
  const rwW = 0.07 + 0.05 * r;
  const rwD = 0.03 + 0.01 * r;
  const rwLen = h - 0.03;
  const tray: THREE.BufferGeometry[] = [];
  const t0 = box(rwW, rwLen, rwD, 0.5);
  t0.translate(0, 0, rb + rwD / 2 - 0.003);
  tray.push(t0);
  const straps: THREE.BufferGeometry[] = [];
  const nStraps = fine ? Math.max(2, Math.min(12, Math.round(rwLen / 0.6))) : 0;
  for (let i = 0; i < nStraps; i++) {
    const y = -rwLen / 2 + (rwLen * (i + 0.5)) / nStraps;
    const st = box(rwW * 1.22, 0.028, rwD + 0.012);
    st.translate(0, y, rb + rwD / 2 + 0.002);
    straps.push(st);
  }
  const pr = orange ? 0.035 + 0.02 * r : 0.016 + 0.01 * r;
  const pipeOff = rwW / 2 + pr + 0.05;
  const lineR = rb + pr + 0.012;
  const line = cyl(pr, pr, h - 0.01, orange ? 14 : 10);
  line.translate(pipeOff, 0, lineR);
  const clamps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nStraps; i++) {
    const y = -rwLen / 2 + (rwLen * (i + 0.5)) / nStraps;
    const c = box(pr * 2.6, 0.035, pr + 0.02);
    c.translate(pipeOff, y, rb + (pr + 0.02) / 2);
    clamps.push(c);
  }
  for (const g of [...tray, ...straps, line, ...clamps]) g.rotateY(phiRw);
  root.add(mk(tray, finish === 'charcoal' ? M.aluminium() : M.gunmetal(), 'raceway'));
  if (nStraps) root.add(mk([...straps, ...clamps], finish === 'charcoal' ? M.gunmetal() : M.aluminium(), 'clamps'));
  root.add(mk(line, orange ? M.orangeFoam() : M.aluminium(), 'pressLine'));

  if (white) {
    const livery: THREE.BufferGeometry[] = [];
    const lr = r * 0.9945;
    if (h / r > 3.5) {
      // roll-pattern quadrants
      const y1 = yBody1 - 0.05;
      const y0 = y1 - bodyLen * 0.28;
      livery.push(lathe([[lr, y0], [lr, y1]], { segments: 16, phiStart: 0, phiLength: PI / 2, vOffset: 0.5 }));
      livery.push(lathe([[lr, y0], [lr, y1]], { segments: 16, phiStart: PI, phiLength: PI / 2, vOffset: 0.5 }));
      const z1 = yBody0 + 0.05 + bodyLen * 0.12;
      const z0 = yBody0 + 0.05;
      livery.push(lathe([[lr, z0], [lr, z1]], { segments: 16, phiStart: PI / 2, phiLength: PI / 2, vOffset: 0.5 }));
      livery.push(lathe([[lr, z0], [lr, z1]], { segments: 16, phiStart: (3 * PI) / 2, phiLength: PI / 2, vOffset: 0.5 }));
    } else {
      const y = yBody1 - 0.05 - r * 0.06;
      for (const dy of [0, -0.07 - r * 0.04]) livery.push(lathe([[lr, y + dy - 0.018 - r * 0.012], [lr, y + dy]], { segments: seg }));
    }
    root.add(mk(livery, M.charcoalPanel(), 'livery'));
  }
  tankMarkings(def, root, rb, yBody1, yBody0, finish);
  return root;
}

/** Manufacturer badge, part plate, program wordmark/flag and propellant stencils on a tank body. */
function tankMarkings(def: PartDef, root: THREE.Object3D, rb: number, yTop: number, yBot: number, finish: string) {
  const D = new Markings(def);
  const dark = finish === 'charcoal';
  const ink = dark ? '#e9e7e1' : '#24272c';
  const lo = yBot + 0.03;
  const hi = yTop - 0.03;
  const span = hi - lo;
  const r = rb + 0.003; // clear of the raised weld lands
  if (span < 0.15) return;
  const badge = dark ? D.badgeDark : D.badge;
  if (span > 1.1) {
    // long tank: badge runs up the side
    const hb = Markings.fit(badge, 0.12 + 0.12 * r, span * 0.55);
    const len = hb * badge.aspect;
    D.cyl(r, badge, { y: lo + span * 0.18 + len / 2, phi: -PI * 0.25, height: hb, vertical: true });
  } else {
    const hb = Markings.fit(badge, Math.min(0.06 + 0.05 * r, span * 0.3), r * 1.3);
    D.cyl(r, badge, { y: lo + span * 0.62, phi: -PI * 0.25, height: hb });
  }
  const plate = dark ? D.plateDark : D.plate;
  const hp = Markings.fit(plate, Math.min(0.045 + 0.03 * r, span * 0.25), r * 0.9);
  D.cyl(r, plate, { y: lo + hp * 0.9, phi: PI * 0.25, height: hp });
  if (span > 0.5) {
    const ins = decals.insignia();
    const hi2 = Math.min(0.12 + 0.18 * r, span * 0.3);
    D.cyl(r, ins, { y: hi - hi2 * 0.8, phi: PI * 0.78, height: hi2 });
  }
  if (span > 0.8) {
    const ox = decals.text('LOX', { stencil: true, color: ink });
    const fu = decals.text('FUEL', { stencil: true, color: ink });
    const ht = 0.035 + 0.03 * r;
    D.cyl(r, ox, { y: hi - ht * 1.2, phi: PI * 0.25, height: ht });
    D.cyl(r, fu, { y: lo + hp * 2 + ht, phi: PI * 0.25, height: ht });
  }
  if (finish !== 'steel' && span > 1.6 && r > 0.45) {
    // program wordmark down the front (between the roll-pattern blocks) with the flag above it
    const word = decals.text('WEB SPACE PROGRAM', { color: dark ? '#eceae4' : finish === 'orange' ? '#1a2230' : '#1d3f78', weight: 900 });
    const mid0 = lo + span * 0.16;
    const mid1 = hi - span * 0.32;
    const fl = decals.flag();
    const hf = Math.min(0.16 + 0.12 * r, (mid1 - mid0) * 0.2);
    const hw = Markings.fit(word, 0.12 + 0.12 * r, (mid1 - mid0 - hf * 1.4) * 0.95);
    const lw = hw * word.aspect;
    D.cyl(r, word, { y: mid0 + lw / 2, phi: PI * 0.07, height: hw, vertical: true });
    D.cyl(r, fl, { y: mid0 + lw + hf * 0.75, phi: PI * 0.07, height: hf });
  }
  D.addTo(root);
}

// ---------------------------------------------------------------------------------------------

export function buildAdapter(def: PartDef): THREE.Object3D {
  const { rTop, rBot, h } = cylDims(def);
  const root = grp('adapter');
  const f = 0.035;
  const seg = Math.max(rTop, rBot) > 0.9 ? 96 : 72;
  const y0 = -h / 2 + f, y1 = h / 2 - f;
  const n = Math.max(3, Math.ceil((y1 - y0) / 0.3));
  const prof: Profile = [];
  for (let i = 0; i <= n; i++) prof.push([(rBot + ((rTop - rBot) * i) / n) * 0.995, y0 + ((y1 - y0) * i) / n]);
  root.add(mk(weather(lathe(prof, { segments: seg, tile: 0.8 }), y0, y1, { soot: 0, streaks: 0.08, seed: 5 }), M.charcoalPanel(), 'body'));
  // external hat stringers along the slant (High detail only)
  const nS = detailLevel() < 1 ? 0 : Math.max(12, Math.round((2 * PI * Math.max(rTop, rBot)) / 0.16));
  const slant = Math.atan2(rBot - rTop, y1 - y0);
  const len = (y1 - y0) / Math.cos(slant) - 0.02;
  const st = box(0.036, len, 0.02, 0.5).rotateX(-slant);
  st.translate(0, 0, (rTop + rBot) / 2 * 0.995 + 0.007);
  if (nS) root.add(mk(around(st, nS, 0, PI / nS), M.charcoalPanel(), 'stringers'));
  root.add(
    mk(
      [
        lathe([[rBot * 0.98, -h / 2], [rBot, -h / 2 + 0.006], [rBot, -h / 2 + f], [rBot * 0.99, -h / 2 + f]], { segments: 56 }),
        lathe([[rTop * 0.99, h / 2 - f], [rTop, h / 2 - f], [rTop, h / 2 - 0.006], [rTop * 0.98, h / 2]], { segments: 56 }),
      ],
      M.aluminium(),
      'flanges',
    ),
  );
  // white band in the middle
  const t0 = 0.42;
  const t1 = 0.52;
  const ry = (t: number) => rBot + (rTop - rBot) * t;
  root.add(mk(lathe([[ry(t0) * 0.999 + 0.02, -h / 2 + h * t0], [ry(t1) * 0.999 + 0.02, -h / 2 + h * t1]], { segments: seg }), M.satinWhite(), 'stripe'));
  root.add(mk([bulkhead(rTop * 0.98, h / 2, 1), bulkhead(rBot * 0.98, -h / 2, -1)], M.darkMetal()));
  root.add(mk([...boltRing(rTop, h / 2 - f / 2, Math.round(20 * rTop + 8), 0.009), ...boltRing(rBot, -h / 2 + f / 2, Math.round(20 * rBot + 8), 0.009)], M.chrome()));
  const D = new Markings(def);
  const rOf = (y: number) => rBot * 0.995 + ((rTop - rBot) * 0.995 * (y + h / 2)) / h;
  const pl = D.plateDark;
  const yP = -h / 2 + h * 0.25;
  D.lathe(rOf, pl, { y: yP, phi: -PI / 2, height: Markings.fit(pl, h * 0.12, Math.min(rTop, rBot) * 1.2) });
  D.addTo(root);
  return root;
}

// ---------------------------------------------------------------------------------------------

/** Tangent ogive radius at distance x from the base (0..L). */
function ogive(R: number, L: number, x: number): number {
  const rho = (R * R + L * L) / (2 * R);
  return Math.sqrt(Math.max(0, rho * rho - (x) * (x))) + R - rho;
}

export function buildNoseCone(def: PartDef): THREE.Object3D {
  const { rBot: R, h } = cylDims(def);
  const root = grp('noseCone');
  const flange = 0.03;
  const L = h - flange;
  const yb = -h / 2 + flange;
  const steps = 28;
  const tipStart = 0.86;
  const body: Profile = [];
  const tip: Profile = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * L; // from base upward
    const r = ogive(R * 0.995, L, x);
    const pt: [number, number] = [Math.max(r, 0), yb + x];
    if (t <= tipStart) body.push(pt);
    if (t >= tipStart - 1e-9) tip.push(pt);
  }
  // blunt the tip
  const lastR = 0.015 * R + 0.005;
  tip[tip.length - 1] = [lastR, h / 2 - lastR * 0.4];
  tip.push([lastR * 0.6, h / 2 - lastR * 0.08], [0, h / 2]);
  root.add(mk(lathe(body, { segments: 56, tile: 1 }), M.satinWhite(), 'body'));
  root.add(mk(lathe(tip, { segments: 56 }), M.gunmetal(), 'tip'));
  root.add(mk(lathe([[R * 0.97, -h / 2], [R, -h / 2 + 0.005], [R, yb], [R * 0.995, yb]], { segments: 56 }), M.gunmetal(), 'flange'));
  root.add(mk(bulkhead(R * 0.97, -h / 2, -1), M.darkMetal()));
  // accent stripe
  const s0 = 0.06;
  const s1 = 0.1;
  root.add(
    mk(
      lathe([[ogive(R, L, s0 * L) + 0.002, yb + s0 * L], [ogive(R, L, s1 * L) + 0.002, yb + s1 * L]], { segments: 56 }),
      M.accent('teal'),
      'stripe',
    ),
  );
  if (detailLevel() === 1) {
    // fastener row above the flange and one circumferential panel seam
    const nb = Math.round(R * 20 + 8);
    const b0 = cyl(0.006 + 0.002 * R, 0.006 + 0.002 * R, 0.006, 6).rotateX(PI / 2);
    root.add(mk(around(b0, nb, ogive(R * 0.995, L, 0.025) + 0.002, 0, yb + 0.025), M.gunmetal(), 'fasteners'));
    const ys = 0.42;
    root.add(mk(lathe([[ogive(R, L, ys * L - 0.006) - 0.0005, yb + ys * L - 0.006], [ogive(R, L, ys * L) - 0.003, yb + ys * L], [ogive(R, L, ys * L + 0.006) - 0.0005, yb + ys * L + 0.006]], { segments: 56, creaseAngle: PI }), M.darkMetal(), 'seam'));
  }
  const D = new Markings(def);
  const rOf = (y: number) => ogive(R * 0.995, L, y - yb);
  const b = D.badge;
  D.lathe(rOf, b, { y: yb + L * 0.2, phi: -PI / 2, height: Markings.fit(b, 0.05 + 0.04 * R, R * 1.1) });
  D.addTo(root);
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildFairing(def: PartDef): THREE.Object3D {
  const { rTop: r, h: hb } = cylDims(def);
  const rs = num(def, 'shellRadius', r * 1.1);
  const H = num(def, 'shellHeight', 4);
  const root = grp('fairing');
  root.add(
    mk(
      lathe(
        [
          [0, -hb / 2],
          [r * 0.98, -hb / 2],
          [r, -hb / 2 + 0.01],
          [r, hb * 0.1],
          [r * 0.985, hb * 0.15],
          [r * 0.985, hb * 0.3],
          [r, hb * 0.35],
          [r, hb / 2],
          [r, hb / 2],
          [r * 0.8, hb / 2],
          [r * 0.8, hb / 2],
          [r * 0.8, hb / 2 - 0.03],
          [0, hb / 2 - 0.03],
        ],
        { segments: 56 },
      ),
      M.gunmetal(),
      'base',
    ),
  );
  // shell profile
  const y0 = hb / 2;
  const boat = (rs - r) * 1.8 + 0.08;
  const yCyl = y0 + H * 0.58;
  const L = H - (yCyl - y0);
  const prof: Profile = [[r * 0.99, y0], [rs, y0 + boat]];
  prof.push([rs, y0 + boat], [rs, yCyl]);
  for (let i = 1; i <= 18; i++) {
    const x = (i / 18) * L;
    prof.push([Math.max(ogive(rs, L, x), 0.0), yCyl + x]);
  }
  prof[prof.length - 1] = [0.02 * rs, y0 + H - 0.01 * rs];
  prof.push([0, y0 + H]);
  const inner: Profile = prof.map(([pr, py]) => [Math.max(pr - 0.025, 0), py]);
  const shell = grp('fairingShell');
  const gap = 0.01;
  for (const [name, phi] of [['fairingHalfA', 0], ['fairingHalfB', PI]] as const) {
    const half = grp(name);
    half.add(mk(lathe(prof, { segments: 32, phiStart: phi + gap, phiLength: PI - 2 * gap, tile: 1 }), M.satinWhite()));
    half.add(mk(lathe(inner, { segments: 32, phiStart: phi + gap, phiLength: PI - 2 * gap, tile: 1 }), M.innerLining()));
    // spine rail along the split edges
    const rails: THREE.BufferGeometry[] = [];
    for (const a of [phi + gap, phi + PI - gap]) {
      const pts: [number, number, number][] = [];
      for (let i = 1; i < prof.length - 1; i += 2) pts.push([prof[i][0] * Math.sin(a), prof[i][1], prof[i][0] * Math.cos(a)]);
      if (pts.length > 1) rails.push(pipe(pts, 0.012, 5, 40));
    }
    half.add(mk(rails, M.gunmetal()));
    // livery on each half: maker's badge up the side, agency insignia above it
    const D = new Markings(def);
    const yA = y0 + boat + 0.05;
    const yB = yCyl - 0.05;
    const span = yB - yA;
    if (span > 0.3) {
      const b = D.badge;
      const hb = Markings.fit(b, 0.1 + 0.1 * rs, span * 0.6);
      D.cyl(rs, b, { y: yA + span * 0.4, phi: phi + PI / 2, height: hb, vertical: true });
      D.lathe((y) => (y <= yCyl ? rs : ogive(rs, L, y - yCyl)), decals.insignia(), { y: yCyl + L * 0.12, phi: phi + PI / 2, height: Math.min(0.2 + 0.2 * rs, L * 0.18) });
      D.cyl(rs, decals.hazard(), { y: y0 + boat + 0.025, phi: phi + PI / 2, height: 0.03, width: rs * 0.5 });
    }
    D.addTo(half);
    shell.add(half);
  }
  root.add(shell);
  return root;
}

// ---------------------------------------------------------------------------------------------

/** Hex fastener head with its axis along +Y. */
const hexHead = (r: number, h: number) => cyl(r, r, h, 6);

/**
 * Clamp-band decoupler: bolted flanges, hazard-striped upper and lower rings with stiffeners, and a V-section
 * clamp band over the separation plane. The band is closed by tension-bolt blocks, each with a pair of pyro bolt
 * cutters wired into a firing harness; a ring of explosive-bolt bumps straddles the joint between them.
 */
export function buildDecoupler(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const root = grp('decoupler');
  const fine = detailLevel() === 1;
  const fl = h * 0.3;
  const seg = 56;
  const g = Math.min(0.022 + 0.008 * r, (h - 2 * fl) * 0.3); // clamp band half-height
  const rb = r * 0.955;
  root.add(
    mk(
      [
        lathe([[r * 0.98, -h / 2], [r, -h / 2 + 0.005], [r, -h / 2 + fl], [rb, -h / 2 + fl]], { segments: seg }),
        lathe([[rb, h / 2 - fl], [r, h / 2 - fl], [r, h / 2 - 0.005], [r * 0.98, h / 2]], { segments: seg }),
      ],
      M.aluminium(),
      'flanges',
    ),
  );
  root.add(mk([lathe([[rb, -h / 2 + fl], [rb, -g]], { segments: seg, tile: 0.25 }), lathe([[rb, g], [rb, h / 2 - fl]], { segments: seg, tile: 0.25 })], M.hazard(), 'hazardBand'));
  // V-band over the joint with the dark separation groove in its waist
  const rv = r * 0.995;
  const band = lathe([[rb, -g], [rv, -g * 0.6], [rv, -g * 0.16], [rv * 0.985, 0], [rv, g * 0.16], [rv, g * 0.6], [rb, g]], { segments: seg });
  root.add(mk(band, M.steel(), 'clampBand'));
  root.add(mk([bulkhead(r * 0.98, h / 2, 1, 40), bulkhead(r * 0.98, -h / 2, -1, 40)], M.darkMetal()));
  const nb = Math.round(12 * r + 8);
  const bs = 0.01 + 0.006 * r;
  root.add(mk([...boltRing(r, h / 2 - fl / 2, nb, bs), ...boltRing(r, -h / 2 + fl / 2, nb, bs)], M.chrome(), 'bolts'));
  // stiffeners on the hazard rings (High only)
  const stiff: THREE.BufferGeometry[] = [];
  if (fine) {
    const nS = Math.max(10, Math.round((2 * PI * r) / 0.34));
    for (const [y0, y1] of [[-h / 2 + fl, -g], [g, h / 2 - fl]]) {
      const st = box(0.014 + 0.004 * r, y1 - y0 - 0.006, 0.012).translate(0, (y0 + y1) / 2, rb + 0.005);
      stiff.push(...around(st, nS, 0, PI / nS));
    }
    root.add(mk(stiff, M.gunmetal(), 'stiffeners'));
  }
  // tension-bolt blocks with pyro bolt cutters, 2 or 3 around the band
  const nBlk = r > 1.5 ? 3 : 2;
  const bw = 0.07 + 0.03 * r;
  const blocks: THREE.BufferGeometry[] = [];
  const cutters: THREE.BufferGeometry[] = [];
  const wires: THREE.BufferGeometry[] = [];
  const studs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < nBlk; k++) {
    const a = (k / nBlk) * PI * 2 + PI / 4;
    const place = (gg: THREE.BufferGeometry) => gg.rotateY(a);
    for (const sx of [-1, 1]) blocks.push(place(bevelBox(bw * 0.38, g * 2.2, 0.03 + 0.006 * r).translate(sx * bw * 0.36, 0, rv + 0.014)));
    studs.push(place(cyl(0.008 + 0.002 * r, 0.008 + 0.002 * r, bw * 1.2, 8).rotateZ(PI / 2).translate(0, 0, rv + 0.02)));
    for (const sx of [-1, 1]) studs.push(place(hexHead(0.013 + 0.003 * r, 0.012).rotateZ(PI / 2).translate(sx * bw * 0.62, 0, rv + 0.02)));
    for (const sy of [-1, 1]) {
      cutters.push(place(cyl(0.012 + 0.003 * r, 0.012 + 0.003 * r, bw * 0.4, 10).rotateZ(PI / 2).translate(0, sy * g * 0.62, rv + 0.034)));
      if (fine) wires.push(place(pipe([[bw * 0.18, sy * g * 0.62, rv + 0.04], [bw * 0.45, sy * g * 1.4, rv + 0.03], [bw * 0.9, sy * (h / 2 - fl * 0.9), rb + 0.012]], 0.0035 + 0.001 * r, 4, 8)));
    }
  }
  root.add(mk(blocks, M.gunmetal(), 'clampBlocks'));
  root.add(mk(studs, M.chrome(), 'clampStuds'));
  root.add(mk(cutters, M.accent('red'), 'pyroCutters'));
  // explosive-bolt bumps straddling the joint between the blocks
  const nBump = fine ? Math.round(6 + 4 * r) : 4;
  const bump = lathe([[0.016 + 0.004 * r, 0], [0.016 + 0.004 * r, 0.01], [0, 0.02]], { segments: 8 });
  bump.rotateX(PI / 2);
  root.add(mk(around(bump.translate(0, 0, rv), nBump, 0, PI / nBump), M.darkMetal(), 'pyros'));
  // firing harness: a cable run under the upper flange feeding the cutters
  if (fine) wires.push(torus(rb + 0.006, 0.0045 + 0.001 * r, 3, 48).translate(0, h / 2 - fl - 0.008, 0));
  if (wires.length) root.add(mk(wires, M.cable(), 'harness'));
  // ordnance warning beside each clamp block, maker's mark on the flange
  const D = new Markings(def);
  const sym = decals.symbol('warn');
  const sz = Math.min(0.05 + 0.03 * r, h / 2 - fl - g - 0.01) * 0.85;
  if (sz > 0.015)
    for (let k = 0; k < nBlk; k++) {
      const a = (k / nBlk) * PI * 2 + PI / 4 + (bw * 1.1) / r;
      D.cyl(rb + 0.004, sym, { y: g + (h / 2 - fl - g) / 2, phi: a, height: sz });
    }
  if (fl > 0.03) D.cyl(r, decals.logo(D.livery.id, '#f2f1ec'), { y: h / 2 - fl / 2, phi: 0, height: fl * 0.7 });
  D.addTo(root);
  return root;
}

/**
 * Frangible-joint separator: charcoal shells with hat stringers, bolt rows either side of the chrome joint,
 * the linear charge's conduit ring, hazard chevrons, red initiator boxes and their connector blocks.
 */
export function buildSeparator(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const root = grp('separator');
  const fine = detailLevel() === 1;
  const seg = 56;
  const g = 0.02 + 0.01 * r;
  root.add(
    mk(
      [
        lathe([[r * 0.98, -h / 2], [r, -h / 2 + 0.006], [r, -g], [r * 0.96, -g * 0.3]], { segments: seg, tile: 0.8 }),
        lathe([[r * 0.96, g * 0.3], [r, g], [r, h / 2 - 0.006], [r * 0.98, h / 2]], { segments: seg, tile: 0.8 }),
      ],
      M.charcoalPanel(),
      'shells',
    ),
  );
  root.add(mk(lathe([[r * 0.96, -g * 0.3], [r * 0.94, 0], [r * 0.96, g * 0.3]], { segments: seg }), M.chrome(), 'frangibleJoint'));
  root.add(mk([bulkhead(r * 0.98, h / 2, 1), bulkhead(r * 0.98, -h / 2, -1)], M.darkMetal()));
  // bolt rows either side of the joint and the charge conduit ring in the groove
  const nb = Math.round(14 * r + 8);
  root.add(mk([...boltRing(r, g * 1.6, nb, 0.008 + 0.003 * r), ...boltRing(r, -g * 1.6, nb, 0.008 + 0.003 * r)], M.chrome(), 'bolts'));
  root.add(mk(torus(r * 0.955, 0.006 + 0.002 * r, 4, 64), M.darkMetal(), 'chargeConduit'));
  if (fine) {
    const nS = Math.max(12, Math.round((2 * PI * r) / 0.2));
    const st: THREE.BufferGeometry[] = [];
    for (const [y0, y1] of [[-h / 2 + 0.015, -g * 2.4], [g * 2.4, h / 2 - 0.015]]) {
      if (y1 - y0 < 0.02) continue;
      st.push(...around(box(0.03, y1 - y0, 0.014, 0.5).translate(0, (y0 + y1) / 2, r + 0.005), nS, 0, PI / nS));
    }
    if (st.length) root.add(mk(st, M.charcoalPanel(), 'stringers'));
  }
  // hazard chevrons
  const chev = lathe([[r + 0.002, h * 0.22], [r + 0.002, h * 0.36]], { segments: 8, phiLength: PI / 8, tile: 0.25 });
  const chevs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const c = chev.clone();
    c.rotateY((i * PI) / 2);
    chevs.push(c);
    const c2 = c.clone();
    c2.translate(0, -h * 0.58, 0);
    chevs.push(c2);
  }
  root.add(mk(chevs, M.hazard()));
  const pb = bevelBox(0.06 + 0.02 * r, g * 2.6, 0.035);
  pb.translate(0, 0, r + 0.005);
  root.add(mk(around(pb, 6, 0, PI / 6), M.accent('red'), 'pyros'));
  // connector block and lead beside each initiator
  const cb: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = PI / 6 + (i * PI) / 3;
    const off = (0.06 + 0.02 * r) / r;
    cb.push(cyl(0.012, 0.012, 0.03, 8).rotateX(PI / 2).translate(0, g * 2.2, r + 0.012).rotateY(a + off));
    if (fine) cb.push(pipe([[0, g * 1.2, r + 0.022], [0.025, g * 2.1, r + 0.02], [0.04, g * 2.2, r + 0.012]], 0.004, 5, 8).rotateY(a + off * 0.4));
  }
  root.add(mk(cb, M.gunmetal(), 'connectors'));
  return root;
}

export function buildRadialDecoupler(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('radialDecoupler');
  const base = box(w, h, 0.03);
  base.translate(0, 0, zm + 0.015);
  const outer = box(w * 0.9, h * 0.8, 0.03);
  outer.translate(0, 0, zm + d - 0.015);
  root.add(mk([base, outer], M.gunmetal(), 'plates'));
  const cheekGeo: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const c = box(0.025, h * 0.62, d - 0.06, 0.25);
    c.translate(sx * (w / 2 - 0.02), 0, zm + d / 2);
    cheekGeo.push(c);
  }
  root.add(mk(cheekGeo, M.hazard(), 'cheeks'));
  const sleeve = cyl(0.045, 0.045, d * 0.45, 16);
  sleeve.rotateX(PI / 2);
  sleeve.translate(0, 0, zm + 0.03 + d * 0.225);
  const piston = cyl(0.026, 0.026, d * 0.5, 12);
  piston.rotateX(PI / 2);
  piston.translate(0, 0, zm + d - 0.03 - d * 0.25);
  root.add(mk(sleeve, M.darkMetal(), 'sleeve'));
  root.add(mk(piston, M.chrome(), 'piston'));
  const bolts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const b = cyl(0.012, 0.012, 0.012, 6);
      b.rotateX(PI / 2);
      b.translate(sx * w * 0.36, sy * h * 0.43, zm + 0.034);
      bolts.push(b);
    }
  root.add(mk(bolts, M.chrome()));
  // explosive bolts through the outer plate (domed initiators), their leads, and a red arming plug
  const pyro: THREE.BufferGeometry[] = [];
  const leads: THREE.BufferGeometry[] = [];
  for (const sy of [-1, 1]) {
    const b = lathe([[0.022, 0], [0.022, 0.012], [0.012, 0.022], [0, 0.024]], { segments: 10 });
    b.rotateX(PI / 2);
    b.translate(0, sy * h * 0.28, zm + d);
    pyro.push(b);
    if (detailLevel() === 1) leads.push(pipe([[0.016, sy * h * 0.28, zm + d + 0.012], [w * 0.22, sy * h * 0.18, zm + d + 0.01], [w * 0.3, 0, zm + d + 0.006]], 0.0045, 4, 8));
  }
  root.add(mk(pyro, M.darkMetal(), 'pyros'));
  if (leads.length) root.add(mk(leads, M.cable(), 'leads'));
  root.add(mk(bevelBox(0.05, 0.04, 0.025).translate(w * 0.3, 0, zm + d + 0.012), M.accent('red'), 'armPlug'));
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildGirder(def: PartDef): THREE.Object3D {
  const { w, h } = boxDims(def);
  const root = grp('girder');
  const c = w / 2 - 0.025;
  const plateT = 0.03;
  const L = h - plateT * 2;
  const longerons: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const b = box(0.035, L, 0.035);
      b.translate(sx * c, 0, sz * c);
      longerons.push(b);
    }
  const bays = 6;
  const braces: THREE.BufferGeometry[] = [];
  const corners: [number, number][] = [[-c, -c], [c, -c], [c, c], [-c, c]];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = corners[f];
    const [bx, bz] = corners[(f + 1) % 4];
    for (let i = 0; i < bays; i++) {
      const y0 = -L / 2 + (i / bays) * L;
      const y1 = -L / 2 + ((i + 1) / bays) * L;
      const flip = (i + f) % 2 === 0;
      braces.push(rod(flip ? [ax, y0, az] : [bx, y0, bz], flip ? [bx, y1, bz] : [ax, y1, az], 0.011, 5));
      const hb = box(Math.abs(bx - ax) + 0.02, 0.02, Math.abs(bz - az) + 0.02);
      hb.translate((ax + bx) / 2, y0, (az + bz) / 2);
      if (i > 0) braces.push(hb);
    }
  }
  root.add(mk([...longerons, ...braces], M.redOxide(), 'truss'));
  const plates: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const p = box(w, plateT, w);
    p.translate(0, s * (h / 2 - plateT / 2), 0);
    plates.push(p);
    plates.push(cyl(0.16, 0.16, 0.012, 24, s * (h / 2 - 0.006)));
  }
  root.add(mk(plates, M.gunmetal(), 'plates'));
  return root;
}

export function buildStrut(def: PartDef): THREE.Object3D {
  const { h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('strut');
  const L = num(def, 'length', h);
  const zr = zm + d * 0.6;
  const blocks: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const b = box(0.07, 0.08, d * 0.7);
    b.translate(0, s * (L / 2 - 0.04), zm + d * 0.35);
    blocks.push(b);
    const k = sphere(0.025, 10, 8);
    k.translate(0, s * (L / 2 - 0.06), zr);
    blocks.push(k);
  }
  root.add(mk(blocks, M.gunmetal(), 'ends'));
  root.add(mk(cyl(0.014, 0.014, L - 0.14, 8, 0).translate(0, 0, zr), M.aluminium(), 'rod'));
  root.add(mk(cyl(0.022, 0.022, 0.18, 10, 0).translate(0, 0, zr), M.accent('yellow'), 'turnbuckle'));
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildMonoSphere(def: PartDef): THREE.Object3D {
  const { d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const R = num(def, 'radius', 0.24);
  const zc = zm + d - R;
  const root = grp('monoSphere');
  const s = sphere(R, 28, 18);
  s.translate(0, 0, zc);
  root.add(mk(s, M.titanium(), 'sphere'));
  const weld = torus(R * 1.002, 0.006, 6, 48);
  weld.translate(0, 0, zc);
  root.add(mk(weld, M.gunmetal()));
  const plate = box(0.28, 0.28, 0.025);
  plate.translate(0, 0, zm + 0.0125);
  const struts: THREE.BufferGeometry[] = [plate];
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    struts.push(rod([sx * 0.11, sy * 0.11, zm + 0.025], [sx * R * 0.62, sy * R * 0.62, zc - R * 0.2], 0.012, 6));
  }
  root.add(mk(struts, M.gunmetal(), 'mount'));
  const valve = cyl(0.025, 0.03, 0.05, 12, R + 0.02);
  valve.translate(0, 0, zc);
  const line = pipe([[0, R + 0.04, zc], [0, R + 0.06, zc - 0.05], [0, R * 0.5, zm + 0.04]], 0.008, 6, 16);
  root.add(mk([valve], M.chrome()));
  root.add(mk(line, M.aluminium()));
  return root;
}

export function buildMonoTorus(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const root = grp('monoTorus');
  const rMinor = Math.min(h / 2 - 0.02, r * 0.27);
  const R = r - rMinor - 0.035;
  root.add(mk(torus(R, rMinor, 16, 56), M.titanium(), 'torus'));
  root.add(mk(torus(R, rMinor * 1.02, 4, 56).scale(1, 0.05, 1), M.gunmetal()));
  const hub = cylinder(r * 0.32, r * 0.32, h - 0.04, { segments: 32 });
  root.add(mk(hub, M.darkMetal(), 'hub'));
  const flanges = [1, -1].map((s) => lathe(s > 0 ? [[r * 0.3, h / 2 - 0.02], [r, h / 2 - 0.02], [r, h / 2], [r * 0.3, h / 2]] : [[r * 0.3, -h / 2], [r, -h / 2], [r, -h / 2 + 0.02], [r * 0.3, -h / 2 + 0.02]], { segments: 48 }));
  root.add(mk(flanges, M.aluminium(), 'flanges'));
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + PI / 6;
    for (const s of [-1, 1]) spokes.push(rod([Math.sin(a) * r * 0.32, s * (h / 2 - 0.03), Math.cos(a) * r * 0.32], [Math.sin(a) * R, s * rMinor * 0.7, Math.cos(a) * R], 0.012, 6));
  }
  root.add(mk(spokes, M.gunmetal()));
  return root;
}

export function buildXenonTank(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('xenonTank');
  const rr = Math.min(d / 2 - 0.02, w / 4 - 0.01);
  const zc = zm + 0.02 + rr;
  const L = h - 0.04;
  const prof: Profile = [];
  const cylHalf = L / 2 - rr;
  for (let i = 0; i <= 8; i++) {
    const a = -PI / 2 + (i / 8) * (PI / 2);
    prof.push([rr * Math.cos(a), -cylHalf + rr * Math.sin(a)]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (PI / 2);
    prof.push([rr * Math.cos(a), cylHalf + rr * Math.sin(a)]);
  }
  prof[0] = [0, -L / 2];
  prof[prof.length - 1] = [0, L / 2];
  const bottles: THREE.BufferGeometry[] = [];
  const straps: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const b = lathe(prof, { segments: 32, tile: 0.1 });
    b.translate(sx * w / 4, 0, zc);
    bottles.push(b);
    for (const sy of [-0.22, 0.22]) {
      const s = torus(rr + 0.004, 0.008, 5, 36);
      s.translate(sx * w / 4, sy * L, zc);
      straps.push(s);
    }
  }
  root.add(mk(bottles, M.carbon(), 'bottles'));
  root.add(mk(straps, M.aluminium()));
  const plate = box(w * 0.9, h * 0.8, 0.02);
  plate.translate(0, 0, zm + 0.01);
  root.add(mk(plate, M.gunmetal()));
  const man = box(0.08, 0.05, 0.05);
  man.translate(0, L / 2 - 0.03, zc);
  const lines = [-1, 1].map((sx) => pipe([[sx * w / 4, L / 2 - 0.005, zc], [sx * w / 8, L / 2 + 0.0, zc], [0, L / 2 - 0.03, zc]], 0.008, 6, 12));
  root.add(mk([man], M.chrome()));
  root.add(mk(lines, M.aluminium()));
  return root;
}

export { merge };
