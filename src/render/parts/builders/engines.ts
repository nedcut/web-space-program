import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, bellRadius, box, cyl, grp, lathe, mk, pipe, rod, sphere, torus, type Profile } from '../geom';
import { cylDims, num, str } from './common';
import { decals } from '../decals';
import { Markings } from './markings';

const PI = Math.PI;

interface BellOpts {
  rt: number;
  re: number;
  len: number;
  k: number;
  /** Fraction (0..1 from throat) where a radiatively cooled extension starts; 1 = none. */
  extStart?: number;
  outer?: THREE.Material;
  ext?: THREE.Material;
  segments?: number;
  rings?: number;
  /** Stiffener hat-bands at these fractions. */
  bands?: number[];
}

/** Nozzle bell: throat at y=0, exit at y=-len. Outer skin, dark interior, rolled lip. */
function bell(o: BellOpts): THREE.Group {
  const g = grp('bell');
  const seg = o.segments ?? 48;
  const rings = o.rings ?? 14;
  const ext = o.extStart ?? 1;
  const pts = (s0: number, s1: number): Profile => {
    const p: Profile = [];
    const n = Math.max(3, Math.round(rings * (s1 - s0)));
    for (let i = n; i >= 0; i--) {
      const s = s0 + ((s1 - s0) * i) / n;
      p.push([bellRadius(s, o.rt, o.re, o.k), -s * o.len]);
    }
    return p;
  };
  const tile = Math.max(0.3, o.len * 0.5);
  g.add(mk(lathe(pts(0, ext), { segments: seg, uRepeat: Math.max(6, Math.round(o.re * 12)), tile }), o.outer ?? M.copperTubes(), 'bellOuter'));
  if (ext < 1) {
    const extension = lathe(pts(ext, 1), { segments: seg, uRepeat: 1 });
    const uv = extension.getAttribute('uv');
    const pos = extension.getAttribute('position');
    // One axial temper ramp, irrespective of nozzle slope/arc length (no repeated rainbow bands).
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.002 + 0.996 * (pos.getY(i) + o.len) / (o.len * (1 - ext)));
    g.add(mk(extension, o.ext ?? M.nozzleExt(), 'nozzleExtension'));
    const rr = bellRadius(ext, o.rt, o.re, o.k);
    g.add(mk(torus(rr + 0.004, 0.012 + rr * 0.025, 6, seg).translate(0, -ext * o.len, 0), M.gunmetal(), 'extFlange'));
  }
  const innerPts = (): Profile => {
    const p: Profile = [];
    const n = Math.max(4, Math.round(rings * 0.6));
    for (let i = n; i >= 0; i--) {
      const s = i / n;
      p.push([bellRadius(s, o.rt, o.re, o.k) * 0.995, -s * o.len]);
    }
    return p;
  };
  g.add(mk(lathe(innerPts(), { segments: Math.max(16, Math.round(seg * 0.6)), uRepeat: 4, tile: 1 }), M.bellInterior(), 'bellInner'));
  const lipR = 0.008 + o.re * 0.012;
  g.add(mk(torus(o.re, lipR, 4, seg).translate(0, -o.len + lipR, 0), M.gunmetal(), 'lip'));
  if (o.bands?.length) {
    const b = o.bands.map((s) => torus(bellRadius(s, o.rt, o.re, o.k) + 0.003, 0.006 + o.re * 0.01, 3, seg).translate(0, -s * o.len, 0));
    g.add(mk(b, M.gunmetal(), 'hatBands'));
  }
  return g;
}

/** Combustion chamber: throat at y=0, injector dome on top at y=len. */
function chamber(rc: number, rt: number, len: number, mat: THREE.Material, seg = 28): THREE.Mesh {
  const p: Profile = [
    [rt, 0],
    [rt * 1.08, len * 0.06],
    [rc * 0.85, len * 0.3],
    [rc, len * 0.42],
    [rc, len * 0.86],
    [rc, len * 0.86],
    [rc * 1.06, len * 0.88],
    [rc * 1.06, len * 0.94],
    [rc * 0.7, len * 0.98],
    [rc * 0.4, len * 1.02],
    [0, len * 1.04],
  ];
  return mk(lathe(p, { segments: seg, uRepeat: 4, tile: len }), mat, 'chamber');
}

