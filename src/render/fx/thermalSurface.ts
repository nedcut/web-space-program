import * as THREE from 'three';
import { nodeAttribute, patchNodeVertex } from '../core/rigidNodes';

// Two texels per part: skin and nozzle. Slot zero is always cold. One shared lookup by a per-vertex
// slot keeps emission independent per part even after static merging / instancing.
const WIDTH = 128;
const HEIGHT = 64;
const values = new Float32Array(WIDTH * HEIGHT * 4);
export const thermalTexture = new THREE.DataTexture(values, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType);
thermalTexture.name = 'part thermal radiance';
thermalTexture.needsUpdate = true;
const free: number[] = [];
let next = 2;
export function allocateThermalSlot(): number {
  if (free.length) return free.pop()!;
  if (next >= WIDTH * HEIGHT) return 0; // Bounded visual budget; simulation is unaffected.
  const slot = next; next += 2; return slot;
}
export function writeThermalSlot(slot: number, color: THREE.Color): void {
  if (!slot) return;
  const i = slot * 4;
  if (values[i] === Math.fround(color.r) && values[i + 1] === Math.fround(color.g) && values[i + 2] === Math.fround(color.b)) return;
  values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b;
  thermalTexture.needsUpdate = true;
}
const cold = new THREE.Color(0, 0, 0);
export function releaseThermalSlot(slot: number): void {
  if (!slot) return;
  writeThermalSlot(slot, cold); writeThermalSlot(slot + 1, cold); free.push(slot);
}

const variants = new WeakMap<THREE.Material, THREE.Material>();
const isVariant = new WeakSet<THREE.Material>();
/** True for materials made by thermalMaterial (they also apply rigid node slots). */
export function isThermalVariant(m: THREE.Material): boolean { return isVariant.has(m); }
export function thermalMaterial(m: THREE.Material): THREE.Material {
  if (!(m instanceof THREE.MeshStandardMaterial)) return m;
  let variant = variants.get(m);
  if (variant) return variant;
  variant = m.clone();
  variant.name = `${m.name}#thermal`;
  variant.onBeforeCompile = (shader, renderer) => {
    m.onBeforeCompile(shader, renderer);
    // Part meshes also carry a rigid node slot (identity unless merged under a gimbal/deployable; see rigidNodes).
    patchNodeVertex(shader);
    shader.uniforms.wspThermal = { value: thermalTexture };
    // A float varying packs into a spare component beside three's vec3 varyings; a vec3 needs a whole
    // vector, and physical materials with maps, shadows and log depth already use WebGL 2's minimum of 15
    // (what Firefox reports under resistFingerprinting, and some mobile GPUs): those programs failed to link.
    shader.vertexShader = 'attribute float wspHeatSlot;\nvarying float wspSlot;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n      wspSlot = wspHeatSlot;');
    shader.fragmentShader = 'uniform sampler2D wspThermal;\nvarying float wspSlot;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // Every vertex of a part carries the same slot; rounding absorbs interpolation error.
      float wspIndex = floor(wspSlot + 0.5);
      totalEmissiveRadiance += texelFetch(wspThermal, ivec2(int(mod(wspIndex, 128.0)), int(wspIndex / 128.0)), 0).rgb;`);
  };
  variant.customProgramCacheKey = () => `${m.customProgramCacheKey()}:thermal-v3`;
  variants.set(m, variant);
  isVariant.add(variant);
  const owned = variant;
  m.addEventListener('dispose', () => owned.dispose());
  return variant;
}

// Retain template identity so repeated static parts still use InstancedMesh, not unique draws.
export const thermalSources = new WeakMap<THREE.BufferGeometry, { source: THREE.BufferGeometry; slot: number }>();
export function thermalGeometry(source: THREE.BufferGeometry, slot: number): THREE.BufferGeometry {
  const g = source.clone();
  const count = source.getAttribute('position').count;
  g.setAttribute('wspHeatSlot', new THREE.Float32BufferAttribute(new Float32Array(count).fill(slot), 1));
  // Always present: an unbound attribute would read whatever generic value another program left at its location.
  g.setAttribute('wspNode', nodeAttribute(count));
  thermalSources.set(g, { source, slot });
  return g;
}
