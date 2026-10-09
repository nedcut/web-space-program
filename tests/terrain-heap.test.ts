import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Quadtree, VIEW_KEY } from '../src/render/planet/quadtree';
import { buildChunk, chunkIndices, octDecode, octEncode } from '../src/render/planet/chunkBuilder';

type Terrain = Parameters<typeof buildChunk>[0];
const R = 600_000;
// Below sea level everywhere: every chunk also carries an ocean mesh.
const terrain = { heightAt: () => -100, maxHeight: -100, minHeight: -100, liquid: { level: 0 } } as unknown as Terrain;
const pool = { available: false, buildChunkSync: (_k: string, p: Parameters<typeof buildChunk>[1]) => buildChunk(terrain, p) };

function makeTree(cacheSize: number, cacheBytes: number) {
  return new Quadtree({ terrainKey: 't', radius: R, minHeight: -100, maxHeight: -100, res: 8, maxLevel: 6, ocean: true,
    pool: pool as never, terrainMaterial: new THREE.MeshBasicMaterial(), oceanMaterial: new THREE.MeshBasicMaterial(),
    maxInFlight: 4, buildBudgetMs: 1e9, cacheSize, cacheBytes });
}
// Camera `alt` above the surface over the +Z pole, or over +X (`side`).
const cam = (alt: number, side = false) => side ? { x: R + alt, y: 0, z: 0 } : { x: 0, y: 0, z: R + alt };
const ctx = (alt: number, frame: number, side = false) => ({ camBF: cam(alt, side), screenFactor: 1000, maxScreenError: 2, inFrustum: () => true, frame });
const view = (alt: number, side = false) => { const c = cam(alt, side), v = new Float64Array(VIEW_KEY); v[0] = c.x; v[2] = c.z; v[6] = 1; v[7] = 1000; return v; };
const rot = new THREE.Quaternion(), rotM = new THREE.Matrix3();
/** Run frames [from, to) with the camera at altitude `alt`. */
function fly(qt: Quadtree, alt: number, from: number, to: number, side = false) {
  for (let f = from; f < to; f++) { qt.select(ctx(alt, f, side), view(alt, side)); qt.pump(); qt.place(0, 0, 0, rot, rotM); qt.evict(f); }
}
function meshes(qt: Quadtree) {
  const out: THREE.Mesh[] = [];
  const visit = (n: Quadtree['roots'][number]) => { if (n.mesh) out.push(n.mesh); if (n.oceanMesh) out.push(n.oceanMesh); n.children?.forEach(visit); };
  qt.roots.forEach(visit);
  return out;
}

