import * as THREE from 'three';
import { onContextRestored } from './contextRecovery';

/**
 * Rigid node transforms for merged vessel geometry.
 *
 * Every vertex of a merged vessel mesh carries a node slot (`wspNode`). A node is a moving frame inside a part — an
 * engine gimbal, a control surface, a deployable panel, a gear joint — and its slot holds the node's affine
 * transform relative to the vessel frame. Geometry under a node is stored in the node's own frame; the vertex shader
 * applies the slot's transform before three's usual model-view. Slot 0 is the identity, used by rigid geometry and by
 * every unbatched mesh, so one material and one program serve both. This lets a vessel draw once per material while
 * its gimbals and panels keep moving, instead of once per moving mesh.
 *
 * Slots live in one shared float texture (three texels per slot, the rows of the 3×4 matrix), like the part-heat
 * lookup: materials are shared by every vessel, so a per-vessel uniform could not tell vessels apart. Each vessel
 * reserves whole rows of NODES_PER_ROW slots, so a vessel's changes upload as one texture range per row.
 */
export const NODES_PER_ROW = 128;
const ROWS = 64;
const WIDTH = NODES_PER_ROW * 3;
const values = new Float32Array(WIDTH * ROWS * 4);
export const nodeTexture = new THREE.DataTexture(values, WIDTH, ROWS, THREE.RGBAFormat, THREE.FloatType);
nodeTexture.name = 'vessel node transforms';
// Slot 0: identity rows.
values[0] = 1; values[5] = 1; values[10] = 1;
nodeTexture.needsUpdate = true;
/**
 * Ranges are only safe once the texture exists on the GPU: three applies pending ranges to the first upload too, which
 * would leave every other slot (including the identity) unset.
 */
let uploaded = false;
nodeTexture.onUpdate = () => { uploaded = true; };
/**
 * `uploaded` is module state, but GPU textures are per renderer: each new renderer (every flight, editor and thumbnail
 * renderer) starts without one, and three would apply ranges queued for the previous renderer to the new one's first
 * upload. That left slot 0 zero and collapsed every rigid hull vertex: the second launch drew only engines, panels and
 * FX. So a renderer's first node program, like a context restore, makes the next upload a full one.
 */
const restoreSubscribed = new WeakSet<THREE.WebGLRenderer>();
function restoreFull(): void {
  nodeTexture.clearUpdateRanges();
  uploaded = false;
  nodeTexture.needsUpdate = true;
}

/** Row 0 holds the identity slot; other rows are free or owned by one vessel. */
const rowOwned = new Uint8Array(ROWS);
rowOwned[0] = 1;

/** Reserve `count` contiguous slots (whole rows). Returns the first slot, or 0 when the texture is full. */
export function allocateNodes(count: number): number {
  const rows = Math.ceil(count / NODES_PER_ROW);
  if (rows === 0) return 0;
  for (let start = 1; start + rows <= ROWS; start++) {
    let free = true;
    for (let r = start; r < start + rows && free; r++) free = !rowOwned[r];
    if (!free) continue;
    rowOwned.fill(1, start, start + rows);
    return start * NODES_PER_ROW;
  }
  return 0;
}

export function releaseNodes(base: number, count: number): void {
  if (!base) return;
  const start = base / NODES_PER_ROW;
  rowOwned.fill(0, start, start + Math.ceil(count / NODES_PER_ROW));
}

/**
 * Write slot `slot` from a column-major Matrix4 (affine). Returns true when any value changed. `null` collapses the
 * node (hidden deployables): its triangles degenerate to a point and are not rasterized.
 */
export function writeNode(slot: number, m: THREE.Matrix4 | null): boolean {
  const i = (Math.floor(slot / NODES_PER_ROW) * WIDTH + (slot % NODES_PER_ROW) * 3) * 4;
  const e = m?.elements;
  let changed = false;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    const v = e ? Math.fround(e[col * 4 + row]) : 0;
    const k = i + row * 4 + col;
    if (values[k] !== v) { values[k] = v; changed = true; }
  }
  return changed;
}

/** Upload slots first..last (inclusive) of one vessel's reservation; call after its writes for the frame. */
export function commitNodes(first: number, last: number): void {
  if (last < first) return;
  if (uploaded) {
    for (let row = Math.floor(first / NODES_PER_ROW); row <= Math.floor(last / NODES_PER_ROW); row++) {
      const a = Math.max(first, row * NODES_PER_ROW), b = Math.min(last, row * NODES_PER_ROW + NODES_PER_ROW - 1);
      nodeTexture.addUpdateRange((row * WIDTH + (a % NODES_PER_ROW) * 3) * 4, (b - a + 1) * 12);
    }
  }
  nodeTexture.needsUpdate = true;
}