/** Turbopump: vertical shaft housing with a volute and turbine. Origin at shaft centre. */
function turbopump(s: number, housing: THREE.Material, volute: THREE.Material, seg = 12): THREE.Group {
  const g = grp('turbopump');
  g.add(mk([cyl(0.1 * s, 0.11 * s, 0.32 * s, seg), cyl(0.13 * s, 0.13 * s, 0.03 * s, seg, 0.17 * s)], housing));
  g.add(mk([torus(0.14 * s, 0.06 * s, 6, Math.round(seg * 1.5)).translate(0, 0.06 * s, 0), cyl(0.07 * s, 0.09 * s, 0.1 * s, 12, -0.2 * s)], volute));
  g.add(mk(around(box(0.02 * s, 0.24 * s, 0.03 * s).translate(0, 0, 0.11 * s), 6, 0), M.darkMetal()));
  return g;
}

function exhaustAnchor(y: number, exitRadius: number): THREE.Object3D {
  const a = new THREE.Object3D();
  a.name = 'exhaustAnchor';
  a.position.set(0, y, 0);
  a.userData.exitRadius = exitRadius;
  return a;
}

function mountPlate(r: number, yTop: number, t: number, seg = 44): THREE.Group {
  const g = grp('mount');
  g.add(
    mk(
      lathe(
        [
          [0, yTop - t],
          [r * 0.96, yTop - t],
          [r, yTop - t + 0.006],
          [r, yTop - 0.006],
          [r * 0.97, yTop],
          [r * 0.97, yTop],
          [0, yTop - 0.004],
        ],
        { segments: seg },
      ),
      M.gunmetal(),
    ),
  );
  const b = cyl(0.008 + 0.005 * r, 0.008 + 0.005 * r, 0.012, 6);
  b.rotateX(PI / 2);
  g.add(mk(around(b, Math.round(10 * r + 8), r, 0, yTop - t / 2), M.chrome()));
  return g;
}

/** Thrust truss: n struts from an upper ring to the gimbal block. */
function truss(rTop: number, yTop: number, rBot: number, yBot: number, n: number, rr: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * PI * 2;
    const a1 = ((i + 0.5) / n) * PI * 2;
    out.push(rod([rTop * Math.sin(a0), yTop, rTop * Math.cos(a0)], [rBot * Math.sin(a1), yBot, rBot * Math.cos(a1)], rr, 6));
    out.push(rod([rTop * Math.sin(a0 + PI / n), yTop, rTop * Math.cos(a0 + PI / n)], [rBot * Math.sin(a1), yBot, rBot * Math.cos(a1)], rr, 6));
  }
  return out;
}

/** Gas-generator exhaust duct hugging the bell; returns geometry list in gimbal space. */
function ggExhaust(rt: number, re: number, k: number, yThroat: number, len: number, side: number, pr: number, startY: number, startX: number): THREE.BufferGeometry[] {
  const pts: [number, number, number][] = [[startX * side, startY, 0]];
  for (const s of [0.1, 0.35, 0.6, 0.82]) {
    const x = bellRadius(s, rt, re, k) + pr * 1.6;
    pts.push([x * side, yThroat - s * len, 0]);
  }
  const g = [pipe(pts, pr, 6, 24)];
  const last = pts[pts.length - 1];
  const out = lathe([[pr * 1.6, -0.12 * len], [pr * 1.05, 0]], { segments: 12 });
  out.translate(last[0], last[1], 0);
  g.push(out);
  return g;
}

// ---------------------------------------------------------------------------------------------

