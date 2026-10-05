import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, box, cyl, grp, lathe, mk, pipe, rod, sphere, torus, type Profile } from '../geom';
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

/** Window: recessed glass, a dark gasket plate and a raised machined bezel. */
function windowOn(rOf: (y: number) => number, y0: number, y1: number, phiC: number, phiW: number, frameW: number): THREE.Mesh[] {
  const fy = frameW;
  const fphi = frameW / rOf((y0 + y1) / 2);
  return [
    mk(patch(rOf, y0 - fy, y1 + fy, phiC, phiW + fphi * 2, 0.005), M.darkMetal(), 'windowFrame'),
    mk(patch(rOf, y0, y1, phiC, phiW, 0.008), M.glass(), 'window'),
    mk(outline(rOf, y0, y1, phiC, phiW, fy * 0.55, 0.014), M.gunmetal(), 'windowBezel'),
  ];
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

  // heat shield
  root.add(
    mk(
      lathe([[0, yB], [R * 0.5, yB + 0.015], [R * 0.8, yB + 0.04], [R * 0.96, yB + 0.07], [R, yRim]], { segments: 56, tile: 0.5 }),
      M.heatTiles(),
      'heatShield',
    ),
  );
  root.add(mk(lathe([[R, yRim], [R, yRim + 0.02], [R * 0.985, yRim + 0.04]], { segments: 56 }), M.ablator()));
  // shingled cone
  const body: Profile = [[R * 0.985, yRim + 0.04], [cone(yRim + 0.06), yRim + 0.06]];
  body.push([cone(yShoulder - 0.08), yShoulder - 0.08], [rS - 0.025, yShoulder - 0.02], [rTop + 0.01, yShoulder]);
  root.add(mk(lathe(body, { segments: 64, tile: 0.5 }), M.shingle(), 'body'));
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
  // RCS ports near the shoulder
  const ports: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2;
    const y = yShoulder - 0.15;
    const g = cyl(0.018, 0.025, 0.04, 10);
    g.rotateX(PI / 2);
    g.translate(0, y, cone(y) + 0.01);
    g.rotateY(a);
    ports.push(g);
  }
  root.add(mk(ports, M.soot(), 'rcsPorts'));
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

  root.add(
    mk(
      lathe([[0, yB], [R * 0.45, yB + 0.03], [R * 0.78, yB + 0.08], [R * 0.95, yB + 0.14], [R, yRim]], { segments: 72, tile: 0.5 }),
      M.heatTiles(),
      'heatShield',
    ),
  );
  root.add(mk(lathe([[R, yRim], [R, yRim + 0.04], [r0, y0]], { segments: 72 }), M.ablator()));
  root.add(mk(lathe([[r0, y0], [cone(y1), y1], [rS - 0.02, yShoulder - 0.02], [rTop + 0.02, yShoulder]], { segments: 72, tile: 1 }), M.quilt(), 'body'));
  root.add(mk(patch(cone, y0 + 0.06, y0 + 0.14, 0, PI * 2, 0.008, 1, 72), M.accent('blue'), 'band'));
  root.add(mk(patch(cone, y0 + 0.17, y0 + 0.19, 0, PI * 2, 0.008, 1, 72), M.accent('blue')));
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
  root.add(mk(torus(rTop * 0.7, 0.025, 8, 48).translate(0, yT - 0.015, 0), M.gunmetal(), 'dockingRing'));
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
