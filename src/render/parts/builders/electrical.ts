import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { around, box, cyl, grp, lathe, mk, setDeployData, torus } from '../geom';
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

export function buildSolarFixed(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const root = grp('solarFixed');
  const back = box(w, h, d * 0.5);
  back.translate(0, 0, zm + d * 0.25);
  root.add(mk(back, M.satinWhite(), 'substrate'));
  const cells = new THREE.PlaneGeometry(w - 0.03, h - 0.03);
  const uv = cells.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (w - 0.03)) / 0.5, (uv.getY(i) * (h - 0.03)) / 0.5);
  cells.translate(0, 0, zm + d * 0.5 + 0.001);
  root.add(mk(cells, M.solarCells(), 'cells'));
  const fr: THREE.BufferGeometry[] = [];
  for (const sy of [-1, 1]) fr.push(box(w, 0.015, d * 0.5).translate(0, sy * (h / 2 - 0.0075), zm + d * 0.75));
  for (const sx of [-1, 1]) fr.push(box(0.015, h, d * 0.5).translate(sx * (w / 2 - 0.0075), 0, zm + d * 0.75));
  root.add(mk(fr, M.aluminium(), 'frame'));
  return root;
}

/**
 * Accordion array. 'panelWing' rotates from lying along the housing face (+Y, stowed) to pointing
 * outward (+Z, deployed); each panel hinges off the previous one with alternating fold direction.
 */
export function buildSolarDeploy(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const { z: zm } = srfMount(def);
  const n = Math.max(1, Math.round(num(def, 'panels', 4)));
  const L = num(def, 'panelLength', 0.5);
  const W = num(def, 'panelWidth', 0.4);
  const th = 0.012;
  const root = grp('solarDeploy');
  const housing = box(Math.min(w, W + 0.04), h, d * 0.55, 0.4);
  housing.translate(0, 0, zm + d * 0.275);
  root.add(mk(housing, M.satinWhite(), 'housing'));
  const foilFace = box(Math.min(w, W + 0.04) * 0.86, h * 0.86, 0.006, 0.3);
  foilFace.translate(0, 0, zm + d * 0.55 + 0.002);
  root.add(mk(foilFace, M.goldFoil(), 'foilFace'));
  const rim = box(Math.min(w, W + 0.04) + 0.01, h + 0.01, 0.02);
  rim.translate(0, 0, zm + 0.01);
  root.add(mk(rim, M.gunmetal()));
  const hingeY = -h / 2 + 0.03;
  const hingeZ = zm + d * 0.55 + th / 2 + 0.004;
  const knuckle = cyl(0.025, 0.025, Math.min(w, W) * 0.6, 12);
  knuckle.rotateZ(PI / 2);
  knuckle.translate(0, hingeY, hingeZ - 0.01);
  root.add(mk(knuckle, M.gunmetal(), 'hingeKnuckle'));

  const wing = grp('panelWing');
  wing.position.set(0, hingeY, hingeZ);
  root.add(wing);
  setDeployData(wing, { rot0: [0, 0, 0], rot1: [PI / 2, 0, 0] });
  const yoke = box(0.04, 0.06, th);
  yoke.translate(0, 0.03, 0);
  wing.add(mk(yoke, M.gunmetal()));

  const mats = [M.aluminium(), M.aluminium(), M.aluminium(), M.aluminium(), M.solarCells(), M.solarCells()];
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
    const g = box(W, L - 0.006, th, 0.5);
    g.translate(0, L / 2, zc);
    p.add(mk(g, mats, 'panel'));
    const spar = box(0.012, L - 0.01, th * 1.4);
    spar.translate(0, L / 2, zc);
    p.add(mk(spar, M.aluminium()));
    parent.add(p);
    parent = p;
    zcPrev = zc;
    yStart = 0;
  }
  return root;
}
