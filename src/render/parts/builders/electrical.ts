import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, bevelBox, box, cyl, detailLevel, grp, lathe, mk, pipe, rod, setDeployData, tint, torus } from '../geom';
import { boxDims, cylDims, num, srfMount, str } from './common';

const PI = Math.PI;

export function buildBattery(def: PartDef): THREE.Object3D {
  const root = grp('battery');
  if (str(def, 'style', 'stack') === 'radial') {
    const { w, h, d } = boxDims(def);
    const { z: zm } = srfMount(def);
    const plate = box(w * 0.95, h * 0.95, 0.015);
    plate.translate(0, 0, zm + 0.0075);
    root.add(mk(plate, M.gunmetal()));
    const body = box(w * 0.9, h * 0.82, d - 0.03, 0.25);
    body.translate(0, 0, zm + 0.015 + (d - 0.03) / 2);
    root.add(mk(body, M.charcoalPanel(), 'housing'));
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const r = box(0.012, h * 0.86, d - 0.02);
      r.translate(-w * 0.38 + (i * w * 0.76) / 5, 0, zm + 0.01 + (d - 0.02) / 2);
      ribs.push(r);
    }
    root.add(mk(ribs, M.gunmetal(), 'ribs'));
    const led = box(w * 0.4, 0.012, 0.006);
    led.translate(-w * 0.1, h * 0.25, zm + d - 0.012);
    root.add(mk(led, M.statusLed('green'), 'chargeIndicator'));
    return root;
  }
  const { rTop: r, h } = cylDims(def);
  const fl = 0.03;
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
  root.add(mk(cyl(r * 0.8, r * 0.8, h - fl * 2, 32), M.darkMetal(), 'core'));
  root.add(mk([lathe([[r * 0.98, h / 2], [0, h / 2 - 0.006]], { segments: 48 }), lathe([[0, -h / 2 + 0.006], [r * 0.98, -h / 2]], { segments: 48 })], M.darkMetal()));
  const n = 14;
  const cw = 2 * PI * r * 0.86 / n - 0.02;
  const cell = box(cw, h - fl * 2 - 0.02, r * 0.14, 0.25);
  cell.translate(0, 0, r * 0.86);
  root.add(mk(around(cell, n, 0), M.charcoalPanel(), 'cells'));
  const led = box(cw * 0.5, 0.01, 0.006);
  led.translate(0, (h - fl * 2) * 0.3, r * 0.93 + 0.003);
  root.add(mk(around(led, n, 0), M.statusLed('green'), 'chargeIndicators'));
  root.add(mk(torus(r * 0.94, 0.012, 6, 48).translate(0, -(h - fl * 2) * 0.32, 0), M.cable(), 'harness'));
  return root;
}

/** Cell face: a plane (normal -Z or +Z) with UVs in metres / 0.5 m so the solar texture's 4 x 4 cells are 12.5 cm. */
function cellPlane(w: number, h: number, facing: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.5, (uv.getY(i) * h) / 0.5);
  if (facing < 0) g.rotateY(PI);
  return g;
}

