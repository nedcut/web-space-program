import * as THREE from 'three';

/** Slots allocated up front and never shrunk below. */
const MIN_SLOTS = 32;
/** Grow by this factor when every slot is live (rounded up to whole slots). */
const GROWTH = 1.5;
/** Shrink once live slots have stayed at or below this fraction of capacity for SHRINK_DELAY_MS. */
const SHRINK_BELOW = 0.4;
const SHRINK_DELAY_MS = 8000;
/** Capacity after a shrink, relative to the peak live count seen while waiting. */
const SHRINK_HEADROOM = 1.5;
/** Live slots moved per frame into lower free slots, so the live ones stay one contiguous draw range. */
const COMPACT_MOVES = 4;

interface Attr { name: string; type: number; itemSize: number; bytes: number; normalized: boolean }
interface Buffers { attrs: WebGLBuffer[]; index: WebGLBuffer; capacity: number }

const _frustum = new THREE.Frustum();
const _matrix = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

function glType(gl: WebGL2RenderingContext, array: THREE.TypedArray): number {
  if (array instanceof Float32Array) return gl.FLOAT;
  if (array instanceof Uint8Array) return gl.UNSIGNED_BYTE;
  if (array instanceof Uint16Array) return gl.UNSIGNED_SHORT;
  if (array instanceof Int16Array) return gl.SHORT;
  if (array instanceof Uint32Array) return gl.UNSIGNED_INT;
  throw new Error('ChunkBatch: unsupported attribute array');
}

/**
 * Visible chunks only, in reusable fixed-size slots drawn with one multi-draw call (three's batching shader path:
 * `isBatchedMesh`, matrices texture). The chunk shaders find a vertex's slot as `gl_VertexID / CHUNK_SLOT_VERTS`
 * (indices are absolute, so in an indexed draw gl_VertexID is the vertex's index), not through three's
 * per-draw indirect lookup: visible slots that are adjacent merge into one draw range. Without WEBGL_multi_draw
 * (Firefox) three issues one draw call per range, so this turns one call per chunk into one per run of slots. Unlike three's BatchedMesh there is no CPU copy of the batch:
 * each slot is written with `bufferSubData` straight from the chunk's own arrays (which the terrain cache keeps
 * anyway), and resizes copy GPU-side. Capacity follows demand: ×1.5 when full, and back down once the live
 * count has stayed low for a while (orbit after the pad), so neither the GPU buffers nor a capacity ratchet
 * outlive the peak. Slot k always holds vertices [kV, (k+1)V) and indices [kI, (k+1)I) = shared pattern + kV.
 */
export class ChunkBatch {
  readonly mesh: THREE.Mesh;
  private readonly slots = new Map<THREE.Mesh, number>();
  /** Free slot ids below `count`, lowest last (popped first) to keep live slots dense at the bottom. */
  private free: number[] = [];
  private freeSorted = true;
  /** Slot ids ever handed out in the current buffers (all below `count` have their index range written). */
  private count = 0;
  private bufs: Buffers | null = null;
  private attrs: Attr[] | null = null;
  private pattern: Uint16Array | Uint32Array | null = null;
  private readonly scratch: Uint32Array;
  private readonly sources: (THREE.Mesh | null)[] = [];
  private readonly radii: number[] = [];
  /** Bounding-sphere centres in chunk-local coordinates (x, y, z per slot). */
  private centres = new Float64Array(MIN_SLOTS * 3);
  private matrices!: THREE.DataTexture;
  private indirect!: THREE.DataTexture;
  private lowSince = -1;
  private lowPeak = 0;
  private lost = false;
  private vao: WebGLVertexArrayObject | null = null;
  private readonly onLost = () => { this.lost = true; };
  private readonly onRestored = () => { this.restore(); };
  /** Bytes of GPU vertex + index storage at the current capacity (diagnostics). */
  gpuBytes = 0;
  /** Chunks in the last draw list (ranges are `_multiDrawCount`; diagnostics). */
  drawnChunks = 0;