describe('terrain chunk memory', () => {
  it('packs 20 bytes per vertex; positions are relative to the 1024 m detail origin', () => {
    const t = { heightAt: (x: number, y: number) => 300 * x * y - 100, maxHeight: 200, minHeight: -400, liquid: { level: 0 } } as unknown as Terrain;
    const c = buildChunk(t, { radius: R, res: 8, level: 6, face: 2, ix: 17, iy: 40, ocean: true });
    const n = c.positions.length / 3;
    expect((c.positions.byteLength + c.normals.byteLength + c.colors.byteLength) / n).toBe(20);
    const o = c.ocean!;
    expect((o.positions.byteLength + o.normals.byteLength + o.depth.byteLength) / n).toBe(20);
    for (const v of c.origin) expect(Math.abs(v % 1024)).toBe(0);
    // Local positions stay small (chunk + < 1774 m to the aligned origin) and land on the body.
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const x = c.origin[0] + c.positions[i * 3], y = c.origin[1] + c.positions[i * 3 + 1], z = c.origin[2] + c.positions[i * 3 + 2];
      const r = Math.hypot(x, y, z);
      expect(r).toBeGreaterThan(R - 3000); expect(r).toBeLessThan(R + 400);
      // Decoded normals are unit and outward.
      octDecode(c.normals[i * 2], c.normals[i * 2 + 1], out);
      expect(Math.hypot(...out)).toBeCloseTo(1, 6);
      expect(out[0] * x + out[1] * y + out[2] * z).toBeGreaterThan(0);
    }
  });

  it('octahedral normals round-trip within 0.01°', () => {
    const e = new Int16Array(2), out: [number, number, number] = [0, 0, 0];
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const z = i === 0 ? -1 : i === 1 ? 1 : Math.cos(i * 2.399963) * 0.999 * (i % 2 ? 1 : -1), a = i * 0.7548776;
      const s = Math.sqrt(1 - z * z), x = s * Math.cos(a), y = s * Math.sin(a);
      octEncode(x, y, z, e, 0);
      octDecode(e[0], e[1], out);
      worst = Math.max(worst, Math.acos(Math.min(1, x * out[0] + y * out[1] + z * out[2])));
    }
    expect(worst * 180 / Math.PI).toBeLessThan(0.01);
  });

  it('chunks carry no index arrays: land and ocean share one index attribute', () => {
    const chunk = buildChunk(terrain, { radius: R, res: 8, level: 1, face: 0, ix: 0, iy: 0, ocean: true });
    expect('indices' in chunk).toBe(false);
    expect(chunk.ocean && 'indices' in chunk.ocean).toBe(false);
    expect(chunkIndices(8)).toBe(chunkIndices(8));
    const qt = makeTree(1e6, 1e12);
    fly(qt, 1000, 0, 20);
    const all = meshes(qt);
    expect(all.length).toBeGreaterThan(12);
    for (const m of all) expect(m.geometry.index).toBe(all[0].geometry.index);
    expect(all[0].geometry.index!.array).toBe(chunkIndices(8));
    qt.dispose();
  });

  it('counts ocean meshes and keeps stale chunk bytes within budget, never evicting chunks in use', () => {
    const big = makeTree(1e6, 1e12);
    fly(big, 1000, 0, 40);
    const fullMeshes = big.stats.meshes;
    // Every chunk is underwater, so meshes = 2 × chunks.
    expect(fullMeshes % 2).toBe(0);
    expect(fullMeshes).toBe(meshes(big).length);
    const inUseMB = big.stats.cacheMB;
    expect(inUseMB).toBeGreaterThan(0);
    big.dispose();

    const qt = makeTree(1e6, 0.2 * 1048576);
    fly(qt, 1000, 0, 40);
    // Nothing is stale yet: the budget alone never evicts chunks that are in use.
    expect(qt.stats.meshes).toBe(fullMeshes);
    const selected = qt.selected.slice();
    // Fly to another face: the fine chunks near the pole become stale and are evicted down to the budget.
    fly(qt, 1000, 40, 200, true);
    expect(staleMB(qt, 199)).toBeLessThanOrEqual(0.2);
    // Each built chunk had a land and an ocean mesh: fewer meshes than that means chunks were evicted.
    expect(qt.stats.meshes).toBeLessThan(qt.stats.builtTotal * 2);
    for (const n of selected) if (n.key.level === 0) expect(n.state).toBe('ready');
    qt.dispose();
  });

  it('evicts during a reused selection only chunks that the last walk did not use', () => {
    const qt = makeTree(1e6, 0);
    fly(qt, 1000, 0, 40);
    fly(qt, 1000, 40, 60, true);
    const before = qt.selected.slice();
    const meshesBefore = qt.stats.meshes;
    // Hold the view still: the selection is reused, yet the chunks left behind at the pole go stale.
    fly(qt, 1000, 60, 200, true);
    expect(qt.stats.meshes).toBeLessThan(meshesBefore);
    for (const n of before) expect(n.state).toBe('ready');
    expect(qt.select(ctx(1000, 200, true), view(1000, true))).toEqual(before);
    qt.dispose();
  });

  it('evicts stale chunks down to the budget while the planet is drawn far (no selection walk)', () => {
    const qt = makeTree(1e6, 0);
    fly(qt, 1000, 0, 40);
    qt.hideAll();
    for (let f = 40; f < 200; f++) qt.evict(f, true);
    // Only the roots survive with a zero budget.
    const left = meshes(qt);
    expect(left.length).toBe(12);
    qt.dispose();
  });
});

/** MB of chunk data that eviction may drop at `frame`: not visited by the last walk and not for 30 frames. */
function staleMB(qt: Quadtree, frame: number) {
  const nodes: Quadtree['roots'][number][] = [];
  const visit = (n: Quadtree['roots'][number]) => { nodes.push(n); n.children?.forEach(visit); };
  qt.roots.forEach(visit);
  const walk = Math.max(...nodes.map((n) => n.lastUsed));
  let bytes = 0;
  for (const n of nodes) {
    if (!n.data || n.key.level === 0 || n.lastUsed === walk || frame - n.lastUsed <= 30) continue;
    bytes += n.data.positions.byteLength + n.data.normals.byteLength + n.data.colors.byteLength;
    const o = n.data.ocean;
    if (o) bytes += o.positions.byteLength + o.normals.byteLength + o.depth.byteLength;
  }
  return bytes / 1048576;
}