/** Rigid tile: white substrate on standoffs, framed cell face with end busbars, junction box and lead. */
export function buildSolarFixed(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const fine = detailLevel() === 1;
  const root = grp('solarFixed');
  const back = box(w, h, d * 0.5);
  back.translate(0, 0, zm + d * 0.25);
  root.add(mk(back, M.satinWhite(), 'substrate'));
  root.add(mk(cellPlane(w - 0.03, h - 0.06, 1).translate(0, 0, zm + d * 0.5 + 0.001), M.solarCells(), 'cells'));
  const f = 0.015;
  const fr: THREE.BufferGeometry[] = [];
  for (const sy of [-1, 1]) fr.push(tint(box(w, f, d * 0.5).translate(0, sy * (h / 2 - f / 2), zm + d * 0.75), 1));
  for (const sx of [-1, 1]) fr.push(tint(box(f, h, d * 0.5).translate(sx * (w / 2 - f / 2), 0, zm + d * 0.75), 1));
  // interconnect busbars across both ends of the cell field
  for (const sy of [-1, 1]) fr.push(tint(box(w - 0.03, 0.012, 0.003).translate(0, sy * (h / 2 - 0.024), zm + d * 0.5 + 0.0015), 1.15));
  if (fine)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) fr.push(tint(box(0.04, 0.04, 0.006).translate(sx * (w / 2 - 0.02), sy * (h / 2 - 0.02), zm + d + 0.003), 0.7));
  root.add(mk(fr, M.aluminium(), 'frame'));
  // junction box with its lead running back to the mount
  const jb = box(0.08, 0.035, 0.03).translate(0, h / 2 - 0.005, zm + d * 0.5 + 0.012);
  const lead = pipe([[0.02, h / 2 + 0.01, zm + d * 0.5 + 0.02], [0.03, h / 2 + 0.03, zm + d * 0.3], [0.03, h / 2 + 0.01, zm + 0.01]], 0.005, 5, 10);
  root.add(mk([jb, lead], M.darkMetal(), 'junction'));
  return root;
}

/**
 * Accordion array. 'panelWing' rotates from lying along the housing face (+Y, stowed) to pointing
 * outward (+Z, deployed); each panel hinges off the previous one with alternating fold direction.
 * Cells face local -Z (protected against the housing when stowed, forward when deployed); the back is an
 * aluminium honeycomb substrate with a darker stiffening truss, and piano-hinge knuckles join the panels.
 * Each panel is two draws (cells + aluminium); the truss/edge shading lives in vertex colour.
 */