export function buildEngine(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const style = str(def, 'style', 'lifter');
  const re = num(def, 'exitRadius', r * 0.8);
  const yT = h / 2;
  const yB = -h / 2;
  const root = grp('engine');

  if (style === 'cluster') return buildCluster(def, root, r, h, re, Math.round(num(def, 'bells', 4)));

  let plateT = Math.min(0.08, 0.04 + 0.03 * r);
  let yG: number; // gimbal pivot (part frame)
  let rc: number;
  let chamberLen: number;
  let k: number;
  let extStart = 1;
  let outerMat: THREE.Material = M.copperTubes();
  let chamberMat: THREE.Material = M.copperTubes();
  const bands: number[] = [];

  switch (style) {
    case 'compact':
      yG = yT - h * 0.36;
      rc = re * 0.42;
      chamberLen = h * 0.16;
      k = 1.7;
      break;
    case 'vacuum':
      yG = yT - h * 0.14;
      rc = re * 0.2;
      chamberLen = h * 0.11;
      k = 2.6;
      extStart = 0.32;
      break;
    case 'lander':
      plateT = 0.05;
      yG = yT - h * 0.3;
      rc = re * 0.32;
      chamberLen = h * 0.12;
      k = 1.5;
      break;
    case 'fullflow':
      yG = yT - h * 0.17;
      rc = re * 0.34;
      chamberLen = h * 0.2;
      k = 1.8;
      outerMat = M.steelTubes();
      chamberMat = M.steelTubes();
      bands.push(0.55, 0.82);
      break;
    case 'hydrolox':
      yG = yT - h * 0.13;
      rc = re * 0.2;
      chamberLen = h * 0.13;
      k = 2.4;
      extStart = 0.3;
      bands.push(0.5, 0.7, 0.88);
      break;
    default: // lifter
      yG = yT - h * 0.2;
      rc = re * 0.4;
      chamberLen = h * 0.2;
      k = 1.9;
  }
  const rt = rc * 0.55;

  root.add(mountPlate(r, yT, plateT));
  const yPlateBottom = yT - plateT;

  // static thrust structure between plate and gimbal
  const fixed: THREE.BufferGeometry[] = [];
  let skirtSpan: [number, number] | null = null;
  if (style === 'lifter' || style === 'compact') {
    // short shroud skirt with an underside annulus
    const ySk = style === 'compact' ? yG - h * 0.02 : yPlateBottom - h * 0.07;
    root.add(
      mk(
        lathe([[r * 0.45, ySk], [r * 0.9, ySk], [r * 0.9, ySk], [r * 0.99, yPlateBottom]], { segments: 48, tile: 0.8 }),
        M.scorched(),
        'skirt',
      ),
    );
    skirtSpan = [ySk, yPlateBottom];
    fixed.push(...truss(r * 0.5, ySk, re * 0.16, yG + 0.01, 4, 0.012 + 0.012 * r));
  } else if (style === 'vacuum' || style === 'hydrolox') {
    fixed.push(...truss(r * 0.82, yPlateBottom, Math.max(rt, rc * 0.6), yG + 0.01, 4, 0.01 + 0.01 * r));
  } else if (style === 'fullflow') {
    root.add(mk(lathe([[re * 0.22, yG + 0.02], [r * 0.6, yPlateBottom]], { segments: 40 }), M.steel(), 'thrustPuck'));
  } else if (style === 'lander') {
    // foil-wrapped equipment drum and pressurant spheres
    root.add(mk(lathe([[r * 0.55, yG + 0.01], [r * 0.62, yPlateBottom]], { segments: 40, tile: 0.5 }), M.goldFoil(), 'foilDrum'));
    const sph: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + (i * PI) / 2;
      const s = sphere(r * 0.17, 16, 12);
      s.translate(Math.sin(a) * r * 0.74, yPlateBottom - r * 0.18, Math.cos(a) * r * 0.74);
      sph.push(s);
    }
    root.add(mk(sph, M.titanium(), 'pressurant'));
  }
  if (fixed.length) root.add(mk(fixed, M.gunmetal(), 'thrustStructure'));

  // gimballed assembly
  const gim = grp('gimbal');
  gim.position.set(0, yG, 0);
  root.add(gim);
  const yThroat = -0.03 * h - chamberLen; // gimbal-local
  const yExit = yB - yG;
  const bellLen = yThroat - yExit;
  gim.add(mk([cyl(rc * 0.55, rc * 0.7, 0.03 * h + 0.01, 16, -0.015 * h), sphere(rc * 0.35, 12, 8)], M.darkMetal(), 'gimbalBlock'));
  const ch = chamber(rc, rt, chamberLen, chamberMat);
  ch.position.y = yThroat;
  gim.add(ch);
  const b = bell({ rt, re, len: bellLen, k, extStart, outer: outerMat, bands, segments: re > 0.8 ? 40 : 36 });
  b.position.y = yThroat;
  gim.add(b);
  gim.add(exhaustAnchor(yExit, re));

  // plumbing
  const s = Math.max(0.35, re * 1.1);
  const pipeMat = style === 'fullflow' ? M.steel() : M.aluminium();
  const yPump = yThroat + chamberLen * 0.7;
  const pumpX = rc + 0.16 * s;
  if (style === 'fullflow') {
    for (const side of [-1, 1]) {
      const tp = turbopump(s * 1.1, M.steel(), M.steel());
      tp.position.set(pumpX * side, yPump, 0);
      gim.add(tp);
      gim.add(mk(pipe([[pumpX * side, yPump + 0.12 * s, 0], [pumpX * side * 0.8, yThroat + chamberLen * 1.05, 0.05 * s], [0, yThroat + chamberLen * 0.95, rc * 0.4]], 0.04 * s, 8, 16), pipeMat));
      gim.add(mk(pipe([[pumpX * side, yPump - 0.2 * s, 0], [pumpX * side * 0.9, yThroat + chamberLen * 0.3, 0], [rc * side, yThroat + chamberLen * 0.5, 0]], 0.035 * s, 8, 16), pipeMat));
    }
    gim.add(mk(torus(rc * 1.12, 0.05 * s, 8, 24).translate(0, yThroat + chamberLen * 0.9, 0), M.steel(), 'hotGasManifold'));
  } else if (style === 'hydrolox') {
    const lh2 = turbopump(s * 0.9, M.satinWhite(), M.satinWhite());
    lh2.position.set(pumpX, yPump, 0);
    gim.add(lh2);
    const lox = turbopump(s * 0.7, M.gunmetal(), M.aluminium());
    lox.position.set(-pumpX * 0.9, yPump, 0.05 * s);
    gim.add(lox);
    gim.add(mk(pipe([[pumpX, yPump + 0.14 * s, 0], [pumpX * 0.7, -0.01, 0.1 * s], [rc * 0.4, yThroat + chamberLen, 0]], 0.05 * s, 8, 16), M.satinWhite(), 'lh2Line'));
    gim.add(mk(pipe([[pumpX, yPump - 0.18 * s, 0], [rc * 1.4, yThroat + 0.05, 0], [rt * 1.3, yThroat - 0.03 * bellLen, 0]], 0.035 * s, 8, 24), M.satinWhite()));
    gim.add(mk(pipe([[-pumpX * 0.9, yPump + 0.12 * s, 0.05 * s], [-rc * 0.8, -0.02, 0], [-rc * 0.3, yThroat + chamberLen, 0]], 0.035 * s, 8, 24), pipeMat));
    gim.add(mk(torus(rt * 1.3, 0.025 * s, 8, 24).translate(0, yThroat - 0.03 * bellLen, 0), M.aluminium(), 'coolantManifold'));
  } else {
    const tp = turbopump(s * (style === 'vacuum' ? 0.6 : style === 'lander' ? 0.55 : 0.8), M.gunmetal(), M.aluminium());
    tp.position.set(pumpX, yPump, 0);
    gim.add(tp);
    gim.add(mk(pipe([[pumpX, yPump + 0.12 * s, 0], [pumpX * 0.6, yThroat + chamberLen * 1.1, 0.04 * s], [0, yThroat + chamberLen * 1.02, 0]], 0.03 * s, 8, 20), pipeMat));
    gim.add(mk(pipe([[pumpX, yPump - 0.12 * s, 0.02 * s], [pumpX * 0.8, yThroat + 0.02, rc * 0.8], [rt * 1.2, yThroat - 0.02 * bellLen, rt]], 0.025 * s, 8, 20), pipeMat));
    gim.add(mk(torus(rt * 1.25, 0.02 * s, 6, 24).translate(0, yThroat - 0.02 * bellLen, 0), M.aluminium()));
    if (style === 'lifter') {
      gim.add(mk(ggExhaust(rt, re, k, yThroat, bellLen, 1, 0.045 * s, yPump - 0.22 * s, pumpX), M.soot(), 'ggExhaust'));
    }
  }
  // main propellant feed ducts from the mount, with flanges and bellows
  if (style !== 'lander') {
    const ducts: THREE.BufferGeometry[] = [];
    const rings: THREE.BufferGeometry[] = [];
    const dr = 0.045 * s * (style === 'vacuum' ? 0.7 : 1);
    const yTopLocal = yPlateBottom - yG;
    const targets: [number, number, number][] = [
      [pumpX, yPump + 0.2 * s, 0],
      [-rc * 0.9, yThroat + chamberLen * 1.0, -rc * 0.4],
    ];
    const starts: [number, number, number][] = [
      [r * 0.42, yTopLocal, r * 0.12],
      [-r * 0.42, yTopLocal, -r * 0.12],
    ];
    for (let i = 0; i < 2; i++) {
      const a = starts[i];
      const b = targets[i];
      const mid: [number, number, number] = [(a[0] + b[0]) / 2, a[1] + (b[1] - a[1]) * 0.55, (a[2] + b[2]) / 2];
      ducts.push(pipe([a, mid, b], dr, 8, 14));
      for (const t of [0.02, 0.35, 0.4, 0.45]) {
        const p = new THREE.Vector3(...a).lerp(new THREE.Vector3(...mid), t * 2 > 1 ? 1 : t * 2);
        rings.push(torus(dr * 1.15, dr * 0.22, 3, 10).translate(p.x, p.y, p.z));
      }
    }
    gim.add(mk(ducts, style === 'hydrolox' ? M.satinWhite() : M.aluminium(), 'feedDucts'));
    gim.add(mk(rings, M.gunmetal()));
  }
  // thermal blanket under the mount plate
  root.add(mk(lathe([[r * 0.25, yPlateBottom - 0.004], [r * 0.93, yPlateBottom - 0.004]], { segments: 40, tile: 0.4 }), style === 'fullflow' ? M.silverFoil() : M.goldFoil(), 'thermalBlanket'));
  // gimbal actuators (two, 90 degrees apart)
  const act: THREE.BufferGeometry[] = [];
  const actChrome: THREE.BufferGeometry[] = [];
  for (const a of [PI / 2 + PI / 4, PI + PI / 4]) {
    const top: [number, number, number] = [Math.sin(a) * r * 0.62, yPlateBottom - yG - 0.01, Math.cos(a) * r * 0.62];
    const bot: [number, number, number] = [Math.sin(a) * (rc * 1.05), yThroat + chamberLen * 0.5, Math.cos(a) * (rc * 1.05)];
    const mid: [number, number, number] = [(top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2];
    act.push(rod(top, mid, 0.025 * s, 8));
    actChrome.push(rod(mid, bot, 0.014 * s, 8));
  }
  gim.add(mk(act, M.darkMetal(), 'actuators'));
  gim.add(mk(actChrome, M.chrome()));
  engineMarkings(def, root, r, yT, plateT, skirtSpan);
  return root;
}