  constructor(material: THREE.Material, private readonly gl: WebGL2RenderingContext, private readonly vertices: number, private readonly indices: number) {
    this.scratch = new Uint32Array(indices);
    const mesh = new THREE.Mesh(ChunkBatch.emptyGeometry(), ChunkBatch.slotMaterial(material, vertices));
    const m = mesh as THREE.Mesh & Record<string, unknown>;
    // three's renderer draws any `isBatchedMesh` object with these fields through its batching program variant.
    m.isBatchedMesh = true;
    m._multiDrawStarts = new Int32Array(MIN_SLOTS);
    m._multiDrawCounts = new Int32Array(MIN_SLOTS);
    m._multiDrawCount = 0;
    m._multiDrawInstances = null;
    m._colorsTexture = null;
    mesh.name = 'terrain-chunk-batch';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.raycast = () => {};
    mesh.onBeforeRender = (_r, _s, camera) => this.prepareDraws(camera);
    this.mesh = mesh;
    this.makeTextures(MIN_SLOTS);
    gl.canvas.addEventListener('webglcontextlost', this.onLost);
    gl.canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  /** Chunk materials read the slot from gl_VertexID: they must know the slot size before their first compile. */
  private static slotMaterial(material: THREE.Material, vertices: number): THREE.Material {
    if (material instanceof THREE.ShaderMaterial) material.defines.CHUNK_SLOT_VERTS = vertices;
    return material;
  }

  setMaterial(material: THREE.Material): void { this.mesh.material = ChunkBatch.slotMaterial(material, this.vertices); }

  /** Slots the GPU buffers hold. */
  get capacity(): number { return this.bufs?.capacity ?? 0; }
  /** Live (drawn) slots. */
  get live(): number { return this.slots.size; }

  place(source: THREE.Mesh, changed: boolean): void {
    let slot = this.slots.get(source);
    if (slot === undefined) {
      slot = this.allocate(source);
      this.slots.set(source, slot);
      this.sources[slot] = source;
      const bs = source.geometry.boundingSphere;
      this.radii[slot] = bs?.radius ?? Infinity;
      if (this.centres.length < (slot + 1) * 3) {
        const grown = new Float64Array(Math.max(this.centres.length * 2, (slot + 1) * 3));
        grown.set(this.centres);
        this.centres = grown;
      }
      this.centres[slot * 3] = bs?.center.x ?? 0;
      this.centres[slot * 3 + 1] = bs?.center.y ?? 0;
      this.centres[slot * 3 + 2] = bs?.center.z ?? 0;
      this.upload(slot, source);
      changed = true;
    }
    // Matrices are already rebased in JS float64 by Quadtree.place, then cast by the float texture upload.
    // Never store solar-system or body-centred translations.
    if (changed) {
      source.matrix.toArray(this.matrices.image.data as Float32Array, slot * 16);
      this.matrices.needsUpdate = true;
    }
    this.mesh.visible = true;
  }

  release(source: THREE.Mesh): void {
    const slot = this.slots.get(source);
    if (slot === undefined) return;
    this.slots.delete(source);
    this.sources[slot] = null;
    this.free.push(slot);
    this.freeSorted = false;
    if (!this.slots.size) this.mesh.visible = false;
  }

  /**
   * Shrink after the live count has stayed low for SHRINK_DELAY_MS (call once per frame, after place/release).
   * Moving slots and copying buffers is GPU-side; the CPU cost is a few GL calls per moved slot.
   */
  maintain(now = performance.now()): void {
    this.compact(COMPACT_MOVES);
    const cap = this.capacity;
    const live = this.slots.size;
    // Nothing drawn (far LOD): release the buffers entirely after the delay.
    if (cap === 0 || (live > 0 && (cap <= MIN_SLOTS || live > cap * SHRINK_BELOW))) { this.lowSince = -1; return; }
    if (this.lowSince < 0) { this.lowSince = now; this.lowPeak = live; }
    this.lowPeak = Math.max(this.lowPeak, live);
    if (now - this.lowSince < SHRINK_DELAY_MS) return;
    this.lowSince = -1;
    const target = this.lowPeak === 0 ? 0 : Math.max(MIN_SLOTS, Math.ceil(this.lowPeak * SHRINK_HEADROOM));
    if (target < cap) this.resize(target);
  }

  /**
   * Move up to `maxMoves` of the highest live slots into the lowest free ones (GPU-side copies; index ranges depend
   * only on the slot id). LOD changes free slots all over the batch; without this each hole splits a draw range,
   * and without WEBGL_multi_draw every range is a draw call.
   */
  private compact(maxMoves: number): void {
    if (this.lost || !this.bufs) return;
    const gl = this.gl, attrs = this.attrs!, V = this.vertices;
    const matrices = this.matrices.image.data as Float32Array;
    let top = this.count - 1;
    for (let moves = 0; moves < maxMoves && this.free.length; moves++) {
      if (!this.freeSorted) { this.free.sort((a, b) => b - a); this.freeSorted = true; }
      while (top >= 0 && !this.sources[top]) top--;
      const hole = this.free[this.free.length - 1];
      if (top < 0 || hole > top) break;
      this.free.pop();
      for (let a = 0; a < attrs.length; a++) {
        const stride = V * attrs[a].itemSize * attrs[a].bytes;
        // Same buffer for read and write is allowed for non-overlapping ranges.
        gl.bindBuffer(gl.COPY_READ_BUFFER, this.bufs.attrs[a]);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.bufs.attrs[a]);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, top * stride, hole * stride, stride);
      }
      gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      matrices.copyWithin(hole * 16, top * 16, top * 16 + 16);
      this.matrices.needsUpdate = true;
      const src = this.sources[top]!;
      this.slots.set(src, hole);
      this.sources[hole] = src;
      this.sources[top] = null;
      this.radii[hole] = this.radii[top];
      this.centres.copyWithin(hole * 3, top * 3, top * 3 + 3);
      this.free.push(top);
      this.freeSorted = false;
    }
  }

  private allocate(source: THREE.Mesh): number {
    if (!this.attrs) this.init(source.geometry);
    if (this.free.length) {
      if (!this.freeSorted) { this.free.sort((a, b) => b - a); this.freeSorted = true; }
      return this.free.pop()!;
    }
    if (!this.bufs || this.count === this.bufs.capacity) {
      const cap = this.bufs?.capacity ?? 0;
      this.resize(cap ? Math.ceil(cap * GROWTH) : MIN_SLOTS);
    }
    const slot = this.count++;
    this.writeIndex(slot);
    return slot;
  }

  private init(g: THREE.BufferGeometry): void {
    const gl = this.gl;
    this.attrs = Object.entries(g.attributes).map(([name, a]) => {
      const array = (a as THREE.BufferAttribute).array;
      return { name, type: glType(gl, array), itemSize: a.itemSize, bytes: array.BYTES_PER_ELEMENT, normalized: a.normalized };
    });
    this.pattern = g.index!.array as Uint16Array | Uint32Array;
  }

  /** Index range of slot k: the shared chunk pattern offset by the slot's first vertex. */
  private writeIndex(slot: number): void {
    const gl = this.gl, p = this.pattern!, out = this.scratch, base = slot * this.vertices;
    for (let i = 0; i < p.length; i++) out[i] = p[i] + base;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.bufs!.index);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, slot * this.indices * 4, out);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }

  private upload(slot: number, source: THREE.Mesh): void {
    // COPY_* targets are not vertex-array state: three's bound VAO and its element buffer stay untouched.
    const gl = this.gl, g = source.geometry, attrs = this.attrs!, bufs = this.bufs!;
    for (let a = 0; a < attrs.length; a++) {
      const at = attrs[a];
      const array = (g.attributes[at.name] as THREE.BufferAttribute).array;
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, bufs.attrs[a]);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, slot * this.vertices * at.itemSize * at.bytes, array);
    }
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }

  /** Reallocate to `capacity` slots, keeping live slots (renumbered below `capacity` when shrinking). */
  private resize(capacity: number): void {
    const gl = this.gl, attrs = this.attrs!, old = this.bufs, V = this.vertices, I = this.indices;
    const next: Buffers = {
      attrs: attrs.map((at) => this.createBuffer(capacity * V * at.itemSize * at.bytes)),
      index: this.createBuffer(capacity * I * 4, true),
      capacity,
    };
    // Slots that must move below the new capacity, and the free ids they move into.
    const moves: [number, number][] = [];
    if (old && capacity < this.count) {
      const holes = this.free.filter((s) => s < capacity).sort((a, b) => a - b);
      for (let s = capacity; s < this.count; s++) if (this.sources[s]) moves.push([s, holes.shift()!]);
    }
    if (old) {
      const keep = Math.min(this.count, capacity);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      for (let a = 0; a < attrs.length; a++) {
        const stride = V * attrs[a].itemSize * attrs[a].bytes;
        gl.bindBuffer(gl.COPY_READ_BUFFER, old.attrs[a]);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, next.attrs[a]);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, keep * stride);
        for (const [from, to] of moves) gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, from * stride, to * stride, stride);
      }
      // Index ranges depend only on the slot id: the kept prefix is already right.
      gl.bindBuffer(gl.COPY_READ_BUFFER, old.index);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, next.index);
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, keep * I * 4);
      gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      this.count = keep;
      this.deleteBuffers(old);
    }
    this.bufs = next;
    const oldMatrices = this.matrices.image.data as Float32Array;
    this.makeTextures(capacity);
    const matrices = this.matrices.image.data as Float32Array;
    matrices.set(oldMatrices.subarray(0, Math.min(oldMatrices.length, matrices.length, this.count * 16)));
    for (const [from, to] of moves) {
      matrices.set(oldMatrices.subarray(from * 16, from * 16 + 16), to * 16);
      const src = this.sources[from]!;
      this.slots.set(src, to);
      this.sources[to] = src;
      this.radii[to] = this.radii[from];
      this.centres.copyWithin(to * 3, from * 3, from * 3 + 3);
    }
    this.sources.length = this.radii.length = this.count;
    this.free = [];
    for (let s = this.count - 1; s >= 0; s--) if (!this.sources[s]) this.free.push(s);
    this.freeSorted = true;
    this.bindGeometry();
  }

  private createBuffer(bytes: number, elements = false): WebGLBuffer {
    const gl = this.gl, b = gl.createBuffer()!;
    // WebGL 2 fixes a buffer's type at its first binding, and element buffers may never become vertex data or
    // vice versa. An index buffer must first be bound as ELEMENT_ARRAY_BUFFER, which is vertex-array state:
    // do that inside a private VAO so three's bound VAO keeps its own index buffer.
    if (elements) {
      const prev = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
      this.vao ??= gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindVertexArray(prev);
    }
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, b);
    gl.bufferData(gl.COPY_WRITE_BUFFER, bytes, gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    return b;
  }

  private deleteBuffers(b: Buffers): void {
    for (const x of b.attrs) this.gl.deleteBuffer(x);
    this.gl.deleteBuffer(b.index);
  }

  /**
   * New attribute objects so three rebinds its vertex arrays to the new buffers. After a context restore the old
   * geometry belongs to the lost context's bookkeeping: drop it without dispose (nothing left to delete).
   */
  private bindGeometry(disposeOld = true): void {
    const bufs = this.bufs!, cap = bufs.capacity, old = this.mesh.geometry;
    const g = ChunkBatch.emptyGeometry();
    this.attrs!.forEach((at, a) => g.setAttribute(at.name,
      new THREE.GLBufferAttribute(bufs.attrs[a], at.type, at.itemSize, at.bytes as 1 | 2 | 4, cap * this.vertices, at.normalized) as unknown as THREE.BufferAttribute));
    g.setIndex(new THREE.GLBufferAttribute(bufs.index, this.gl.UNSIGNED_INT, 1, 4, cap * this.indices) as unknown as THREE.BufferAttribute);
    // three deletes GL buffers of a disposed geometry's GLBufferAttributes; the old ones are already gone.
    for (const name in old.attributes) old.deleteAttribute(name);
    old.setIndex(null);
    if (disposeOld) old.dispose();
    this.mesh.geometry = g;
    this.gpuBytes = cap * (this.vertices * this.attrs!.reduce((s, at) => s + at.itemSize * at.bytes, 0) + this.indices * 4);
  }

  /** Chunks sit around the floating origin; the renderer only reads this sphere to order opaque objects. */
  private static emptyGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return g;
  }

  private makeTextures(capacity: number): void {
    this.matrices?.dispose();
    this.indirect?.dispose();
    // Same matrix layout as three's BatchedMesh (batching_pars_vertex): 4 RGBA float texels per matrix. The chunk
    // shaders never read the indirect (draw → slot) texture; three binds one anyway, so it stays a 1×1 placeholder.
    const ms = Math.max(4, Math.ceil(Math.sqrt(capacity * 4) / 4) * 4);
    this.matrices = new THREE.DataTexture(new Float32Array(ms * ms * 4), ms, ms, THREE.RGBAFormat, THREE.FloatType);
    this.matrices.needsUpdate = true;
    this.indirect = new THREE.DataTexture(new Uint32Array(1), 1, 1, THREE.RedIntegerFormat, THREE.UnsignedIntType);
    this.indirect.needsUpdate = true;
    const m = this.mesh as THREE.Mesh & Record<string, unknown>;
    m._matricesTexture = this.matrices;
    m._indirectTexture = this.indirect;
    m._multiDrawStarts = new Int32Array(capacity);
    m._multiDrawCounts = new Int32Array(capacity);
  }

  /**
   * Per-camera draw list: live slots whose bounding sphere meets the frustum (as BatchedMesh per-object culling),
   * with adjacent slots merged into one range.
   */
  private prepareDraws(camera: THREE.Camera): void {
    const m = this.mesh as THREE.Mesh & { _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number };
    const starts = m._multiDrawStarts, counts = m._multiDrawCounts;
    const mat = this.matrices.image.data as Float32Array, c = this.centres;
    _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.mesh.matrixWorld);
    _frustum.setFromProjectionMatrix(_matrix, camera.coordinateSystem, camera.reversedDepth);
    let n = 0, chunks = 0, last = -2;
    if (!this.lost) {
      for (let s = 0; s < this.count; s++) {
        if (!this.sources[s]) continue;
        const o = s * 16, x = c[s * 3], y = c[s * 3 + 1], z = c[s * 3 + 2];
        _sphere.center.set(
          mat[o + 12] + mat[o] * x + mat[o + 4] * y + mat[o + 8] * z,
          mat[o + 13] + mat[o + 1] * x + mat[o + 5] * y + mat[o + 9] * z,
          mat[o + 14] + mat[o + 2] * x + mat[o + 6] * y + mat[o + 10] * z);
        _sphere.radius = this.radii[s];
        if (!_frustum.intersectsSphere(_sphere)) continue;
        chunks++;
        if (s === last + 1) counts[n - 1] += this.indices;
        else { starts[n] = s * this.indices * 4; counts[n] = this.indices; n++; }
        last = s;
      }
    }
    m._multiDrawCount = n;
    this.drawnChunks = chunks;
  }

  /** Context restored: every GL buffer is gone. Recreate them and re-upload the live slots from the chunks. */
  private restore(): void {
    this.lost = false;
    this.vao = null;
    if (!this.attrs) return;
    const cap = this.bufs?.capacity ?? MIN_SLOTS;
    this.bufs = null;
    this.free = [];
    this.count = 0;
    const live = [...this.slots.keys()];
    this.slots.clear();
    this.sources.length = this.radii.length = 0;
    const V = this.vertices, I = this.indices;
    this.bufs = {
      attrs: this.attrs.map((at) => this.createBuffer(cap * V * at.itemSize * at.bytes)),
      index: this.createBuffer(cap * I * 4, true),
      capacity: cap,
    };
    this.bindGeometry(false);
    this.makeTextures(cap);
    for (const src of live) this.place(src, true);
  }

  dispose(): void {
    this.gl.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.gl.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.slots.clear();
    this.sources.length = 0;
    this.free.length = 0;
    // Geometry dispose deletes the GLBufferAttribute buffers through three when it ever drew them.
    this.mesh.geometry.dispose();
    if (this.bufs) this.deleteBuffers(this.bufs);
    this.bufs = null;
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.vao = null;
    this.matrices.dispose();
    this.indirect.dispose();
  }
}