export function buildSolarDeploy(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const n = Math.max(1, Math.round(num(def, 'panels', 4)));
  const L = num(def, 'panelLength', 0.5);
  const W = num(def, 'panelWidth', 0.4);
  const fine = detailLevel() === 1;
  const th = 0.012;
  const root = grp('solarDeploy');
  const hw = Math.min(w, W + 0.04);
  const housing = box(hw, h, d * 0.55, 0.4);
  housing.translate(0, 0, zm + d * 0.275);
  root.add(mk(housing, M.satinWhite(), 'housing'));
  const foilFace = box(hw * 0.86, h * 0.86, 0.006, 0.3);
  foilFace.translate(0, 0, zm + d * 0.55 + 0.002);
  root.add(mk(foilFace, M.goldFoil(), 'foilFace'));
  const hingeY = -h / 2 + 0.03;
  const hingeZ = zm + d * 0.55 + th / 2 + 0.004;
  const rim = box(hw + 0.01, h + 0.01, 0.02);
  rim.translate(0, 0, zm + 0.01);
  const knuckle = cyl(0.025, 0.025, Math.min(w, W) * 0.6, 12);
  knuckle.rotateZ(PI / 2);
  knuckle.translate(0, hingeY, hingeZ - 0.01);
  const drive: THREE.BufferGeometry[] = [rim, knuckle];
  // array drive: motor drum and end bearings on the hinge line, launch-lock brackets at the free end
  drive.push(cyl(0.045, 0.045, 0.08, 16).rotateZ(PI / 2).translate(-Math.min(w, W) * 0.3 - 0.04, hingeY, hingeZ - 0.01));
  for (const sx of [-1, 1]) drive.push(bevelBox(0.03, 0.06, 0.05).translate(sx * Math.min(w, W) * 0.32, hingeY, hingeZ - 0.025));
  if (fine) for (const sx of [-1, 1]) drive.push(bevelBox(0.05, 0.04, 0.03).translate(sx * (hw / 2 - 0.035), h / 2 - 0.03, zm + d * 0.55 + 0.015));
  root.add(mk(drive, M.gunmetal(), 'drive'));
  if (fine) {
    const bolts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) bolts.push(cyl(0.008, 0.008, 0.008, 6).rotateX(PI / 2).translate(sx * (hw / 2 - 0.01), sy * (h / 2 - 0.01), zm + 0.022));
    root.add(mk(bolts, M.chrome(), 'bolts'));
  }

  const wing = grp('panelWing');
  wing.position.set(0, hingeY, hingeZ);
  root.add(wing);
  setDeployData(wing, { rot0: [0, 0, 0], rot1: [PI / 2, 0, 0] });
  const yoke = box(0.04, 0.06, th);
  yoke.translate(0, 0.03, 0);
  wing.add(mk([yoke, cyl(0.012, 0.012, Math.min(w, W) * 0.5, 8).rotateZ(PI / 2).translate(0, 0.055, 0)], M.gunmetal()));

  const f = Math.min(0.022, W * 0.04); // frame width
  let parent: THREE.Object3D = wing;
  let zcPrev = 0;
  let yStart = 0.06;
  for (let i = 0; i < n; i++) {
    const p = grp(`panel${i}`);
    let zc = 0;
    if (i === 0) {
      p.position.set(0, yStart, 0);
    } else {
      const s = i % 2 === 1 ? 1 : -1;
      p.position.set(0, L, zcPrev + (s * th) / 2);
      zc = (-s * th) / 2;
      setDeployData(p, { rot0: [s * PI, 0, 0], rot1: [0, 0, 0] });
    }
    const y0 = 0.003, y1 = L - 0.003, ym = L / 2;
    // cell face (-Z) inside the frame
    p.add(mk(cellPlane(W - 2 * f, L - 2 * f - 0.006, -1).translate(0, ym, zc - th / 2 - 0.0008), M.solarCells(), 'cells'));
    const al: THREE.BufferGeometry[] = [];
    // honeycomb substrate
    al.push(tint(box(W - 0.002, y1 - y0, th * 0.7, 0.5).translate(0, ym, zc + th * 0.1), 0.92));
    // edge frame (slightly proud of the cell face)
    for (const sx of [-1, 1]) al.push(tint(box(f, y1 - y0, th * 1.15).translate(sx * (W / 2 - f / 2), ym, zc), 1.05));
    for (const yy of [y0 + f / 2, y1 - f / 2]) al.push(tint(box(W, f, th * 1.15).translate(0, yy, zc), 1.05));
    // interconnect busbars on the cell face at both ends and the panel centre
    for (const yy of [y0 + f + 0.006, ym, y1 - f - 0.006]) al.push(tint(box(W - 2 * f, 0.007, 0.002).translate(0, yy, zc - th / 2 - 0.0015), 1.2));
    if (fine) {
      // back stiffening truss: longerons, cross ribs and one X bay per half, darker anodised
      const zb = zc + th / 2 + 0.004;
      for (const sx of [-0.3, 0.3]) al.push(tint(box(0.01, y1 - y0 - 2 * f, 0.008).translate(sx * W, ym, zb), 0.55, 0.56, 0.6));
      for (const yy of [L * 0.25, L * 0.5, L * 0.75]) al.push(tint(box(W - 2 * f, 0.01, 0.008).translate(0, yy, zb), 0.55, 0.56, 0.6));
      for (const [a, b] of [[0.25, 0.5], [0.5, 0.75]] as const) {
        al.push(tint(rod([-0.3 * W, L * a, zb], [0.3 * W, L * b, zb], 0.004, 4), 0.5, 0.5, 0.55));
        al.push(tint(rod([0.3 * W, L * a, zb], [-0.3 * W, L * b, zb], 0.004, 4), 0.5, 0.5, 0.55));
      }
      // piano-hinge knuckles on the edge shared with the previous panel
      if (i > 0) for (const sx of [-0.32, 0, 0.32]) al.push(tint(cyl(th * 0.75, th * 0.75, W * 0.14, 8).rotateZ(PI / 2).translate(sx * W, 0, zc), 0.8));
      // harness along one edge of the back
      al.push(tint(box(0.012, y1 - y0 - 2 * f, 0.006).translate(W / 2 - f - 0.012, ym, zb), 0.25, 0.25, 0.27));
    }
    p.add(mk(al, M.aluminium(), 'panel'));
    parent.add(p);
    parent = p;
    zcPrev = zc;
    yStart = 0;
  }
  return root;
}
