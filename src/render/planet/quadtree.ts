import * as THREE from 'three';
import { chunkBounds, chunkEdgeLength, chunkId, faceToSphere, type ChunkData, type ChunkKey } from './chunkBuilder';
import type { TerrainWorkerPool } from './workerPool';

/**
 * Cube-sphere quadtree LOD.
 *
 * Selection rule (per frame): a node is split when its screen-space geometric error
 *   (vertexSpacing / distance) · screenFactor  >  maxScreenError
 * and all four children are built; otherwise the node itself is drawn (if built). Nodes beyond the
 * horizon are culled; nodes outside the view frustum are not refined further. Builds are requested
 * nearest-first and executed in the worker pool (or on the main thread within a time budget).
 */
export interface QuadtreeOptions {
  terrainKey: string;
  radius: number;
  minHeight: number;
  maxHeight: number;
  res: number;
  maxLevel: number;
  ocean: boolean;
  pool: TerrainWorkerPool;
  terrainMaterial: THREE.Material;
  oceanMaterial?: THREE.Material;
  maxInFlight: number;
  buildBudgetMs: number;
  cacheSize: number;
}

export interface SelectContext {
  /** Camera position in body-fixed coordinates (float64). */
  camBF: { x: number; y: number; z: number };
  /** viewportHeight / (2 tan(fov/2)) */
  screenFactor: number;
  maxScreenError: number;
  /** Frustum test for a body-fixed sphere (centre, radius). */
  inFrustum: (cx: number, cy: number, cz: number, r: number) => boolean;
  frame: number;
}

const GEOM_ERROR_FACTOR = 0.3;

export class ChunkNode {
  readonly id: string;
  children: ChunkNode[] | null = null;
  data: ChunkData | null = null;
  mesh: THREE.Mesh | null = null;
  oceanMesh: THREE.Mesh | null = null;
  state: 'none' | 'building' | 'ready' = 'none';
  lastUsed = 0;
  /** Estimated centre (unit dir) and angular radius before data arrives. */
  readonly dir: [number, number, number] = [0, 0, 0];
  readonly angRadius: number;
  readonly edge: number;
  readonly key: ChunkKey;

  constructor(key: ChunkKey, radius: number) {
    this.key = key;
    this.id = chunkId(key);
    const { s0, t0, size } = chunkBounds(key.level, key.ix, key.iy);
    faceToSphere(key.face, s0 + size / 2, t0 + size / 2, this.dir);
    this.edge = chunkEdgeLength(key.level, radius);
    // Half-diagonal of the chunk in radians (cube-sphere cells are at most ~1.4× stretched).
    this.angRadius = (this.edge / radius) * 0.8;
  }
}

export class Quadtree {
  readonly group = new THREE.Group();
  readonly roots: ChunkNode[];
  private opts: QuadtreeOptions;
  private wanted = new Map<ChunkNode, number>();
  private completed: { node: ChunkNode; data: ChunkData }[] = [];
  private inflight = 0;
  private meshCount = 0;
  readonly selected: ChunkNode[] = [];
  private prevSelected = new Set<ChunkNode>();
  stats = { selected: 0, meshes: 0, inflight: 0, queued: 0, builtTotal: 0, lastBuildMs: 0 };

  constructor(opts: QuadtreeOptions) {
    this.opts = opts;
    this.roots = [0, 1, 2, 3, 4, 5].map((face) => new ChunkNode({ face, level: 0, ix: 0, iy: 0 }, opts.radius));
    this.group.name = 'terrain-quadtree';
  }

  get rootsReady(): boolean {
    return this.roots.every((r) => r.state === 'ready');
  }

  get idle(): boolean {
    return this.wanted.size === 0 && this.inflight === 0 && this.completed.length === 0;
  }

  setMaterials(terrain: THREE.Material, ocean?: THREE.Material): void {
    this.opts.terrainMaterial = terrain;
    this.opts.oceanMaterial = ocean;
    const visit = (n: ChunkNode) => {
      if (n.mesh) n.mesh.material = terrain;
      if (n.oceanMesh && ocean) n.oceanMesh.material = ocean;
      n.children?.forEach(visit);
    };
    this.roots.forEach(visit);
  }

