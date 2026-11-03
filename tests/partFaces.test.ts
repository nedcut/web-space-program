import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PART_DEFS } from '../src/data/parts';
import { MESH_BUILDERS, setPartDeploy } from '../src/render/parts';
import { withDetail } from '../src/render/parts/geom';
import type { PartDef } from '../src/sim/vessel/types';
import { exposedFaces, type Tri } from './helpers/faceAudit';

/**
 * No part may be see-through. Part materials are single-sided, so an outer shell listed in the wrong direction, a
 * shell with no interior behind an opening, or a slot between two surfaces lets the viewer look through the part
 * (the jet nacelle bug fixed in PR #7). `exposedFaces` ray-traces every triangle of every part mesh and reports the
 * ones whose culled side can be seen from outside.
 *
 * Every stack node is left open: a part can sit at the top or bottom of a stack, under a smaller neighbour, or alone
 * in the editor, so its stack faces must be closed. Only surface-attach mounts are covered, by a large disc standing
 * in for the hull they sit on. Nozzle exits stay open too, so throats must be closed.
 *
 * Not checked:
 * - Mouths of swept pipes and hoses (`pipe()`): open by design, a few centimetres across and mostly buried in the parts
 *   they join. The mock below caps them, so they still occlude like solid tubes.
 * - Double-sided materials (parachute canopies), alpha-tested decals and transparent glass (see collectTris).
 */
vi.mock('../src/render/parts/geom', async (importOriginal) => {
  const geom = await importOriginal<typeof import('../src/render/parts/geom')>();
  /** Fan caps over both end rings of a TubeGeometry, facing out along the tube. */
  const capTube = (tube: THREE.TubeGeometry): THREE.BufferGeometry => {
    const { tubularSegments: ts, radialSegments: rs } = tube.parameters;
    const p = tube.getAttribute('position');
    const caps: number[] = [];
    for (const [ring, inward] of [[0, 1], [ts, ts - 1]] as const) {
      const at = (r: number, k: number) => new THREE.Vector3().fromBufferAttribute(p, r * (rs + 1) + k);
      const centre = (r: number) => { const c = new THREE.Vector3(); for (let k = 0; k < rs; k++) c.add(at(r, k)); return c.divideScalar(rs); };
      const c = centre(ring);
      const out = c.clone().sub(centre(inward));
      for (let k = 0; k < rs; k++) {
        const a = at(ring, k), b = at(ring, k + 1);
        const facesOut = new THREE.Vector3().crossVectors(a.clone().sub(c), b.clone().sub(c)).dot(out) > 0;
        caps.push(...c.toArray(), ...(facesOut ? a : b).toArray(), ...(facesOut ? b : a).toArray());
      }
    }
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(caps, 3));
    cap.computeVertexNormals();
    return geom.merge([tube, cap]);
  };
  return { ...geom, pipe: (...args: Parameters<typeof geom.pipe>) => capTube(geom.pipe(...args) as THREE.TubeGeometry) };
});

/** Stand-in hull for surface-attach mounts: a 4 m disc just behind the mount face. */
function hullCovers(def: PartDef): THREE.BufferGeometry[] {
  return def.attachNodes.filter((n) => n.id === 'srf').map((n) => {
    const d = new THREE.Vector3(n.direction.x, n.direction.y, n.direction.z).normalize();
    const g = new THREE.CircleGeometry(4, 48);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d));
    return g.translate(n.position.x + d.x * 0.002, n.position.y + d.y * 0.002, n.position.z + d.z * 0.002);
  });
}

function hasDeployables(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => { if (o.userData.deploy) found = true; });
  return found;
}

function describeExposed(tris: Tri[]): string[] {
  const by = new Map<string, { n: number; area: number; at: THREE.Vector3 }>();
  for (const t of tris) {
    const mat = Array.isArray(t.mesh.material) ? 'multi' : t.mesh.material.name || t.mesh.material.type;
    const key = `${t.mesh.name || '(unnamed)'} [${mat}]`;
    const e = by.get(key) ?? { n: 0, area: 0, at: t.c };
    e.n++;
    e.area += t.area;
    by.set(key, e);
  }
  return [...by].map(([k, e]) => `${k}: ${e.n} faces, ${(e.area * 1e4).toFixed(1)} cm2, near (${e.at.toArray().map((v) => v.toFixed(2)).join(', ')})`);
}

/**
 * Touching lathes with different segment counts leave slivers up to about R * pi^2 / 2 / n^2 wide (n >= 40 at High,
 * >= 20 at Low): never visible, so gaps below that scale count as closed. At Low the coarse inner nozzle bell pokes
 * a few centimetres through the outer bell; a surface facing the viewer that close behind a culled face hides it.
 * Real gaps this test found were 6 mm to 7 cm wide.
 */
function tolerances(root: THREE.Object3D, detail: number) {
  const b = new THREE.Box3().setFromObject(root);
  const r = Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z);
  return detail === 1 ? { gap: Math.max(0.002, 0.003 * r), behind: Math.max(0.02, 0.015 * r) } : { gap: Math.max(0.002, 0.012 * r), behind: Math.max(0.02, 0.04 * r) };
}

describe('part meshes have no see-through faces', () => {
  it.each(PART_DEFS.map((p) => [p.id, p] as const))('%s', (_id, def: PartDef) => {
    const problems: string[] = [];
    for (const detail of [1, 0.5]) {
      const root = withDetail(detail, () => MESH_BUILDERS[def.mesh](def));
      // Deployed states only at High: Low reuses the same deployable geometry.
      for (const deploy of detail === 1 && hasDeployables(root) ? [0, 1] : [0]) {
        setPartDeploy(root, deploy);
        const exposed = exposedFaces(root, { covers: hullCovers(def), ...tolerances(root, detail) });
        for (const line of describeExposed(exposed)) problems.push(`${detail === 1 ? 'high' : 'low'} deploy=${deploy} ${line}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
