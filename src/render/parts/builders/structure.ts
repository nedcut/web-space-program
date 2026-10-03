import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, box, cyl, cylinder, grp, lathe, merge, mk, pipe, rod, sphere, torus, type Profile } from '../geom';
import { boxDims, cylDims, num, srfMount, str } from './common';

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

export function buildTank(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const finish = str(def, 'finish', 'white');
  const root = grp('tank');
  const band = Math.min(0.05 + 0.05 * r, h * 0.12);
  const rb = r * 0.992;
  const bodyMat = finish === 'orange' ? M.orangeFoam() : finish === 'steel' ? M.steel() : finish === 'charcoal' ? M.charcoalPanel() : M.whitePanel();
  const bandMat = finish === 'orange' ? M.aluminium() : finish === 'steel' ? M.gunmetal() : M.gunmetal();
  const tile = finish === 'orange' ? 1.5 : finish === 'steel' ? 1.2 : 1;
  const seg = r > 1 ? 64 : 48;

  root.add(mk(lathe([[rb, -h / 2 + band], [rb, h / 2 - band]], { segments: seg, tile, vOffset: 0.5 * tile }), bodyMat, 'body'));
  // end frames
  const ring = (y0: number, y1: number, top: boolean): Profile => {
    const yEdge = top ? y1 : y0;
    const yIn = top ? y0 : y1;
    const pts: Profile = [
      [rb, yIn],
      [r, yIn + (top ? 0.004 : -0.004)],
      [r, yEdge + (top ? -0.012 : 0.012)],
      [r * 0.985, yEdge],
    ];
    return top ? pts : pts.reverse();
  };
  root.add(mk([lathe(ring(h / 2 - band, h / 2, true), { segments: seg }), lathe(ring(-h / 2, -h / 2 + band, false), { segments: seg })], bandMat, 'frames'));
  root.add(mk([bulkhead(r * 0.985, h / 2, 1, seg), bulkhead(r * 0.985, -h / 2, -1, seg)], M.darkMetal(), 'bulkheads'));

  // fasteners on the frames
  const nb = Math.round(14 * r + 8);
  root.add(mk([...boltRing(r, h / 2 - band * 0.5, nb, 0.008 + 0.004 * r), ...boltRing(r, -h / 2 + band * 0.5, nb, 0.008 + 0.004 * r)], M.chrome(), 'bolts'));

  const details: THREE.BufferGeometry[] = [];
  const bodyLen = h - band * 2;
  if (finish === 'white') {
    const livery: THREE.BufferGeometry[] = [];
    const lr = r * 0.9945;
    if (h / r > 3.5) {
      // roll-pattern quadrants
      const y1 = h / 2 - band - 0.05;
      const y0 = y1 - bodyLen * 0.28;
      livery.push(lathe([[lr, y0], [lr, y1]], { segments: 12, phiStart: 0, phiLength: PI / 2, vOffset: 0.5 }));
      livery.push(lathe([[lr, y0], [lr, y1]], { segments: 12, phiStart: PI, phiLength: PI / 2, vOffset: 0.5 }));
      const z1 = -h / 2 + band + 0.05 + bodyLen * 0.12;
      const z0 = -h / 2 + band + 0.05;
      livery.push(lathe([[lr, z0], [lr, z1]], { segments: 12, phiStart: PI / 2, phiLength: PI / 2, vOffset: 0.5 }));
      livery.push(lathe([[lr, z0], [lr, z1]], { segments: 12, phiStart: (3 * PI) / 2, phiLength: PI / 2, vOffset: 0.5 }));
    } else {
      const y = h / 2 - band - 0.04 - r * 0.06;
      for (const dy of [0, -0.06 - r * 0.04]) livery.push(lathe([[lr, y + dy - 0.015 - r * 0.01], [lr, y + dy]], { segments: seg }));
    }
    root.add(mk(livery, M.charcoalPanel(), 'livery'));
    if (r >= 0.6) {
      const rw = box(0.07 * r + 0.03, bodyLen - 0.04, 0.03);
      rw.translate(0, 0, rb + 0.012);
      rw.rotateY(PI * 0.75);
      details.push(rw);
    }
  } else if (finish === 'orange') {
    // cable raceway and an insulated propellant feedline
    const rw = box(0.12 * r, bodyLen, 0.05);
    rw.translate(0, 0, rb + 0.02);
    details.push(rw);
    const pr = 0.045 * r;
    const feed = cyl(pr, pr, h - 0.02, 12);
    feed.translate(r + pr * 0.4, 0, 0);
    const brackets = [-0.35, 0, 0.35].map((f) => {
      const b = box(pr * 3.2, 0.04, pr * 2);
      b.translate(r - pr * 0.4, f * h, 0);
      return b;
    });
    root.add(mk(feed, M.orangeFoam(), 'feedline'));
    root.add(mk(brackets, M.aluminium()));
  } else if (finish === 'steel') {
    const pr = 0.04 * r;
    const conduit = cyl(pr, pr, h - band * 2, 10);
    conduit.translate(0, 0, r + pr * 0.3);
    details.push(conduit);
    const chine = box(0.05, bodyLen * 0.9, 0.02);
    chine.translate(0, 0, rb + 0.008);
    chine.rotateY(PI);
    details.push(chine);
  }
  if (details.length) root.add(mk(details, finish === 'steel' ? M.steel() : M.gunmetal(), 'details'));
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildAdapter(def: PartDef): THREE.Object3D {
  const { rTop, rBot, h } = cylDims(def);
  const root = grp('adapter');
  const f = 0.035;
  root.add(mk(lathe([[rBot * 0.995, -h / 2 + f], [rTop * 0.995, h / 2 - f]], { segments: 56, tile: 0.8 }), M.charcoalPanel(), 'body'));
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
  root.add(mk(lathe([[ry(t0) * 0.999 + 0.002, -h / 2 + h * t0], [ry(t1) * 0.999 + 0.002, -h / 2 + h * t1]], { segments: 56 }), M.satinWhite(), 'stripe'));
  root.add(mk([bulkhead(rTop * 0.98, h / 2, 1), bulkhead(rBot * 0.98, -h / 2, -1)], M.darkMetal()));
  root.add(mk([...boltRing(rTop, h / 2 - f / 2, Math.round(20 * rTop + 8), 0.009), ...boltRing(rBot, -h / 2 + f / 2, Math.round(20 * rBot + 8), 0.009)], M.chrome()));
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
    shell.add(half);
  }
  root.add(shell);
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildDecoupler(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const root = grp('decoupler');
  const fl = h * 0.3;
  const seg = 56;
  root.add(
    mk(
      [
        lathe([[r * 0.98, -h / 2], [r, -h / 2 + 0.005], [r, -h / 2 + fl], [r * 0.955, -h / 2 + fl]], { segments: seg }),
        lathe([[r * 0.955, h / 2 - fl], [r, h / 2 - fl], [r, h / 2 - 0.005], [r * 0.98, h / 2]], { segments: seg }),
      ],
      M.aluminium(),
      'flanges',
    ),
  );
  root.add(mk(lathe([[r * 0.955, -h / 2 + fl], [r * 0.955, h / 2 - fl]], { segments: seg, tile: 0.25 }), M.hazard(), 'hazardBand'));
  root.add(mk([bulkhead(r * 0.98, h / 2, 1), bulkhead(r * 0.98, -h / 2, -1)], M.darkMetal()));
  const nb = Math.round(16 * r + 8);
  const bs = 0.01 + 0.006 * r;
  root.add(mk([...boltRing(r, h / 2 - fl / 2, nb, bs), ...boltRing(r, -h / 2 + fl / 2, nb, bs)], M.chrome(), 'bolts'));
  // pyro boxes on the band
  const pb = box(0.05 + 0.03 * r, h - fl * 2 - 0.01, 0.03);
  root.add(mk(around(pb.translate(0, 0, r * 0.955 + 0.012), 4, 0, PI / 4), M.darkMetal(), 'pyros'));
  return root;
}

export function buildSeparator(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const root = grp('separator');
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
  const pb = box(0.06 + 0.02 * r, g * 2.6, 0.035);
  pb.translate(0, 0, r + 0.005);
  root.add(mk(around(pb, 6, 0, PI / 6), M.accent('red'), 'pyros'));
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
