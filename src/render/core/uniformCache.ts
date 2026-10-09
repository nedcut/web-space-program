/**
 * three caches single uniforms per program but re-uploads every float/matrix *array* uniform each time a material is
 * set up: `directionalShadowMatrix` on every material switch of a shadow-receiving material (~60 uploads per frame
 * with a vessel and the launch site), the bloom blur's Gaussian kernels on every blur pass. Each upload is an IPC
 * command in Firefox's remoted WebGL. This wraps those uniforms' setters (three's `PureArrayUniform`) with the
 * same compare-before-upload cache: uniform values are program state, so the last uploaded value per program
 * stays valid until changed.
 *
 * Programs are wrapped lazily, when three first asks for their uniforms, so no program is queried before it is
 * linked (that would wait for a parallel compile).
 */

/** Floats per array element, by GL uniform type. Integer and sampler arrays are left alone. */
const BLOCK: Record<number, number> = {
  0x1406: 1, // FLOAT
  0x8b50: 2, // FLOAT_VEC2
  0x8b51: 3, // FLOAT_VEC3
  0x8b52: 4, // FLOAT_VEC4
  0x8b5a: 4, // FLOAT_MAT2
  0x8b5b: 9, // FLOAT_MAT3
  0x8b5c: 16, // FLOAT_MAT4
};

type Setter = (this: ArrayUniform, gl: unknown, value: unknown, textures?: unknown) => void;
interface ArrayUniform { type: number; size: number; setValue: Setter }
interface UniformNode { seq?: UniformNode[]; type?: number; size?: number; setValue?: Setter }
interface ProgramLike { getUniforms(): UniformNode }
type ArrayElement = { toArray(array: Float32Array, offset: number): unknown };

/** Flatten `value` like three's uploader would; false for shapes the cache does not handle (upload uncached). */
function flattenInto(out: Float32Array, value: unknown, size: number, block: number): boolean {
  const array = value as ArrayLike<unknown> | null;
  if (!array || typeof array.length !== 'number') return false;
  if (typeof array[0] === 'number') {
    if (array.length !== out.length) return false;
    for (let i = 0; i < out.length; i++) out[i] = array[i] as number;
    return true;
  }
  if (array.length < size) return false;
  for (let i = 0; i < size; i++) {
    const element = array[i] as ArrayElement | undefined;
    if (!element || typeof element.toArray !== 'function') return false;
    element.toArray(out, i * block);
  }
  return true;
}

function cacheSetter(uniform: ArrayUniform): void {
  const block = BLOCK[uniform.type];
  if (!block || !(uniform.size > 0)) return;
  const upload = uniform.setValue;
  const last = new Float32Array(uniform.size * block);
  const next = new Float32Array(last.length);
  let valid = false;
  uniform.setValue = function (gl, value, textures) {
    if (!flattenInto(next, value, uniform.size, block)) { valid = false; upload.call(this, gl, value, textures); return; }
    if (valid) {
      let same = true;
      for (let i = 0; i < next.length; i++) if (next[i] !== last[i]) { same = false; break; }
      if (same) return;
    }
    last.set(next);
    valid = true;
    upload.call(this, gl, value, textures);
  };
}

function wrapNode(node: UniformNode): void {
  if (node.seq) { for (const child of node.seq) wrapNode(child); return; }
  // PureArrayUniform: has a size; three's SingleUniform has none (and already caches).
  if (typeof node.setValue === 'function' && typeof node.type === 'number' && typeof node.size === 'number') cacheSetter(node as ArrayUniform);
}

/** Wraps each new program's array uniforms once (call per frame with `renderer.info.programs`). */
export class ArrayUniformCache {
  private readonly seen = new WeakSet<object>();
  private count = -1;
  private last: object | undefined;

  sync(programs: readonly ProgramLike[] | null | undefined): void {
    if (!programs || (programs.length === this.count && programs[programs.length - 1] === this.last)) return;
    this.count = programs.length;
    this.last = programs[programs.length - 1];
    for (const program of programs) {
      if (this.seen.has(program)) continue;
      this.seen.add(program);
      const getUniforms = program.getUniforms;
      let wrapped = false;
      program.getUniforms = function (this: ProgramLike) {
        const uniforms = getUniforms.call(this);
        if (!wrapped) { wrapped = true; wrapNode(uniforms); }
        return uniforms;
      };
    }
  }
}