/** Maker's mark and data plate on the mount ring (and on the boat-tail skirt when present). */
function engineMarkings(def: PartDef, root: THREE.Object3D, r: number, yT: number, plateT: number, skirt: [number, number] | null) {
  const D = new Markings(def);
  const hRim = plateT - 0.014;
  if (hRim > 0.02) {
    const pl = D.plateDark;
    D.cyl(r, pl, { y: yT - plateT / 2, phi: PI * 0.25, height: Markings.fit(pl, hRim * 0.85, r * 0.8) });
    D.cyl(r, decals.logo(D.livery.id, '#e9e7e1'), { y: yT - plateT / 2, phi: -PI * 0.25, height: hRim * 0.85 });
  }
  if (skirt) {
    const [y0, y1] = skirt;
    const rOf = (y: number) => r * 0.9 + ((r * 0.99 - r * 0.9) * (y - y0)) / (y1 - y0);
    const b = D.badgeDark;
    const hb = Markings.fit(b, (y1 - y0) * 0.45, r * 1.1);
    for (const a of [0, PI]) D.lathe(rOf, b, { y: (y0 + y1) / 2, phi: a + PI / 2, height: hb });
  }
  D.addTo(root);
}

function buildCluster(def: PartDef, root: THREE.Group, r: number, h: number, re: number, n: number): THREE.Object3D {
  const yT = h / 2;
  const yB = -h / 2;
  const plateT = 0.1;
  root.add(mountPlate(r, yT, plateT, 48));
  const ySk = yT - h * 0.22;
  root.add(
    mk(
      lathe([[r * 0.3, ySk], [r * 0.9, ySk], [r * 0.9, ySk], [r * 0.99, yT - plateT]], { segments: 64, tile: 1 }),
      M.scorched(),
      'skirt',
    ),
  );
  const beams: THREE.BufferGeometry[] = [];
  for (const a of [PI / 4, -PI / 4]) {
    const b = box(r * 1.6, 0.12, 0.12);
    b.rotateY(a);
    b.translate(0, ySk - 0.06, 0);
    beams.push(b);
  }
  root.add(mk(beams, M.gunmetal(), 'thrustBeams'));
  engineMarkings(def, root, r, yT, plateT, [ySk, yT - plateT]);
  const d = r - re - 0.1;
  const yG = ySk - 0.12;
  const rc = re * 0.4;
  const rt = rc * 0.55;
  const chamberLen = h * 0.15;
  const k = 1.9;
  for (let i = 0; i < n; i++) {
    const a = PI / 4 + (i / n) * PI * 2;
    const gim = grp('gimbal');
    gim.position.set(Math.sin(a) * d, yG, Math.cos(a) * d);
    root.add(gim);
    const inner = grp();
    inner.rotation.y = a + PI; // turbopump faces outboard
    gim.add(inner);
    const yThroat = -0.02 * h - chamberLen;
    const yExit = yB - yG;
    const bellLen = yThroat - yExit;
    inner.add(mk(cyl(rc * 0.5, rc * 0.65, 0.04, 10, -0.02), M.darkMetal()));
    const ch = chamber(rc, rt, chamberLen, M.copperTubes(), 18);
    ch.position.y = yThroat;
    inner.add(ch);
    const bl = bell({ rt, re, len: bellLen, k, segments: num(def, 'nozzleSegments', 26), rings: num(def, 'nozzleRings', 9) });
    bl.position.y = yThroat;
    inner.add(bl);
    inner.add(exhaustAnchor(yExit, re));
    const s = re;
    const tp = turbopump(s * 0.7, M.gunmetal(), M.aluminium(), 8);
    // pump on the outboard side
    tp.position.set(0, yThroat + chamberLen * 0.6, -(rc + 0.12 * s));
    inner.add(tp);
    inner.add(mk(pipe([[0, yThroat + chamberLen * 0.6 + 0.1 * s, -(rc + 0.12 * s)], [0, yThroat + chamberLen * 1.05, -rc * 0.5], [0, yThroat + chamberLen, 0]], 0.03 * s, 6, 10), M.aluminium()));
    inner.add(mk(ggExhaust(rt, re, k, yThroat, bellLen, 1, 0.04 * s, yThroat + chamberLen * 0.6 - 0.18 * s, rc + 0.12 * s).map((g) => g.rotateY(PI / 2)), M.soot()));
  }
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildSrb(def: PartDef): THREE.Object3D {
  const { rTop: r, h } = cylDims(def);
  const nl = num(def, 'nozzleLength', h * 0.08);
  const re = num(def, 'exitRadius', r * 0.6);
  const segs = Math.max(1, Math.round(num(def, 'segments', 2)));
  const root = grp('srb');
  const yT = h / 2;
  const yB = -h / 2;
  const rb = r * 0.95;
  const fwd = Math.min(0.12 * h, 0.5 + r * 0.2);
  const aft = Math.min(0.1 * h, 0.4 + r * 0.25);
  const yAftTop = yB + nl + aft;
  const yFwdBot = yT - fwd;
  const seg = r > 1 ? 64 : 48;

  // casing
  root.add(mk(lathe([[rb, yAftTop], [rb, yFwdBot]], { segments: seg, tile: 1, vOffset: 0.2 }), M.satinWhite(), 'casing'));
  // forward skirt with a rounded shoulder and flat top
  root.add(
    mk(
      lathe(
        [
          [rb, yFwdBot],
          [r * 0.97, yFwdBot + fwd * 0.08],
          [r * 0.97, yT - fwd * 0.18],
          [r * 0.94, yT - 0.02],
          [r * 0.9, yT],
          [r * 0.9, yT],
          [0, yT],
        ],
        { segments: seg, tile: 0.8 },
      ),
      M.charcoalPanel(),
      'forwardSkirt',
    ),
  );
  // aft skirt flaring to full radius
  root.add(
    mk(
      lathe(
        [
          [r * 0.7, yB + nl],
          [r, yB + nl],
          [r, yB + nl],
          [r, yB + nl + aft * 0.12],
          [rb, yAftTop],
        ],
        { segments: seg, tile: 0.8 },
      ),
      M.scorched(),
      'aftSkirt',
    ),
  );
  // segment joints and livery band
  const joints: THREE.BufferGeometry[] = [];
  for (let i = 1; i < segs; i++) {
    const y = yAftTop + ((yFwdBot - yAftTop) * i) / segs;
    joints.push(lathe([[rb, y - 0.05 - 0.02 * r], [r * 0.975, y - 0.03], [r * 0.975, y + 0.03], [rb, y + 0.05 + 0.02 * r]], { segments: seg }));
  }
  if (joints.length) root.add(mk(joints, M.gunmetal(), 'joints'));
  const bandH = 0.12 + 0.08 * r;
  root.add(mk(lathe([[rb + 0.003, yFwdBot - bandH * 1.5], [rb + 0.003, yFwdBot - bandH * 0.5]], { segments: seg }), M.accent('red'), 'band'));
  // nozzle (fixed), partly recessed into the aft skirt
  const rt = re * 0.42;
  const nozLen = nl + aft * 0.55;
  const noz = grp('nozzle');
  noz.position.y = yB + nozLen;
  noz.add(mk(lathe([[rt * 1.6, 0.06], [rt * 1.2, 0.0]], { segments: 32 }), M.gunmetal()));
  const bl = bell({ rt, re, len: nozLen, k: 1.6, outer: M.gunmetal(), segments: 40, rings: 10 });
  noz.add(bl);
  noz.add(mk(lathe([[r * 0.7, 0.07], [0, 0.07]], { segments: 32 }), M.soot()));
  noz.add(exhaustAnchor(-nozLen, re));
  root.add(noz);

  // raceway, attach lugs, separation motors
  const det: THREE.BufferGeometry[] = [];
  const race = box(0.06 + 0.06 * r, yFwdBot - yAftTop - 0.1, 0.04 + 0.02 * r);
  race.translate(0, (yFwdBot + yAftTop) / 2, rb + 0.015);
  race.rotateY(PI / 2);
  det.push(race);
  for (const y of [yFwdBot - 0.1, yAftTop + 0.12]) {
    const lug = box(0.12 + 0.1 * r, 0.1 + 0.04 * r, 0.06);
    lug.translate(0, y, -(rb + 0.02));
    det.push(lug);
  }
  root.add(mk(det, M.gunmetal(), 'raceway'));
  const motors: THREE.BufferGeometry[] = [];
  for (const [y, dir] of [[yT - fwd * 0.5, 1], [yB + nl + aft * 0.5, -1]] as const) {
    for (const dx of [-1, 0, 1]) {
      const m = cyl(0.025 + 0.015 * r, 0.03 + 0.02 * r, 0.12 + 0.06 * r, 10);
      m.rotateX(PI / 2 - dir * 0.5);
      m.translate(dx * (0.07 + 0.05 * r), y, r * 0.98);
      motors.push(m);
    }
  }
  root.add(mk(motors, M.darkMetal(), 'sepMotors'));
  // markings: maker's badge up the casing, insignia, data plate and ordnance warnings
  const D = new Markings(def);
  const span = yFwdBot - yAftTop - bandH * 2;
  const rd = rb;
  const b = D.badge;
  const hb = Markings.fit(b, 0.1 + 0.12 * r, span * 0.5);
  D.cyl(rd, b, { y: yAftTop + span * 0.45, phi: -PI / 2, height: hb, vertical: true });
  D.cyl(rd, D.plate, { y: yAftTop + 0.12 + 0.03 * r, phi: PI * 0.75, height: 0.045 + 0.03 * r });
  if (span > 1) D.cyl(rd, decals.insignia(), { y: yFwdBot - bandH * 2 - 0.25 * r, phi: PI * 0.25, height: 0.15 + 0.2 * r });
  const warn = decals.text('LIVE MOTOR', { color: '#f2f1ec', plate: '#b3261e', stencil: true });
  const warnSym = decals.symbol('warn');
  for (const a of [PI * 0.25, PI * 1.25]) {
    D.cyl(rd, warn, { y: yAftTop + 0.1 + 0.05 * r, phi: a, height: 0.035 + 0.025 * r });
    D.cyl(rd, warnSym, { y: yAftTop + 0.22 + 0.11 * r, phi: a, height: 0.06 + 0.03 * r });
  }
  D.addTo(root);
  return root;
}

// ---------------------------------------------------------------------------------------------

export function buildIonEngine(def: PartDef): THREE.Object3D {
  const { rTop: r, rBot, h } = cylDims(def);
  const re = num(def, 'exitRadius', rBot * 0.9);
  const root = grp('ionEngine');
  const yT = h / 2;
  const yB = -h / 2;
  root.add(mountPlate(r, yT, 0.04, 40));
  const bodyTop = yT - 0.04;
  const bodyBot = yB + h * 0.22;
  root.add(mk(lathe([[r * 0.92, bodyBot], [r * 0.92, bodyTop]], { segments: 40, tile: 0.4 }), M.goldFoil(), 'body'));
  root.add(mk([torus(r * 0.93, 0.012, 6, 40).translate(0, bodyTop - h * 0.2, 0), torus(r * 0.93, 0.012, 6, 40).translate(0, bodyBot + h * 0.15, 0)], M.aluminium(), 'magnetRings'));
  // discharge chamber lip and grid
  const lip: Profile = [
    [r * 0.92, bodyBot],
    [rBot, bodyBot - 0.01],
    [rBot, yB + 0.01],
    [rBot * 0.97, yB],
    [rBot * 0.97, yB],
    [re, yB],
    [re, yB],
    [re, yB + 0.03],
  ];
  root.add(mk(lathe(lip, { segments: 48 }), M.gunmetal(), 'gridHousing'));
  const grid = new THREE.CircleGeometry(re, 48);
  grid.rotateX(PI / 2);
  grid.translate(0, yB + 0.03, 0);
  root.add(mk(grid, M.ionGrid(), 'ionGrid'));
  // neutraliser cathode
  const cath = grp('neutraliser');
  cath.add(mk(rod([rBot * 0.9, bodyBot, 0], [rBot * 1.0, yB + 0.02, 0], 0.015, 8), M.aluminium()));
  cath.add(mk(sphere(0.018, 10, 8).translate(rBot * 1.0, yB + 0.015, 0), M.statusLed('teal')));
  root.add(cath);
  root.add(exhaustAnchor(yB + 0.03, re));
  const g = root.getObjectByName('exhaustAnchor')!;
  g.userData.exitRadius = re;
  return root;
}
