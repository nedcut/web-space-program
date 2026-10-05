import * as THREE from 'three';
import type { BodyDef } from '../../../sim/bodies/types';
import type { Terrain } from '../../../sim/terrain/api';
import type { QualitySettings } from '../../core/quality';
import type { PlanetUniforms } from '../uniforms';
import { createScatterMaterial } from '../materials';
import { CELL_SIZE, direction, nearbyCells, randomFor, surfaceClass, type Cell } from './grid';
import { plantGeometry, rockGeometry } from './geometry';

const CAPACITY = 2048;
interface Batch { mesh: THREE.InstancedMesh; perCell: number; kind: 'rock' | 'grass' | 'bush' | 'tree' }
interface Resident { cell: Cell; slot: number }
/** Stable cube-face cells. GPU instance translations are cell-local, never planet-scale. */
export class SurfaceScatter {
  readonly group = new THREE.Group();
  private readonly centers = new Float32Array(CAPACITY * 4);
  private readonly centerTexture = new THREE.DataTexture(this.centers, CAPACITY, 1, THREE.RGBAFormat, THREE.FloatType);
  private readonly batches: Batch[] = [];
  private readonly cells = new Map<string, Resident>();
  private readonly free = Array.from({ length: CAPACITY }, (_, i) => CAPACITY - 1 - i);
  private pending: Cell[] = [];
  private active: { key: string; build: Generator<void> } | null = null;
  private lastAnchor = '';
  private readonly transform = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly spin = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  private readonly centre = new THREE.Vector3();
  private readonly settings: QualitySettings['scatter'];
  stats = { cells: 0, queued: 0 };