/** Test hook: the stored rows of a slot. */
export function nodeRows(slot: number): Float32Array {
  const i = (Math.floor(slot / NODES_PER_ROW) * WIDTH + (slot % NODES_PER_ROW) * 3) * 4;
  return values.subarray(i, i + 12);
}

/** Vertex-shader patch: transform `transformed` (and the normal/tangent, when present) by the vertex's node. */
export function patchNodeVertex(shader: THREE.WebGLProgramParametersWithUniforms, renderer?: THREE.WebGLRenderer): void {
  if (renderer && !restoreSubscribed.has(renderer)) {
    restoreSubscribed.add(renderer);
    onContextRestored(renderer, restoreFull);
    // Compiles precede the first draw (and its texture upload) on this renderer.
    restoreFull();
  }
  shader.uniforms.wspNodes = { value: nodeTexture };
  shader.vertexShader = `attribute float wspNode;
uniform highp sampler2D wspNodes;
mat4 wspNodeMatrix;
` + shader.vertexShader.replace('void main() {', `void main() {
  {
    int wspSlot = int(wspNode + 0.5);
    ivec2 wspAt = ivec2((wspSlot % ${NODES_PER_ROW}) * 3, wspSlot / ${NODES_PER_ROW});
    wspNodeMatrix = transpose(mat4(texelFetch(wspNodes, wspAt, 0), texelFetch(wspNodes, wspAt + ivec2(1, 0), 0), texelFetch(wspNodes, wspAt + ivec2(2, 0), 0), vec4(0.0, 0.0, 0.0, 1.0)));
  }`);
  // Node transforms are rotation, translation and uniform scale, so the 3×3 part also maps normals (renormalized later).
  shader.vertexShader = shader.vertexShader
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  objectNormal = mat3(wspNodeMatrix) * objectNormal;
  #ifdef USE_TANGENT
    objectTangent = mat3(wspNodeMatrix) * objectTangent;
  #endif`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed = (wspNodeMatrix * vec4(transformed, 1.0)).xyz;`);
}

/**
 * For hand-written override shaders (photo depth) drawn over the whole scene: `wspNodePosition(position)`. Most meshes
 * have no `wspNode` attribute, so pair this with `nodeOverrideDefaults` (the generic attribute value would otherwise be
 * whatever another program left at that location).
 */
export const NODE_POSITION_GLSL = `attribute float wspNode;
uniform highp sampler2D wspNodes;
vec3 wspNodePosition(vec3 p) {
  int wspSlot = int(wspNode + 0.5);
  ivec2 at = ivec2((wspSlot % ${NODES_PER_ROW}) * 3, wspSlot / ${NODES_PER_ROW});
  vec4 p4 = vec4(p, 1.0);
  return vec3(dot(texelFetch(wspNodes, at, 0), p4), dot(texelFetch(wspNodes, at + ivec2(1, 0), 0), p4), dot(texelFetch(wspNodes, at + ivec2(2, 0), 0), p4));
}
`;
/** ShaderMaterial settings for NODE_POSITION_GLSL: the node texture uniform and slot 0 for meshes without slots. */
export function nodeOverrideDefaults(material: THREE.ShaderMaterial): void {
  material.uniforms.wspNodes = { value: nodeTexture };
  (material.defaultAttributeValues as Record<string, number[]>).wspNode = [0];
}

/** Per-vertex slot attribute (all `slot`). */
export function nodeAttribute(count: number, slot = 0): THREE.BufferAttribute {
  return new THREE.Float32BufferAttribute(new Float32Array(count).fill(slot), 1);
}

/**
 * Shadow depth for merged vessel meshes (three's default depth material knows nothing of node slots). One shared
 * material for ordinary surfaces; alpha-tested sources (decals) get their own, which three fills from the source.
 */
let plainDepth: THREE.MeshDepthMaterial | undefined;
const alphaDepth = new WeakMap<THREE.Material, THREE.MeshDepthMaterial>();
function nodeDepth(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial();
  m.name = 'vessel node depth';
  m.onBeforeCompile = (shader, renderer) => patchNodeVertex(shader, renderer);
  m.customProgramCacheKey = () => 'wsp-node-depth-v1';
  return m;
}
export function nodeDepthMaterial(source: THREE.Material): THREE.MeshDepthMaterial {
  const s = source as THREE.MeshStandardMaterial;
  if (!(s.alphaTest > 0 && (s.map || s.alphaMap)) && !s.alphaToCoverage) return plainDepth ??= nodeDepth();
  let m = alphaDepth.get(source);
  if (!m) {
    m = nodeDepth();
    alphaDepth.set(source, m);
    const owned = m;
    source.addEventListener('dispose', () => owned.dispose());
  }
  return m;
}