  /** Choose the set of chunks to draw this frame; queue missing builds. */
  select(ctx: SelectContext): ChunkNode[] {
    const R = this.opts.radius;
    const cx = ctx.camBF.x, cy = ctx.camBF.y, cz = ctx.camBF.z;
    const camDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const rMin = R + Math.min(this.opts.minHeight, 0);
    const camHorizon = camDist > rMin ? Math.acos(Math.min(1, rMin / camDist)) : Math.PI;
    const camDir = camDist > 0 ? [cx / camDist, cy / camDist, cz / camDist] : [0, 0, 1];
    this.selected.length = 0;
    this.wanted.clear();

    const visit = (n: ChunkNode): void => {
      n.lastUsed = ctx.frame;
      // Geometry estimates
      const top = R + (n.data ? n.data.maxHeight : this.opts.maxHeight);
      let ncx: number, ncy: number, ncz: number, bound: number;
      if (n.data) {
        [ncx, ncy, ncz] = n.data.center;
        bound = n.data.boundRadius;
      } else {
        const rr = R + (this.opts.minHeight + this.opts.maxHeight) * 0.5;
        ncx = n.dir[0] * rr; ncy = n.dir[1] * rr; ncz = n.dir[2] * rr;
        bound = n.edge * 0.8 + (this.opts.maxHeight - this.opts.minHeight);
      }
      // Horizon culling
      if (n.key.level > 0 && camHorizon < Math.PI) {
        const cosT = n.dir[0] * camDir[0] + n.dir[1] * camDir[1] + n.dir[2] * camDir[2];
        const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
        const nodeHorizon = top > rMin ? Math.acos(Math.min(1, rMin / top)) : 0;
        if (theta > camHorizon + nodeHorizon + n.angRadius) return;
      }
      const dx = cx - ncx, dy = cy - ncy, dz = cz - ncz;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - bound, 0.5);
      const visible = n.key.level < 2 || ctx.inFrustum(ncx, ncy, ncz, bound);
      // Geometric error of a chunk ≈ a fraction of its vertex spacing (smooth terrain deviates far less
      // than one spacing from the coarse mesh); GEOM_ERROR_FACTOR trades detail for chunk count.
      const geomError = (n.edge / this.opts.res) * GEOM_ERROR_FACTOR;
      const sse = (geomError / dist) * ctx.screenFactor;
      const wantSplit = n.key.level < this.opts.maxLevel && sse > ctx.maxScreenError * (visible ? 1 : 8);
      if (wantSplit && n.state === 'ready') {
        if (!n.children) n.children = this.makeChildren(n);
        let allReady = true;
        for (const c of n.children) {
          if (c.state !== 'ready') {
            allReady = false;
            if (c.state === 'none') this.want(c, dist / n.edge, c.key.level);
          }
          c.lastUsed = ctx.frame;
        }
        if (allReady) {
          for (const c of n.children) visit(c);
          return;
        }
      }
      if (n.state === 'ready') {
        if (visible) this.selected.push(n);
      } else if (n.state === 'none') {
        this.want(n, dist / n.edge, n.key.level);
      }
    };
    for (const r of this.roots) visit(r);
    return this.selected;
  }

  private want(n: ChunkNode, priority: number, level: number): void {
    // Lower levels first so coarse coverage arrives quickly, then nearest-first.
    this.wanted.set(n, priority + level * 0.25);
  }

  private makeChildren(n: ChunkNode): ChunkNode[] {
    const { face, level, ix, iy } = n.key;
    const out: ChunkNode[] = [];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) out.push(new ChunkNode({ face, level: level + 1, ix: ix * 2 + i, iy: iy * 2 + j }, this.opts.radius));
    return out;
  }

  /** Dispatch queued builds and upload finished ones (respecting the per-frame budget). */
  pump(): void {
    const o = this.opts;
    const t0 = performance.now();
    // 1) Upload completed results
    while (this.completed.length > 0 && performance.now() - t0 < o.buildBudgetMs) {
      const { node, data } = this.completed.shift()!;
      this.attach(node, data);
    }
    // 2) Dispatch new jobs
    if (this.wanted.size > 0) {
      const list = [...this.wanted.entries()].sort((a, b) => a[1] - b[1]);
      for (const [node] of list) {
        if (node.state !== 'none') continue;
        if (o.pool.available) {
          if (this.inflight >= o.maxInFlight) break;
          node.state = 'building';
          this.inflight++;
          o.pool
            .buildChunk(o.terrainKey, { ...node.key, res: o.res, radius: o.radius, ocean: o.ocean })
            .then((data) => {
              this.inflight--;
              this.completed.push({ node, data });
            })
            .catch(() => {
              this.inflight--;
              node.state = 'none';
            });
        } else {
          if (performance.now() - t0 > o.buildBudgetMs) break;
          node.state = 'building';
          const data = o.pool.buildChunkSync(o.terrainKey, { ...node.key, res: o.res, radius: o.radius, ocean: o.ocean });
          this.attach(node, data);
        }
      }
    }
    this.stats.inflight = this.inflight;
    this.stats.queued = this.wanted.size;
  }

  private attach(node: ChunkNode, data: ChunkData): void {
    if (node.state === 'none') return; // evicted while building
    node.data = data;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3, true));
    g.setAttribute('aDetail', new THREE.BufferAttribute(data.detail, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), data.boundRadius);
    const m = new THREE.Mesh(g, this.opts.terrainMaterial);
    m.visible = false;
    m.matrixAutoUpdate = false;
    m.name = node.id;
    node.mesh = m;
    this.group.add(m);
    if (data.ocean && this.opts.oceanMaterial) {
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(data.ocean.positions, 3));
      og.setAttribute('normal', new THREE.BufferAttribute(data.ocean.normals, 3));
      og.setAttribute('aDepth', new THREE.BufferAttribute(data.ocean.depth, 1));
      og.setAttribute('aDetail', new THREE.BufferAttribute(data.ocean.detail, 3));
      og.setIndex(new THREE.BufferAttribute(data.ocean.indices, 1));
      og.boundingSphere = new THREE.Sphere(new THREE.Vector3(), data.boundRadius + Math.max(0, -data.minHeight));
      const om = new THREE.Mesh(og, this.opts.oceanMaterial);
      om.visible = false;
      om.matrixAutoUpdate = false;
      node.oceanMesh = om;
      this.group.add(om);
    }
    node.state = 'ready';
    this.meshCount++;
    this.stats.builtTotal++;
    this.stats.lastBuildMs = data.buildMs;
  }

  /**
   * Show the selected chunks, positioning each via the floating origin:
   *   renderPos = bodyRender + rot · centre   (float64 → float32)
   */
  place(bodyRenderX: number, bodyRenderY: number, bodyRenderZ: number, rot: THREE.Quaternion, rotM: THREE.Matrix3): void {
    const e = rotM.elements; // column-major
    const now = new Set<ChunkNode>(this.selected);
    for (const n of this.prevSelected) {
      if (!now.has(n)) {
        if (n.mesh) n.mesh.visible = false;
        if (n.oceanMesh) n.oceanMesh.visible = false;
      }
    }
    for (const n of this.selected) {
      const [x, y, z] = n.data!.center;
      const px = bodyRenderX + e[0] * x + e[3] * y + e[6] * z;
      const py = bodyRenderY + e[1] * x + e[4] * y + e[7] * z;
      const pz = bodyRenderZ + e[2] * x + e[5] * y + e[8] * z;
      for (const m of [n.mesh, n.oceanMesh]) {
        if (!m) continue;
        m.visible = true;
        m.position.set(px, py, pz);
        m.quaternion.copy(rot);
        m.updateMatrix();
      }
    }
    this.prevSelected = now;
    this.stats.selected = this.selected.length;
    this.stats.meshes = this.meshCount;
  }

  hideAll(): void {
    for (const n of this.prevSelected) {
      if (n.mesh) n.mesh.visible = false;
      if (n.oceanMesh) n.oceanMesh.visible = false;
    }
    this.prevSelected.clear();
  }

  /** LRU eviction of meshes not used recently (never roots). */
  evict(frame: number): void {
    if (this.meshCount <= this.opts.cacheSize) return;
    const candidates: ChunkNode[] = [];
    const visit = (n: ChunkNode) => {
      if (n.key.level > 0 && n.state === 'ready' && frame - n.lastUsed > 30) candidates.push(n);
      n.children?.forEach(visit);
    };
    this.roots.forEach(visit);
    candidates.sort((a, b) => a.lastUsed - b.lastUsed || b.key.level - a.key.level);
    let excess = this.meshCount - Math.floor(this.opts.cacheSize * 0.9);
    for (const n of candidates) {
      if (excess <= 0) break;
      this.disposeNode(n, false);
      excess--;
    }
    // Drop child arrays whose subtree holds nothing.
    const prune = (n: ChunkNode): boolean => {
      if (!n.children) return n.state === 'none';
      let empty = true;
      for (const c of n.children) if (!prune(c)) empty = false;
      if (empty && frame - n.lastUsed > 30) n.children = null;
      return empty && n.state === 'none';
    };
    this.roots.forEach(prune);
  }

  private disposeNode(n: ChunkNode, recursive: boolean): void {
    for (const m of [n.mesh, n.oceanMesh]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    if (n.mesh) this.meshCount--;
    n.mesh = null;
    n.oceanMesh = null;
    n.data = null;
    n.state = 'none';
    this.prevSelected.delete(n);
    if (recursive && n.children) for (const c of n.children) this.disposeNode(c, true);
  }

  dispose(): void {
    for (const r of this.roots) this.disposeNode(r, true);
  }
}