  constructor(private readonly body: BodyDef, private readonly terrain: Terrain, quality: QualitySettings, u: PlanetUniforms) {
    this.settings = quality.scatter;
    this.group.name = `scatter:${body.id}`;
    this.centerTexture.needsUpdate = true;
    this.centerTexture.magFilter = this.centerTexture.minFilter = THREE.NearestFilter;
    // Earth's surface palette starts with ocean/vegetation colors; mountain stones use rock tones.
    const palette = body.id === 'earth'
      ? [[0.13, 0.12, 0.10], [0.16, 0.145, 0.125], [0.20, 0.19, 0.17]]
      : body.surface?.colors ?? [[0.2, 0.2, 0.2]];
    for (let i = 0; i < 3; i++) this.addBatch(rockGeometry(i), 'rock', 16, palette[Math.min(i, palette.length - 1)], quality, u);
    if (body.id === 'earth' && this.settings.vegetation) {
      this.addBatch(plantGeometry('grass'), 'grass', 64, [0.10, 0.19, 0.035], quality, u);
      this.addBatch(plantGeometry('bush'), 'bush', 4, [0.035, 0.10, 0.02], quality, u);
      this.addBatch(plantGeometry('tree'), 'tree', 2, [0.025, 0.07, 0.018], quality, u);
    }
  }
  private addBatch(g: THREE.BufferGeometry, kind: Batch['kind'], perCell: number, color: number[], quality: QualitySettings, u: PlanetUniforms): void {
    const ids = new Float32Array(CAPACITY * perCell);
    for (let i = 0; i < ids.length; i++) ids[i] = Math.floor(i / perCell);
    if (!g.getAttribute('color')) {
      const tint = new Float32Array(g.getAttribute('position').count * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(tint, 3));
    }
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(ids, 1));
    const material = createScatterMaterial(u, quality, this.centerTexture, color, kind !== 'rock', this.settings.radius);
    const mesh = new THREE.InstancedMesh(g, material, ids.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < ids.length; i++) mesh.setMatrixAt(i, this.zero);
    mesh.frustumCulled = false;
    mesh.name = `scatter:${kind}:${this.batches.length}`;
    this.batches.push({ mesh, perCell, kind }); this.group.add(mesh);
  }
  get idle(): boolean { return this.pending.length === 0 && !this.active; }

  update(camera: [number, number, number], bodyOffset: THREE.Vector3, rotation: THREE.Quaternion): void {
    const length = Math.hypot(...camera), d = camera.map(v => v / length) as [number, number, number];
    const h = this.terrain.heightAt(...d);
    const altitude = length - this.body.radius - (this.terrain.ocean ? Math.max(0, h) : h);
    this.group.visible = altitude < this.settings.maxAltitude;
    if (!this.group.visible) return;
    const anchor = d.map(v => Math.floor(v * this.body.radius / (CELL_SIZE / 2))).join(':');
    if (anchor !== this.lastAnchor) {
      this.lastAnchor = anchor;
      const wanted = nearbyCells(this.body.radius, camera, this.settings.radius).slice(0, CAPACITY);
      const keys = new Set(wanted.map(c => c.key));
      for (const [key, r] of this.cells) {
        if (keys.has(key)) continue;
        this.clearSlot(r.slot); this.free.push(r.slot); this.cells.delete(key);
      }
      if (this.active && !keys.has(this.active.key)) this.active = null;
      this.pending = wanted.filter(c => !this.cells.has(c.key));
    }
    const start = performance.now();
    let built = 0;
    while (built < this.settings.cellsPerFrame && performance.now() - start < this.settings.budgetMs) {
      if (!this.active) {
        if (!this.pending.length || !this.free.length) break;
        const cell = this.pending.shift()!, slot = this.free.pop()!;
        this.clearSlot(slot);
        this.cells.set(cell.key, { cell, slot });
        this.active = { key: cell.key, build: this.buildCell(cell, slot) };
      }
      if (this.active.build.next().done) { this.active = null; built++; }
    }
    // Rotation only acts on metre-sized instance offsets. Centres are transformed in JS float64
    // before subtraction from the origin and the final float32 texture upload.
    this.group.quaternion.copy(rotation);
    const inverse = this.q.copy(rotation).invert();
    for (const r of this.cells.values()) {
      this.centre.set(...r.cell.center).applyQuaternion(rotation).add(bodyOffset).applyQuaternion(inverse);
      const i = r.slot * 4;
      this.centers[i] = this.centre.x; this.centers[i + 1] = this.centre.y; this.centers[i + 2] = this.centre.z;
    }
    this.centerTexture.needsUpdate = true;
    let maxSlot = -1;
    for (const r of this.cells.values()) maxSlot = Math.max(maxSlot, r.slot);
    for (const b of this.batches) {
      b.mesh.count = (maxSlot + 1) * b.perCell;
      if (b.mesh.instanceMatrix.updateRanges.length) b.mesh.instanceMatrix.needsUpdate = true;
    }
    this.stats.cells = this.cells.size; this.stats.queued = this.pending.length + (this.active ? 1 : 0);
  }
  private clearSlot(slot: number): void {
    for (const b of this.batches) {
      for (let i = 0; i < b.perCell; i++) b.mesh.setMatrixAt(slot * b.perCell + i, this.zero);
      b.mesh.instanceMatrix.addUpdateRange(slot * b.perCell * 16, b.perCell * 16);
    }
  }
  private *buildCell(c: Cell, slot: number): Generator<void> {
    const random = randomFor(this.body.surface?.seed ?? 1, c);
    const d = direction(c.face, (c.x + 0.5) * 2 / c.n - 1, (c.y + 0.5) * 2 / c.n - 1);
    const h = this.terrain.heightAt(...d);
    c.center = d.map(v => v * (this.body.radius + h)) as [number, number, number];
    const dx = direction(c.face, (c.x + 0.6) * 2 / c.n - 1, (c.y + 0.5) * 2 / c.n - 1);
    const dy = direction(c.face, (c.x + 0.5) * 2 / c.n - 1, (c.y + 0.6) * 2 / c.n - 1);
    const slope = Math.hypot(this.terrain.heightAt(...dx) - h, this.terrain.heightAt(...dy) - h) / (CELL_SIZE * 0.1);
    for (const b of this.batches) {
      for (let i = 0; i < b.perCell; i++) {
        yield;
        const p = direction(c.face, (c.x + random()) * 2 / c.n - 1, (c.y + random()) * 2 / c.n - 1);
        const height = this.terrain.heightAt(...p);
        const type = surfaceClass(this.body, this.terrain, p, height, slope);
        const r = random();
        if (type === 'none' || (b.kind === 'rock' ? type !== 'rock' || r > Math.min(1, 0.65 + slope * 2) : type !== 'green')) continue;
        // Power law: most stones fit in a hand; metre-scale boulders are rare.
        let size = 0.10 + Math.pow(random(), 5) * 1.5;
        if (b.kind === 'rock' && random() > 0.997) size = 2 + random() * 2;
        if (this.body.id === 'titan') size *= 0.3;
        if (b.kind !== 'rock') size = b.kind === 'tree' ? 2 + random() * 2 : b.kind === 'bush' ? 0.6 + random() : 0.4 + random() * 0.6;
        this.v.set(...p);
        this.transform.quaternion.setFromUnitVectors(this.up, this.v);
        this.spin.setFromAxisAngle(this.up, random() * Math.PI * 2);
        this.transform.quaternion.multiply(this.spin);
        this.transform.position.copy(this.v).multiplyScalar(this.body.radius + height).sub(this.centre.set(...c.center));
        this.transform.scale.set(size, size * (0.8 + random() * 0.4), size);
        this.transform.updateMatrix(); b.mesh.setMatrixAt(slot * b.perCell + i, this.transform.matrix);
        b.mesh.instanceMatrix.addUpdateRange((slot * b.perCell + i) * 16, 16);
      }
    }
  }
  dispose(): void {
    for (const b of this.batches) { b.mesh.dispose(); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); }
    this.centerTexture.dispose(); this.group.removeFromParent(); this.cells.clear();
  }
}
