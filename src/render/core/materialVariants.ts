import * as THREE from 'three';

/**
 * Program-stable material variants.
 *
 * three.js keeps one compiled-program binding per material. When the same material is drawn by objects that
 * need different program variants — an `InstancedMesh` and a plain `Mesh`, or meshes with different
 * `receiveShadow` — `WebGLRenderer.setProgram` sees the mismatch on every alternation and re-resolves the
 * program (`getParameters` + `getProgramCacheKey`, a large object and string per draw). The cache hit avoids a
 * recompile, but at a dozen materials that is ~5 MB/s of garbage and a measurable slice of submission time.
 *
 * Callers that create such objects ask for a variant instead: a clone sharing every texture (texture objects are
 * updated in place, so the clone sees streamed images) that is only ever drawn in one configuration. Variants
 * are cached per source material and kept for its lifetime (sources are long-lived template/site materials).
 */
const instanced = new WeakMap<THREE.Material, THREE.Material>();

function variant(cache: WeakMap<THREE.Material, THREE.Material>, m: THREE.Material, tag: string): THREE.Material {
  let v = cache.get(m);
  if (!v) {
    v = m.clone();
    v.name = m.name ? `${m.name}${tag}` : tag;
    // Shader patches (e.g. the site's aerial perspective) are instance properties that `copy` does not carry;
    // they close over shared uniform objects, so the variant stays in step with the source.
    if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) v.onBeforeCompile = m.onBeforeCompile;
    if (Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) v.customProgramCacheKey = m.customProgramCacheKey;
    if (Object.prototype.hasOwnProperty.call(m, 'onBeforeRender')) v.onBeforeRender = m.onBeforeRender;
    cache.set(m, v);
    m.addEventListener('dispose', () => v!.dispose());
  }
  return v;
}

/** The material to use on an `InstancedMesh` when `m` is also drawn by non-instanced meshes. */
export function instancedVariant<T extends THREE.Material>(m: T): T {
  return variant(instanced, m, '#inst') as T;
}
