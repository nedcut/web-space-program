import type * as THREE from 'three';

/**
 * Shader warm-up spread over frames.
 *
 * `renderer.compileAsync(scene)` links in parallel where KHR_parallel_shader_compile exists, but builds every
 * program's source, cache key and GL objects in one synchronous call — ~200 ms for the flight scene, a frozen
 * loading screen. This compiles one representative object per distinct program configuration (material ×
 * instancing × shadow reception × vertex layout), a few milliseconds' worth per frame, and resolves when every
 * program is linked, then pre-pays each program's first-use introspection and uploads material textures.
 * Hidden objects are included (plumes, FX), as with `compileAsync`.
 */
export interface SliceOptions {
  /** Main-thread budget per slice (ms). */
  budgetMs?: number;
  /** Bound before each slice so programs match the target they will draw into (tone mapping, colour space). */
  renderTarget?: THREE.WebGLRenderTarget | null;
  /** Stop early (e.g. the scene was disposed). */
  cancelled?: () => boolean;
  /** Yield between slices (default: next animation frame). */
  yieldFn?: () => Promise<void>;
}

type Drawable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

function programKey(o: Drawable): string {
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const g = o.geometry;
  const inst = o as unknown as THREE.InstancedMesh;
  return [
    mats.map((m) => m?.uuid ?? '-').join(','),
    o.type,
    inst.isInstancedMesh ? (inst.instanceColor ? 'ic' : 'i') : '',
    o.receiveShadow ? 'rs' : '',
    g ? Object.keys(g.attributes).sort().join('/') : '',
    g ? Object.keys(g.morphAttributes).length : 0,
  ].join('|');
}

/** One object per distinct program configuration under `roots` (skipping configurations in `done`, then adding). */
export function programRepresentatives(roots: THREE.Object3D[], done = new Set<string>()): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      const d = o as Drawable;
      if (!(d as THREE.Mesh).isMesh && !(d as THREE.Points).isPoints && !(d as THREE.Line).isLine && !(d as THREE.Sprite).isSprite) return;
      if (!d.material) return;
      const k = programKey(d);
      if (done.has(k)) return;
      done.add(k);
      out.push(o);
    });
  }
  return out;
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

/**
 * Compile everything under `roots` in slices. Objects added while it runs (renderers created over the first
 * frames) are picked up by rescanning once a round is linked, until a scan finds nothing new.
 */
export async function compileInSlices(renderer: THREE.WebGLRenderer, roots: THREE.Object3D[], camera: THREE.Camera, targetScene: THREE.Scene, opts: SliceOptions = {}): Promise<void> {
  const budget = opts.budgetMs ?? 8;
  const wait = opts.yieldFn ?? nextFrame;
  const done = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const objects = programRepresentatives(roots, done);
    if (!objects.length) return;
    const linked: Promise<unknown>[] = [];
    let i = 0;
    while (i < objects.length) {
      if (opts.cancelled?.()) return;
      const previous = renderer.getRenderTarget();
      if (opts.renderTarget !== undefined) renderer.setRenderTarget(opts.renderTarget);
      const t0 = performance.now();
      try {
        do linked.push(renderer.compileAsync(objects[i++], camera, targetScene));
        while (i < objects.length && performance.now() - t0 < budget);
      } finally {
        renderer.setRenderTarget(previous);
      }
      if (i < objects.length) await wait();
    }
    await Promise.all(linked);
    await warmFirstUse(renderer, objects, budget, wait, opts.cancelled);
  }
}

interface ProgramLike { getUniforms(): unknown; getAttributes(): unknown }

/**
 * The first draw with a program still introspects its uniforms/attributes (synchronous GL queries), and the
 * first draw with a texture uploads it (2048² site canvases with mipmaps: tens of ms). Do both here, sliced,
 * instead of in the first visible frames.
 */
async function warmFirstUse(renderer: THREE.WebGLRenderer, objects: THREE.Object3D[], budget: number, wait: () => Promise<void>, cancelled?: () => boolean) {
  const tasks: (() => void)[] = [];
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const tex = (v: unknown) => { if (v && (v as THREE.Texture).isTexture && !(v as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) textures.add(v as THREE.Texture); };
  for (const o of objects) {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) materials.add(mat);
  }
  for (const mat of materials) {
    const program = (renderer.properties.get(mat) as { currentProgram?: ProgramLike }).currentProgram;
    if (program) tasks.push(() => { program.getUniforms(); program.getAttributes(); });
    for (const v of Object.values(mat)) tex(v);
    const u = (mat as THREE.ShaderMaterial).uniforms;
    if (u) for (const k in u) tex(u[k]?.value);
  }
  for (const t of textures) {
    const img = t.image as { width?: number } | null;
    if (img && img.width) tasks.push(() => renderer.initTexture(t));
  }
  let i = 0;
  while (i < tasks.length) {
    if (cancelled?.()) return;
    const t0 = performance.now();
    do tasks[i++]();
    while (i < tasks.length && performance.now() - t0 < budget);
    if (i < tasks.length) await wait();
  }
}
